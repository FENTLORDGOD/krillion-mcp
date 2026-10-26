const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bot", {
  start: (opts) => ipcRenderer.invoke("start", opts),
  stop: () => ipcRenderer.invoke("stop"),
  search: (q) => ipcRenderer.invoke("search", q),
  stats: () => ipcRenderer.invoke("stats"),
  on: (fn) => ipcRenderer.on("bot", (_e, msg) => fn(msg)),
});
