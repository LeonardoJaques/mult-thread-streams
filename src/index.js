import Controller from "./controller.js";
import Service from "./service.js";
import View from "./view.js";

//worker modules just run in chrome.
// import and export doesn't work
const worker = new Worker("./src/worker.js", {
  type: "module",
});

Controller.init({
  view: new View(),
  service: new Service(),
  worker,
});
