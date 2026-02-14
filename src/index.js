import Controller from "./controller.js";
import Service from "./service.js";
import View from "./view.js";

Controller.init({
  view: new View(),
  service: new Service(),
});
