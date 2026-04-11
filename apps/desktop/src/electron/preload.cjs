const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("syncall", {
  getState: () => ipcRenderer.invoke("syncall:get-state"),
  getCompatibility: () => ipcRenderer.invoke("syncall:get-compatibility"),
  setServerUrl: (serverUrl) => ipcRenderer.invoke("syncall:set-server-url", serverUrl),
  register: (payload) => ipcRenderer.invoke("syncall:register", payload),
  login: (payload) => ipcRenderer.invoke("syncall:login", payload),
  logout: () => ipcRenderer.invoke("syncall:logout"),
  fetchDashboard: () => ipcRenderer.invoke("syncall:fetch-dashboard"),
  createRoom: (name) => ipcRenderer.invoke("syncall:create-room", name),
  inviteUser: (roomId, username) => ipcRenderer.invoke("syncall:invite-user", roomId, username),
  acceptInvite: (inviteId) => ipcRenderer.invoke("syncall:accept-invite", inviteId),
  listRoomMembers: (roomId) => ipcRenderer.invoke("syncall:list-room-members", roomId),
  chooseFolder: () => ipcRenderer.invoke("syncall:choose-folder"),
  bindFolder: (roomId, folderPath) => ipcRenderer.invoke("syncall:bind-folder", roomId, folderPath),
  listRoomFiles: (roomId) => ipcRenderer.invoke("syncall:list-room-files", roomId),
  startRoomSync: (roomId) => ipcRenderer.invoke("syncall:start-room-sync", roomId),
  pauseRoomSync: (roomId) => ipcRenderer.invoke("syncall:pause-room-sync", roomId),
  syncFile: (roomId, relativePath) => ipcRenderer.invoke("syncall:sync-file", roomId, relativePath),
  syncAllOffline: (roomId) => ipcRenderer.invoke("syncall:sync-all-offline", roomId),
  resolveModifiedLocal: (roomId, relativePath) => ipcRenderer.invoke("syncall:resolve-modified-local", roomId, relativePath),
  resolveModifiedRemote: (roomId, relativePath) => ipcRenderer.invoke("syncall:resolve-modified-remote", roomId, relativePath),
  markPanelRead: (panelId) => ipcRenderer.invoke("syncall:mark-panel-read", panelId),
  listHistory: (roomId, relativePath) => ipcRenderer.invoke("syncall:list-history", roomId, relativePath),
  restoreVersion: (roomId, versionId) => ipcRenderer.invoke("syncall:restore-version", roomId, versionId),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("syncall:event", listener);
    return () => ipcRenderer.removeListener("syncall:event", listener);
  }
});
