import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("syncall", {
  getState: () => ipcRenderer.invoke("syncall:get-state"),
  setServerUrl: (serverUrl) => ipcRenderer.invoke("syncall:set-server-url", serverUrl),
  register: (payload) => ipcRenderer.invoke("syncall:register", payload),
  login: (payload) => ipcRenderer.invoke("syncall:login", payload),
  logout: () => ipcRenderer.invoke("syncall:logout"),
  fetchDashboard: () => ipcRenderer.invoke("syncall:fetch-dashboard"),
  createRoom: (name) => ipcRenderer.invoke("syncall:create-room", name),
  inviteUser: (roomId, username) => ipcRenderer.invoke("syncall:invite-user", roomId, username),
  acceptInvite: (inviteId) => ipcRenderer.invoke("syncall:accept-invite", inviteId),
  chooseFolder: () => ipcRenderer.invoke("syncall:choose-folder"),
  bindFolder: (roomId, folderPath) => ipcRenderer.invoke("syncall:bind-folder", roomId, folderPath),
  listHistory: (roomId, relativePath) => ipcRenderer.invoke("syncall:list-history", roomId, relativePath),
  restoreVersion: (roomId, versionId) => ipcRenderer.invoke("syncall:restore-version", roomId, versionId),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("syncall:event", listener);
    return () => ipcRenderer.removeListener("syncall:event", listener);
  }
});
