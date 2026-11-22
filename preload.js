const { contextBridge, ipcRenderer } = require("electron");
const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("api", {
  state: call("state"), markGuideSeen: call("guide-seen"), columns: call("columns"), key: call("key"),
  pickExe: call("pick-exe"), save: call("save"), remove: call("remove"), launch: call("launch"),
  addFolder: call("folder-add"), removeFolder: call("folder-remove"), scan: call("scan"),
  findCover: call("find-cover"), missingCovers: call("missing-covers"),
  onUpdate: callback => { ipcRenderer.on("update", (_, update) => callback(update)); }
});
