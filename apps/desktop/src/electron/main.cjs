const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { StateStore } = require("./services/state-store.cjs");
const { ApiClient } = require("./services/api-client.cjs");
const { SyncManager } = require("./services/sync-manager.cjs");
const { acquireProfileRuntimeSync, releaseProfileLockSync } = require("./services/profile-runtime.cjs");

const isDev = !app.isPackaged;
const hardStopOnWindowClose = process.platform === "win32";
const appVersion = app.getVersion();

let mainWindow = null;
let isShuttingDown = false;
let shutdownPromise = null;
let profileLockPath = null;

const profileRuntime = acquireProfileRuntimeSync({
  appDataRoot: app.getPath("appData"),
  argv: process.argv,
  env: process.env,
  pid: process.pid,
  exePath: process.execPath
});

if (profileRuntime.status !== "acquired") {
  dialog.showErrorBox(
    "Profile Already Open",
    `The profile "${profileRuntime.profileName}" is already in use. Close that client first or launch another profile.`
  );
  app.exit(1);
}

const profileName = profileRuntime.profileName;
const profileDataRoot = profileRuntime.profileDir;
profileLockPath = profileRuntime.lockPath;

app.setPath("userData", profileDataRoot);
app.setPath("sessionData", path.join(profileDataRoot, "session"));

const stateStore = new StateStore(path.join(app.getPath("userData"), "state.json"), {
  appVersion,
  profileName,
  fallbackPaths: [
    path.join(app.getPath("appData"), "Electron", `${profileName}.json`),
    path.join(app.getPath("appData"), "@syncall", "desktop", `${profileName}.json`),
    ...(profileName === "default"
      ? [
          path.join(app.getPath("appData"), "Electron", "syncall-state.json"),
          path.join(app.getPath("appData"), "@syncall", "desktop", "syncall-state.json")
        ]
      : [])
  ]
});
const apiClient = new ApiClient(stateStore, {
  clientVersion: appVersion,
  clientName: "desktop"
});

function shouldCountAsNotice(type) {
  return [
    "sync:error",
    "sync:uploaded",
    "sync:downloaded",
    "sync:deleted",
    "sync:remote-delete",
    "sync:restore-completed"
  ].includes(type);
}

function getLocalMemberSyncState(roomId) {
  if (!stateStore.getBinding(roomId)) {
    return "OFFLINE";
  }

  return stateStore.getRoomSyncMode(roomId) === "RUNNING" ? "SYNCING" : "PAUSED";
}

function buildRoomStateSummary(roomId) {
  const cachedSummary = stateStore.getRoomStatusCache(roomId);
  if (cachedSummary) {
    return cachedSummary;
  }

  return {
    roomId,
    folderPath: stateStore.getBinding(roomId)?.folderPath ?? null,
    syncMode: stateStore.getRoomSyncMode(roomId),
    memberSyncState: getLocalMemberSyncState(roomId),
    offlineCount: 0,
    remoteCount: 0,
    modifiedLocalCount: 0,
    modifiedRemoteCount: 0,
    runningCount: 0
  };
}

const syncManager = new SyncManager({
  store: stateStore,
  apiClient,
  notify: (type, payload) => {
    if (shouldCountAsNotice(type)) {
      void stateStore.incrementNoticeUnread();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("syncall:event", { type, payload });
    }
  }
});

function ensureRunning() {
  if (isShuttingDown) {
    throw new Error("Syncall is shutting down.");
  }
}

function releaseProfileLock() {
  releaseProfileLockSync(profileLockPath);
  profileLockPath = null;
}

async function performShutdown(reason) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isShuttingDown = true;

  shutdownPromise = (async () => {
    try {
      await syncManager.shutdown();
    } catch (error) {
      console.error(`[syncall] shutdown sync cleanup failed (${reason})`, error);
    }

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const currentWindow = mainWindow;
        mainWindow = null;
        currentWindow.removeAllListeners("close");
        currentWindow.destroy();
      } else {
        mainWindow = null;
      }
    } catch (error) {
      console.error(`[syncall] window destroy failed (${reason})`, error);
    }

    releaseProfileLock();
  })().finally(() => {
    if (hardStopOnWindowClose) {
      setImmediate(() => app.exit(0));
    } else {
      app.quit();
    }
  });

  return shutdownPromise;
}

