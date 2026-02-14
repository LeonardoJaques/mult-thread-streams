export default class Service {
  processFile({ query, file, onMatchFound, onProgress, onDone }) {
    const lineCount = { value: 0 };
    const reportProgress = this.#setupProgress(file.size, onProgress);
    const startedAt = performance.now();
    const elapsed = () =>
      `${((performance.now() - startedAt) / 1000).toFixed(2)} secs`;

    const onUpdate = (found) => {
      onMatchFound({
        found,
        took: elapsed(),
        linesLength: lineCount.value,
      });
    };

    file
      .stream()
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(this.#csvToJSON({ lineCount, reportProgress }))
      .pipeTo(this.#countOccurrences({ query, onMatchFound: onUpdate }))
      .then(() => {
        if (onDone) {
          onDone({ took: elapsed(), linesLength: lineCount.value });
        }
      })
      .catch((err) => {
        console.error("Stream processing error:", err);
      });
  }

  #parseCsvLine(line, columns) {
    const item = {};
    const values = line.split(",");
    for (let i = 0; i < values.length; i++) {
      item[columns[i]] = values[i].trimEnd();
    }
    return item;
  }

  #csvToJSON({ lineCount, reportProgress }) {
    let columns = [];
    let remainder = "";

    return new TransformStream({
      transform: (chunk, controller) => {
        reportProgress(chunk.length);

        // Prepend any leftover partial line from the previous chunk
        const text = remainder + chunk;
        const lines = text.split("\n");

        // The last element may be an incomplete line — save it for next chunk
        remainder = lines.pop() || "";

        lineCount.value += lines.length;

        if (!columns.length) {
          const firstLine = lines.shift();
          columns = firstLine.split(",");
          lineCount.value--;
        }

        for (const line of lines) {
          if (!line.length) continue;
          controller.enqueue(this.#parseCsvLine(line, columns));
        }
      },
      flush: (controller) => {
        // Process any remaining partial line at the end of the file
        if (remainder.length) {
          lineCount.value++;
          controller.enqueue(this.#parseCsvLine(remainder, columns));
        }
      },
    });
  }

  #countOccurrences({ query, onMatchFound }) {
    const queryKeys = Object.keys(query);
    let found = {};
    return new WritableStream({
      write(jsonLine) {
        for (const key of queryKeys) {
          const pattern = query[key];
          found[pattern] = found[pattern] ?? 0;
          if (pattern.test(jsonLine[key])) {
            found[pattern]++;
            onMatchFound(found);
          }
        }
      },
    });
  }

  #setupProgress(fileSizeBytes, onProgress) {
    let totalUploadedBytes = 0;
    onProgress(0);
    return (chunkLength) => {
      totalUploadedBytes += chunkLength;
      const percentComplete = (totalUploadedBytes / fileSizeBytes) * 100;
      onProgress(percentComplete);
    };
  }
}
