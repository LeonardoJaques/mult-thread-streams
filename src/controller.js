export default class Controller {
  #view;
  #worker;
  #service;
  #events = {
    alive: () => {},
    progress: ({ total }) => {
      this.#view.updateProgress(total);
    },
    onOcurrenceUpdate: ({ found, linesLength, took }) => {
      const [[key, value]] = Object.entries(found);
      this.#view.updateDebugLog(
        `Found ${value} occurrences of ${key} | Over - ${linesLength} lines | Times in ${took}`
      );
    },
  };

  constructor({ view, worker, service }) {
    this.#view = view;
    this.#service = service;
    this.#worker = this.#configureWorker(worker);
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
    query["call description"] = new RegExp(description, "i");
    if (this.#view.isWorkerEnabled()) {
      console.log("executing on worker thread");
      this.#worker.postMessage({ query, file });
      return;
    }
    console.log("executing on main thread");
    this.#service.processFile({
      query,
      file,
      onProgress: (total) => {
        this.#events.progress({ total });
      },
      onOcurrenceUpdate: (...args) => {
        this.#events.onOcurrenceUpdate(...args);
      },
    });
  }
  #configureWorker(worker) {
    worker.onmessage = ({ data }) => this.#events[data.eventType](data);
    return worker;
  }
}