function bindWindowLifecycle(window) {
  window.on("close", (event) => {
    if (!hardStopOnWindowClose || isShuttingDown) {
      return;
    }

    event.preventDefault();
    void performShutdown("window-close");
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

async function createWindow() {
  ensureRunning();

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

  bindWindowLifecycle(mainWindow);

  if (isDev) {
    await mainWindow.loadURL(process.env.SYNCALL_DESKTOP_DEV_URL ?? "http://localhost:5173");
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function requireSession() {
  ensureRunning();
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

  await syncManager.syncJoinedRooms(rooms.rooms.map((room) => room.id));

  const invitesReadAt = stateStore.getPanelReadAt("invites");
  const activityReadAt = stateStore.getPanelReadAt("activity");

  return {
    rooms: rooms.rooms,
    invites: invites.invites,
    events: events.events,
    users: users.users,
    roomStates: rooms.rooms.map((room) => buildRoomStateSummary(room.id)),
    notifications: {
      invitesUnread: invites.invites.filter((invite) => !invitesReadAt || invite.createdAt > invitesReadAt).length,
      noticesUnread: stateStore.getNoticeUnreadCount(),
      activityUnread: events.events.filter((event) => !activityReadAt || event.createdAt > activityReadAt).length
    },
    bindings: stateStore.getBindings(),
    user: stateStore.getUser(),
    serverUrl: stateStore.getServerUrl(),
    profile: profileName,
    appVersion
  };
}

function buildDesktopState() {
  return {
    ...stateStore.getState(),
    appVersion
  };
}

app.whenReady().then(async () => {
  await stateStore.load();
  if (isShuttingDown) {
    return;
  }
  await syncManager.initialize();
  if (isShuttingDown) {
    return;
  }
  await createWindow();
}).catch((error) => {
  console.error("[syncall] startup failed", error);
  releaseProfileLock();
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }

  if (!isShuttingDown) {
    void performShutdown("window-all-closed");
  }
});

app.on("before-quit", () => {
  isShuttingDown = true;
  releaseProfileLock();
});

app.on("activate", async () => {
  if (process.platform !== "darwin" || isShuttingDown) {
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

ipcMain.handle("syncall:get-state", async () => buildDesktopState());
ipcMain.handle("syncall:get-compatibility", async () => apiClient.getCompatibility());
ipcMain.handle("syncall:set-server-url", async (_event, serverUrl) => {
  ensureRunning();
  await stateStore.setServerUrl(serverUrl);
  return buildDesktopState();
});
ipcMain.handle("syncall:register", async (_event, payload) => {
  ensureRunning();
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
  ensureRunning();
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
  ensureRunning();
  await syncManager.clearSession();
  await stateStore.clearSession();
  return buildDesktopState();
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
  ensureRunning();
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
ipcMain.handle("syncall:list-room-files", async (_event, roomId) => {
  requireSession();
  return {
    files: await syncManager.listRoomFiles(roomId)
  };
});
ipcMain.handle("syncall:start-room-sync", async (_event, roomId) => {
  requireSession();
  await syncManager.startRoomSync(roomId);
  return buildDashboard();
});
ipcMain.handle("syncall:pause-room-sync", async (_event, roomId) => {
  requireSession();
  await syncManager.pauseRoomSync(roomId);
  return buildDashboard();
});
ipcMain.handle("syncall:sync-file", async (_event, roomId, relativePath) => {
  requireSession();
  return {
    files: await syncManager.syncFile(roomId, relativePath)
  };
});
ipcMain.handle("syncall:sync-all-offline", async (_event, roomId) => {
  requireSession();
  return {
    files: await syncManager.syncAllOffline(roomId)
  };
});
ipcMain.handle("syncall:resolve-modified-local", async (_event, roomId, relativePath) => {
  requireSession();
  return {
    files: await syncManager.resolveModifiedLocal(roomId, relativePath)
  };
});
ipcMain.handle("syncall:resolve-modified-remote", async (_event, roomId, relativePath) => {
  requireSession();
  return {
    files: await syncManager.resolveModifiedRemote(roomId, relativePath)
  };
});
ipcMain.handle("syncall:mark-panel-read", async (_event, panelId) => {
  ensureRunning();
  await stateStore.markPanelRead(panelId);
  return { success: true };
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
