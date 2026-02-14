export default class Service {
  processFile({ query, file, onOcurrenceUpdate, onProgress, onDone }) {
    const linesLength = { counter: 0 };
    const progressFn = this.#setupProgress(file.size, onProgress);
    const startedAt = performance.now();
    const elapsed = () =>
      `${((performance.now() - startedAt) / 1000).toFixed(2)} secs`;

    const onUpdate = (found) => {
      onOcurrenceUpdate({
        found,
        took: elapsed(),
        linesLength: linesLength.counter,
      });
    };

    file
      .stream()
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(this.#csvToJSON({ linesLength, progressFn }))
      .pipeTo(this.#findOcurrencies({ query, onOcurrenceUpdate: onUpdate }))
      .then(() => {
        if (onDone) {
          onDone({ took: elapsed(), linesLength: linesLength.counter });
        }
      })
      .catch((err) => {
        console.error("Stream processing error:", err);
      });
  }

  #csvToJSON({ linesLength, progressFn }) {
    let columns = [];
    let remainder = "";

    return new TransformStream({
      transform: (chunk, controller) => {
        progressFn(chunk.length);

        // Prepend any leftover partial line from the previous chunk
        const text = remainder + chunk;
        const lines = text.split("\n");

        // The last element may be an incomplete line — save it for next chunk
        remainder = lines.pop() || "";

        linesLength.counter += lines.length;

        if (!columns.length) {
          const firstLine = lines.shift();
          columns = firstLine.split(",");
          linesLength.counter--;
        }

        for (const line of lines) {
          if (!line.length) continue;
          const currentItem = {};
          const currentColumnsItems = line.split(",");
          for (const columnIndex in currentColumnsItems) {
            const columnItem = currentColumnsItems[columnIndex];
            currentItem[columns[columnIndex]] = columnItem.trimEnd();
          }
          controller.enqueue(currentItem);
        }
      },
      flush: (controller) => {
        // Process any remaining partial line at the end of the file
        if (remainder.length) {
          linesLength.counter++;
          const currentItem = {};
          const currentColumnsItems = remainder.split(",");
          for (const columnIndex in currentColumnsItems) {
            const columnItem = currentColumnsItems[columnIndex];
            currentItem[columns[columnIndex]] = columnItem.trimEnd();
          }
          controller.enqueue(currentItem);
        }
      },
    });
  }

  #findOcurrencies({ query, onOcurrenceUpdate }) {
    const queryKeys = Object.keys(query);
    let found = {};
    return new WritableStream({
      write(jsonLine) {
        for (const keyIndex in queryKeys) {
          const key = queryKeys[keyIndex];
          const queryValue = query[key];
          found[queryValue] = found[queryValue] ?? 0;
          if (queryValue.test(jsonLine[key])) {
            found[queryValue]++;
            onOcurrenceUpdate(found);
          }
        }
      },
    });
  }

  #setupProgress(totalBytes, onProgress) {
    let totalUploaded = 0;
    onProgress(0);
    return (chunkLength) => {
      totalUploaded += chunkLength;
      const total = (100 / totalBytes) * totalUploaded;
      onProgress(total);
    };
  }
}

