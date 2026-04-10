const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { StateStore } = require("./services/state-store.cjs");
const { ApiClient } = require("./services/api-client.cjs");
const { SyncManager } = require("./services/sync-manager.cjs");

const isDev = !app.isPackaged;
let mainWindow = null;

function resolveProfileName() {
  const profileArgument = process.argv.find((value) => value.startsWith("--profile="));
  if (!profileArgument) {
    return "default";
  }

  const value = profileArgument.slice("--profile=".length).trim();
  return value || "default";
}

const profileName = resolveProfileName();
const appDataRoot = app.getPath("appData");
const profileDataRoot = path.join(appDataRoot, "Syncall Desktop", "profiles", profileName);

app.setPath("userData", profileDataRoot);
app.setPath("sessionData", path.join(profileDataRoot, "session"));

const stateStore = new StateStore(path.join(app.getPath("userData"), "state.json"), {
  fallbackPaths: [
    path.join(appDataRoot, "Electron", `${profileName}.json`),
    path.join(appDataRoot, "@syncall", "desktop", `${profileName}.json`),
    ...(profileName === "default"
      ? [
          path.join(appDataRoot, "Electron", "syncall-state.json"),
          path.join(appDataRoot, "@syncall", "desktop", "syncall-state.json")
        ]
      : [])
  ]
});
const apiClient = new ApiClient(stateStore);
const syncManager = new SyncManager({
  store: stateStore,
  apiClient,
  notify: (type, payload) => {
    if (mainWindow) {
      mainWindow.webContents.send("syncall:event", { type, payload });
    }
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#0f172a",
    title: `Syncall Desktop (${profileName})`,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.SYNCALL_DESKTOP_DEV_URL ?? "http://localhost:5173");
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function requireSession() {
  if (!stateStore.getToken()) {
    throw new Error("Please sign in first.");
  }
}

async function buildDashboard() {
  requireSession();
  const [rooms, invites, events, users] = await Promise.all([
    apiClient.listRooms(),
    apiClient.listInvites(),
    apiClient.listActivity(),
    apiClient.listUsers()
  ]);

  return {
    rooms: rooms.rooms,
    invites: invites.invites,
    events: events.events,
    users: users.users,
    bindings: stateStore.getBindings(),
    user: stateStore.getUser(),
    serverUrl: stateStore.getServerUrl(),
    profile: profileName
  };
}

app.whenReady().then(async () => {
  await stateStore.load();
  await syncManager.initialize();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

ipcMain.handle("syncall:get-state", async () => stateStore.getState());
ipcMain.handle("syncall:set-server-url", async (_event, serverUrl) => {
  await stateStore.setServerUrl(serverUrl);
  return stateStore.getState();
});
ipcMain.handle("syncall:register", async (_event, payload) => {
  const response = await apiClient.register(payload);
  await stateStore.setSession({
    token: response.token,
    user: response.user,
    serverUrl: stateStore.getServerUrl()
  });
  await syncManager.updateSession();
  return buildDashboard();
});
ipcMain.handle("syncall:login", async (_event, payload) => {
  const response = await apiClient.login(payload);
  await stateStore.setSession({
    token: response.token,
    user: response.user,
    serverUrl: stateStore.getServerUrl()
  });
  await syncManager.updateSession();
  return buildDashboard();
});
ipcMain.handle("syncall:logout", async () => {
  await syncManager.clearSession();
  await stateStore.clearSession();
  return stateStore.getState();
});
ipcMain.handle("syncall:fetch-dashboard", async () => buildDashboard());
ipcMain.handle("syncall:create-room", async (_event, name) => {
  requireSession();
  await apiClient.createRoom(name);
  return buildDashboard();
});
ipcMain.handle("syncall:invite-user", async (_event, roomId, username) => {
  requireSession();
  await apiClient.createInvite(roomId, username);
  return buildDashboard();
});
ipcMain.handle("syncall:accept-invite", async (_event, inviteId) => {
  requireSession();
  await apiClient.acceptInvite(inviteId);
  return buildDashboard();
});
ipcMain.handle("syncall:list-room-members", async (_event, roomId) => {
  requireSession();
  return apiClient.listRoomMembers(roomId);
});
ipcMain.handle("syncall:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("syncall:bind-folder", async (_event, roomId, folderPath) => {
  requireSession();
  await syncManager.bindFolder(roomId, folderPath);
  return buildDashboard();
});
ipcMain.handle("syncall:list-history", async (_event, roomId, relativePath) => {
  requireSession();
  return apiClient.listHistory(roomId, relativePath);
});
ipcMain.handle("syncall:restore-version", async (_event, roomId, versionId) => {
  requireSession();
  const response = await apiClient.restoreVersion(roomId, versionId);
  return response.version;
});
