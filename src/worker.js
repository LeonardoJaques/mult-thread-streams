import Service from "./service.js";

console.log("I'm alive");
const service = new Service();
postMessage({ eventType: "alive" });

onmessage = ({ data }) => {
  const { query, file } = data;
  service.processFile({
    query,
    file,
    onMatchFound: (result) => {
      postMessage({ eventType: "onMatchFound", ...result });
    },
    onProgress: (total) => postMessage({ eventType: "progress", total }),
    onDone: (result) => postMessage({ eventType: "done", ...result }),
  });
};
