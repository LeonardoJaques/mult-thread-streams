export default class Controller {
  #view;
  #service;
  #activeWorkers = [];

  constructor({ view, service }) {
    this.#view = view;
    this.#service = service;
  }

  static init(dps) {
    const controller = new Controller(dps);
    controller.init();
    return controller;
  }

  init() {
    this.#view.configureOnFileChange(this.#configureOnFileChange.bind(this));
    this.#view.configureOnFormSubmit(this.#configureOnFormSubmit.bind(this));
  }

  #escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  #formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    for (i; bytes >= 1024 && i < 4; i++) {
      bytes /= 1024;
    }
    return `${bytes.toFixed(2)} ${units[i]}`;
  }

  #configureOnFileChange(file) {
    this.#view.setFileSize(this.#formatBytes(file.size));
  }

  #configureOnFormSubmit({ description, file }) {
    const query = {};
    const escapedDescription = this.#escapeRegExp(description);
    try {
      query["call description"] = new RegExp(escapedDescription, "i");
    } catch (e) {
      this.#view.updateDebugLog(`❌ Invalid search term: ${e.message}`);
      return;
    }

    this.#view.setProcessing(true);
    this.#view.updateProgress(0);

    if (this.#view.isWorkerEnabled()) {
      const threadCount = this.#view.getThreadCount();
      console.log(`executing on ${threadCount} worker thread(s)`);
      this.#processWithWorkers(query, file, threadCount);
      return;
    }

    console.log("executing on main thread");
    const startedAt = performance.now();
    const elapsed = () =>
      `${((performance.now() - startedAt) / 1000).toFixed(2)} secs`;

    this.#service.processFile({
      query,
      file,
      onProgress: (total) => {
        this.#view.updateProgress(total);
      },
      onOcurrenceUpdate: ({ found, linesLength, took }) => {
        const [[key, value]] = Object.entries(found);
        this.#view.updateDebugLog(
          `Found ${value} occurrences of ${key} | Over - ${linesLength} lines | Took ${took}`
        );
      },
      onDone: ({ linesLength }) => {
        this.#view.updateDebugLog(
          `\n✅ Processing complete! ${linesLength} lines in ${elapsed()}`,
          false
        );
        this.#view.setProcessing(false);
      },
    });
  }

  async #processWithWorkers(query, file, threadCount) {
    // Terminate any previous workers
    this.#terminateWorkers();

    const startedAt = performance.now();
    const elapsed = () =>
      `${((performance.now() - startedAt) / 1000).toFixed(2)} secs`;

    // Read full file and split into lines
    const text = await file.text();
    const allLines = text.split("\n");
    const header = allLines.shift();
    const dataLines = allLines.filter((l) => l.length > 0);
    const totalDataLines = dataLines.length;

    // Adjust thread count if more threads than lines
    const actualThreads = Math.min(threadCount, totalDataLines);
    if (actualThreads === 0) {
      this.#view.updateDebugLog("⚠️ No data lines found in the file.");
      this.#view.setProcessing(false);
      return;
    }

    this.#view.updateDebugLog(
      `🔄 Distributing ${totalDataLines} lines across ${actualThreads} worker(s)...\n`
    );

    const chunkSize = Math.ceil(totalDataLines / actualThreads);
    let completedWorkers = 0;
    const workerProgress = new Array(actualThreads).fill(0);
    const workerFoundCounts = new Array(actualThreads).fill(0);
    let queryLabel = "";

    for (let i = 0; i < actualThreads; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalDataLines);
      const workerLines = dataLines.slice(start, end);
      const workerText = header + "\n" + workerLines.join("\n");
      const workerBlob = new Blob([workerText], { type: "text/csv" });
      const workerFile = new File([workerBlob], `chunk-${i}.csv`);

      const worker = new Worker("./src/worker.js", { type: "module" });
      const workerIndex = i;
      const workerLineCount = workerLines.length;

      worker.onmessage = ({ data }) => {
        switch (data.eventType) {
          case "alive":
            break;

          case "progress":
            workerProgress[workerIndex] = data.total;
            const avgProgress =
              workerProgress.reduce((a, b) => a + b, 0) / actualThreads;
            this.#view.updateProgress(avgProgress);
            break;

          case "onOcurrenceUpdate": {
            const [[key, value]] = Object.entries(data.found);
            workerFoundCounts[workerIndex] = value;
            if (!queryLabel) queryLabel = key;
            break;
          }

          case "done":
            completedWorkers++;
            this.#view.updateDebugLog(
              `  Worker ${workerIndex + 1}: Found ${workerFoundCounts[workerIndex]} of ${queryLabel} in ${workerLineCount} lines | ${data.took}\n`,
              false
            );
            console.log(
              `Worker ${workerIndex + 1} done (${completedWorkers}/${actualThreads})`
            );

            if (completedWorkers === actualThreads) {
              const totalFound = workerFoundCounts.reduce((a, b) => a + b, 0);
              this.#view.updateProgress(100);
              this.#view.updateDebugLog(
                `\n✅ All ${actualThreads} workers complete! Found ${totalFound} total | ${totalDataLines} lines in ${elapsed()}`,
                false
              );
              this.#view.setProcessing(false);
              this.#terminateWorkers();
            }
            break;

          default:
            console.warn("Unknown worker event:", data.eventType);
        }
      };

      worker.onerror = (error) => {
        console.error(`Worker ${workerIndex + 1} error:`, error);
        this.#view.updateDebugLog(
          `\n❌ Worker ${workerIndex + 1} error: ${error.message}`,
          false
        );
      };

      this.#activeWorkers.push(worker);
      worker.postMessage({ query, file: workerFile });
    }
  }

  #terminateWorkers() {
    for (const worker of this.#activeWorkers) {
      worker.terminate();
    }
    this.#activeWorkers = [];
  }
}

