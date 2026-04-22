const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const chokidar = require("chokidar");
const { io } = require("socket.io-client");

const BUILT_IN_IGNORED_PATTERNS = [/^\.syncall(\/|\\|$)/, /\.tmp$/i, /\.swp$/i, /~$/, /\.jcl\.log$/i];
const MAX_ORIGINAL_FILE_BYTES = 200 * 1024 * 1024;
const DEFAULT_UPLOAD_IDLE_MS = 4000;

function normalizeRelativePath(input) {
  return input.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function walkFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else {
        results.push(absolutePath);
      }
    }
  }

  return results;
}

function summarizeRoomStatuses(roomId, folderPath, syncMode, memberSyncState, statuses) {
  const summary = {
    roomId,
    folderPath: folderPath ?? null,
    syncMode,
    memberSyncState,
    offlineCount: 0,
    remoteCount: 0,
    modifiedLocalCount: 0,
    modifiedRemoteCount: 0,
    runningCount: 0
  };

  for (const status of statuses) {
    if (status.status === "OFFLINE") {
      summary.offlineCount += 1;
    } else if (status.status === "REMOTE") {
      summary.remoteCount += 1;
    } else if (status.status === "MODIFIED_LOCAL") {
      summary.modifiedLocalCount += 1;
    } else if (status.status === "MODIFIED_REMOTE") {
      summary.modifiedRemoteCount += 1;
    } else if (status.status === "RUNNING") {
      summary.runningCount += 1;
    }
  }

  return summary;
}

function deriveFileStatus({
  hasLocalFile,
  hasRemoteFile,
  isRunning,
  localChecksum,
  remoteChecksum,
  matchedVersionId,
  remoteVersionId
}) {
  if (isRunning && hasLocalFile) {
    return "RUNNING";
  }

  if (hasLocalFile && !hasRemoteFile) {
    return "OFFLINE";
  }

  if (!hasLocalFile && hasRemoteFile) {
    return "REMOTE";
  }

  if (!hasLocalFile && !hasRemoteFile) {
    return "REMOTE";
  }

  if (localChecksum === remoteChecksum) {
    return "SYNCED";
  }

  if (matchedVersionId && remoteVersionId && matchedVersionId !== remoteVersionId) {
    return "MODIFIED_REMOTE";
  }

  if (matchedVersionId && remoteVersionId && matchedVersionId === remoteVersionId) {
    return "SYNCED";
  }

  return "MODIFIED_LOCAL";
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readChecksum(absolutePath) {
  const fileBytes = await fs.readFile(absolutePath);
  return createHash("sha256").update(fileBytes).digest("hex");
}

function shouldNotifyRoomFileRefresh(previousFile, nextFile) {
  if (!previousFile && !nextFile) {
    return false;
  }

  if (!previousFile || !nextFile) {
    return true;
  }

  return previousFile.status !== nextFile.status ||
    previousFile.localExists !== nextFile.localExists ||
    previousFile.remoteExists !== nextFile.remoteExists ||
    previousFile.ownerUsername !== nextFile.ownerUsername ||
    previousFile.localSize !== nextFile.localSize ||
    previousFile.remoteSize !== nextFile.remoteSize ||
    previousFile.localModifiedAt !== nextFile.localModifiedAt ||
    previousFile.remoteModifiedAt !== nextFile.remoteModifiedAt ||
    previousFile.currentVersionId !== nextFile.currentVersionId ||
    previousFile.currentVersionNumber !== nextFile.currentVersionNumber;
}

class SyncManager {
  constructor({ store, apiClient, notify, uploadIdleMs = DEFAULT_UPLOAD_IDLE_MS }) {
    this.store = store;
    this.apiClient = apiClient;
    this.notify = notify;
    this.uploadIdleMs = uploadIdleMs;
    this.watchers = new Map();
    this.suppressed = new Map();
    this.pendingUploads = new Map();
    this.socket = null;
    this.isShuttingDown = false;
    this.runningFiles = new Map();
    this.roomStatusLists = new Map();
    this.historyCache = new Map();
  }

  async initialize() {
    if (this.isShuttingDown || !this.store.getToken()) {
      return;
    }

    await this.connectSocket();
    await this.restoreKnownRooms();
  }

  async updateSession() {
    if (this.isShuttingDown) {
      return;
    }

    await this.stopRuntime();
    if (!this.store.getToken()) {
      return;
    }

    await this.connectSocket();
    await this.restoreKnownRooms();
  }

  async stopRuntime() {
    this.clearPendingUploads();
    this.clearAllRunningFiles();

    for (const roomId of [...this.watchers.keys()]) {
      await this.stopWatcher(roomId);
    }

    await this.disconnectSocket();
  }

  async clearSession() {
    await this.stopRuntime();
    this.roomStatusLists.clear();
    this.historyCache.clear();
    this.isShuttingDown = false;
  }

  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    await this.stopRuntime();
  }

  isIgnored(relativePath) {
    return BUILT_IN_IGNORED_PATTERNS.some((pattern) => pattern.test(relativePath));
  }

  suppressionKey(roomId, relativePath) {
    return `${roomId}:${relativePath}`;
  }

  getRoomRunningFiles(roomId) {
    let roomFiles = this.runningFiles.get(roomId);
    if (!roomFiles) {
      roomFiles = new Set();
      this.runningFiles.set(roomId, roomFiles);
    }
    return roomFiles;
  }

  markFileRunning(roomId, relativePath) {
    this.getRoomRunningFiles(roomId).add(relativePath);
  }

  clearFileRunning(roomId, relativePath) {
    const roomFiles = this.runningFiles.get(roomId);
    if (!roomFiles) {
      return;
    }

    roomFiles.delete(relativePath);
    if (roomFiles.size === 0) {
      this.runningFiles.delete(roomId);
    }
  }

  clearAllRunningFiles(roomId = null) {
    if (!roomId) {
      this.runningFiles.clear();
      return;
    }

    this.runningFiles.delete(roomId);
  }

  clearPendingUploads(roomId = null) {
    for (const [key, timeout] of this.pendingUploads.entries()) {
      if (roomId && !key.startsWith(`${roomId}:`)) {
        continue;
      }

      clearTimeout(timeout);
      this.pendingUploads.delete(key);
    }
  }

  cancelPendingUpload(roomId, relativePath) {
    const key = this.suppressionKey(roomId, relativePath);
    const timeout = this.pendingUploads.get(key);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.pendingUploads.delete(key);
  }

  isSuppressed(roomId, relativePath) {
    const key = this.suppressionKey(roomId, relativePath);
    const deadline = this.suppressed.get(key);
    if (!deadline) {
      return false;
    }
    if (deadline < Date.now()) {
      this.suppressed.delete(key);
      return false;
    }
    return true;
  }

  suppress(roomId, relativePath, milliseconds = 2000) {
    this.suppressed.set(this.suppressionKey(roomId, relativePath), Date.now() + milliseconds);
  }

  getKnownRoomIds() {
    return [...new Set([...this.store.getJoinedRooms(), ...Object.keys(this.store.getBindings())])];
  }

  getLocalMemberSyncState(roomId) {
    if (!this.store.getBinding(roomId)) {
      return "OFFLINE";
    }

    return this.store.getRoomSyncMode(roomId) === "RUNNING" ? "SYNCING" : "PAUSED";
  }

  async connectSocket() {
    if (this.isShuttingDown) {
      return;
    }

    const token = this.store.getToken();
    if (!token) {
      return;
    }

    this.socket = io(this.store.getServerUrl(), {
      autoConnect: true,
      auth: { token }
    });

    this.socket.on("connect", async () => {
      try {
        await this.announceKnownRooms();
        await this.restoreKnownRooms();
        if (!this.isShuttingDown) {
          this.notify("socket:connected", { connected: true });
        }
      } catch (error) {
        this.handleSyncError("connect", "socket", this.store.getServerUrl(), error);
      }
    });

    this.socket.on("disconnect", () => {
      if (!this.isShuttingDown) {
        this.notify("socket:disconnected", { connected: false });
      }
    });

    this.socket.on("presence:update", (payload) => {
      if (!this.isShuttingDown) {
        this.notify("presence:update", payload);
      }
    });

    this.socket.on("sync:file-updated", (payload) => {
      void this.handleRemoteFileUpdated(payload).catch((error) => {
        this.handleSyncError("remote-update", payload.roomId, payload.relativePath, error);
      });
    });

    this.socket.on("sync:restore-completed", (payload) => {
      void this.handleRemoteFileUpdated(payload).catch((error) => {
        this.handleSyncError("restore-download", payload.roomId, payload.relativePath, error);
      });
    });

    this.socket.on("sync:file-deleted", (payload) => {
      void this.handleRemoteFileDeleted(payload).catch((error) => {
        this.handleSyncError("remote-delete", payload.roomId, payload.relativePath, error);
      });
    });

    this.socket.on("sync:status-changed", (payload) => {
      if (!this.isShuttingDown) {
        this.invalidateHistoryCache(payload.roomId, payload.relativePath);
        this.notify("sync:status-changed", payload);
      }
    });

    this.socket.on("invite:received", (payload) => {
      if (!this.isShuttingDown) {
        this.notify("invite:received", payload);
      }
    });

    this.socket.on("sync:error", (payload) => {
      if (!this.isShuttingDown) {
        this.notify("sync:error", payload);
      }
    });
  }

  async disconnectSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  async restoreKnownRooms() {
    for (const roomId of this.getKnownRoomIds()) {
      if (this.isShuttingDown) {
        return;
      }

      await this.refreshRoomStatus(roomId);
    }
  }

  async announceKnownRooms() {
    if (!this.socket || this.isShuttingDown) {
      return;
    }

    for (const roomId of this.getKnownRoomIds()) {
      this.socket.emit("room:join", {
        roomId,
        syncState: this.getLocalMemberSyncState(roomId)
      });
    }
  }

  async syncJoinedRooms(roomIds) {
    const previousRooms = new Set(this.store.getJoinedRooms());
    const nextRooms = [...new Set(roomIds.filter(Boolean))];
    const nextRoomSet = new Set(nextRooms);
    const addedRooms = nextRooms.filter((roomId) => !previousRooms.has(roomId));

    await this.store.setJoinedRooms(nextRooms);

    for (const roomId of previousRooms) {
      if (!nextRoomSet.has(roomId)) {
        await this.pauseRoomSync(roomId);
        if (this.socket) {
          this.socket.emit("room:leave", roomId);
        }
      }
    }

    if (this.socket && !this.isShuttingDown) {
      for (const roomId of addedRooms) {
        this.socket.emit("room:join", {
          roomId,
          syncState: this.getLocalMemberSyncState(roomId)
        });
      }
    }

    for (const roomId of addedRooms) {
      if (this.store.getBinding(roomId)) {
        await this.refreshRoomStatus(roomId);
      }
    }
  }

  handleSyncError(action, roomId, absolutePath, error) {
    if (this.isShuttingDown) {
      return;
    }

    this.notify("sync:error", {
      action,
      roomId,
      path: absolutePath,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  historyCacheKey(roomId, relativePath) {
    return `${roomId}:${relativePath}`;
  }

  invalidateHistoryCache(roomId = null, relativePath = null) {
    if (!roomId) {
      this.historyCache.clear();
      return;
    }

    if (!relativePath) {
      for (const key of [...this.historyCache.keys()]) {
        if (key.startsWith(`${roomId}:`)) {
          this.historyCache.delete(key);
        }
      }
      return;
    }

    this.historyCache.delete(this.historyCacheKey(roomId, relativePath));
  }

  async getHistoryVersions(roomId, relativePath) {
    const cacheKey = this.historyCacheKey(roomId, relativePath);
    const cached = this.historyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.apiClient.listHistory(roomId, relativePath);
    this.historyCache.set(cacheKey, response.versions);
    return response.versions;
  }

  async bindFolder(roomId, folderPath) {
    if (this.isShuttingDown) {
      return this.store.getBinding(roomId);
    }

    await this.store.setBinding(roomId, { folderPath });
    await this.store.setRoomSyncMode(roomId, "PAUSED");
    await this.syncJoinedRooms([...this.getKnownRoomIds(), roomId]);
    await this.stopWatcher(roomId);
    await this.refreshRoomStatus(roomId);
    return this.store.getBinding(roomId);
  }

  async startRoomSync(roomId) {
    if (this.isShuttingDown) {
      return [];
    }

    const binding = this.store.getBinding(roomId);
    if (!binding) {
      throw new Error("Bind a local folder before starting sync.");
    }

    await this.store.setRoomSyncMode(roomId, "RUNNING");
    await this.startWatcher(roomId, binding.folderPath);
    if (this.socket) {
      this.socket.emit("room:sync-state", {
        roomId,
        syncState: this.getLocalMemberSyncState(roomId)
      });
    }
    await this.downloadRemoteOnlyFiles(roomId);
    return this.refreshRoomStatus(roomId);
  }

  async pauseRoomSync(roomId) {
    await this.store.setRoomSyncMode(roomId, "PAUSED");
    await this.stopWatcher(roomId);
    this.clearAllRunningFiles(roomId);
    if (this.socket && !this.isShuttingDown) {
      this.socket.emit("room:sync-state", {
        roomId,
        syncState: this.getLocalMemberSyncState(roomId)
      });
    }

    if (this.store.getBinding(roomId)) {
      await this.refreshRoomStatus(roomId);
    }
  }

  async startWatcher(roomId, folderPath) {
    if (this.isShuttingDown) {
      return;
    }

    await this.stopWatcher(roomId);

    const watcher = chokidar.watch(folderPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      }
    });

    watcher.on("add", (absolutePath) => {
      void this.handleLocalChange(roomId, folderPath, absolutePath);
    });
    watcher.on("change", (absolutePath) => {
      void this.handleLocalChange(roomId, folderPath, absolutePath);
    });
    watcher.on("unlink", (absolutePath) => {
      void this.handleLocalDelete(roomId, folderPath, absolutePath);
    });

    this.watchers.set(roomId, watcher);
  }

  async stopWatcher(roomId) {
    this.clearPendingUploads(roomId);
    this.clearAllRunningFiles(roomId);
    const watcher = this.watchers.get(roomId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(roomId);
    }
  }

  async handleLocalChange(roomId, folderPath, absolutePath) {
    if (this.isShuttingDown) {
      return;
    }

    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }

    const previousStatuses = this.getCachedRoomStatuses(roomId);
    const previousFile = previousStatuses.find((entry) => entry.relativePath === relativePath) ?? null;
    const statuses = await this.refreshRoomStatus(roomId);
    const file = statuses.find((entry) => entry.relativePath === relativePath) ?? null;
    if (!file) {
      if (shouldNotifyRoomFileRefresh(previousFile, null)) {
        this.notify("sync:status-changed", { roomId, relativePath, status: null });
      }
      return;
    }

    const existedBefore = Boolean(previousFile);
    const hasTrackedRemoteVersion = Boolean(file.remoteExists || this.store.getVersionHead(roomId, relativePath));
    if (!hasTrackedRemoteVersion) {
      if (!existedBefore && file.status === "OFFLINE" && this.store.getRoomSyncMode(roomId) === "RUNNING") {
        this.scheduleUpload(roomId, folderPath, absolutePath, { uploadAfterQuiet: true });
        return;
      }

      if (shouldNotifyRoomFileRefresh(previousFile, file)) {
        this.notify("sync:status-changed", { roomId, relativePath, status: file.status });
      }
      return;
    }

    if (file.status === "SYNCED" || file.status === "OFFLINE" || file.status === "REMOTE") {
      if (shouldNotifyRoomFileRefresh(previousFile, file)) {
        this.notify("sync:status-changed", { roomId, relativePath, status: file.status });
      }
      return;
    }

    this.scheduleUpload(roomId, folderPath, absolutePath, { uploadAfterQuiet: false });
  }

  async handleLocalDelete(roomId, folderPath, absolutePath) {
    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    this.cancelPendingUpload(roomId, relativePath);
    this.clearFileRunning(roomId, relativePath);
    if (!relativePath || this.isIgnored(relativePath)) {
      return;
    }

    const previousStatuses = this.getCachedRoomStatuses(roomId);
    const previousFile = previousStatuses.find((entry) => entry.relativePath === relativePath) ?? null;
    const statuses = await this.refreshRoomStatus(roomId);
    const file = statuses.find((entry) => entry.relativePath === relativePath) ?? null;

    if (shouldNotifyRoomFileRefresh(previousFile, file)) {
      this.notify("sync:status-changed", {
        roomId,
        relativePath,
        status: file?.status ?? null
      });
    }
  }

  scheduleUpload(roomId, folderPath, absolutePath, options = {}) {
    if (this.isShuttingDown) {
      return;
    }

    const uploadAfterQuiet = options.uploadAfterQuiet === true;

    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }

    const key = this.suppressionKey(roomId, relativePath);
    const existingTimeout = this.pendingUploads.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    this.markFileRunning(roomId, relativePath);
    this.notify("sync:status-changed", { roomId, relativePath, status: "RUNNING" });

    const timeout = setTimeout(() => {
      if (this.isShuttingDown) {
        this.pendingUploads.delete(key);
        this.clearFileRunning(roomId, relativePath);
        return;
      }

      this.pendingUploads.delete(key);

      if (uploadAfterQuiet) {
        void this.uploadFromPath(roomId, folderPath, absolutePath).catch((error) => {
          this.handleSyncError("upload", roomId, absolutePath, error);
        }).finally(() => {
          this.clearFileRunning(roomId, relativePath);
          void this.refreshRoomStatus(roomId);
        });
        return;
      }

      this.clearFileRunning(roomId, relativePath);
      void this.refreshRoomStatus(roomId).then((statuses) => {
        const file = statuses.find((entry) => entry.relativePath === relativePath);
        this.notify("sync:status-changed", {
          roomId,
          relativePath,
          status: file?.status ?? "REMOTE"
        });
      }).catch((error) => {
        this.handleSyncError("refresh-status", roomId, absolutePath, error);
      });
    }, this.uploadIdleMs);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    this.pendingUploads.set(key, timeout);
  }

  async uploadFromPath(roomId, folderPath, absolutePath) {
    if (this.isShuttingDown) {
      return;
    }

    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }

    const fileBytes = await fs.readFile(absolutePath);
    if (this.isShuttingDown) {
      return;
    }

    if (fileBytes.byteLength > MAX_ORIGINAL_FILE_BYTES) {
      throw new Error(
        `File exceeds the 200 MB upload limit: ${relativePath} (${fileBytes.byteLength} bytes).`
      );
    }

    const compressedBytes = gzipSync(fileBytes);
    const checksum = createHash("sha256").update(fileBytes).digest("hex");
    const baseVersionId = this.store.getVersionHead(roomId, relativePath);
    const fileStat = await fs.stat(absolutePath);
    const response = await this.apiClient.uploadFile(roomId, {
      relativePath,
      checksum,
      originalSize: fileBytes.byteLength,
      compressedSize: compressedBytes.byteLength,
      clientModifiedAt: fileStat.mtime.toISOString(),
      compressedBytes,
      baseVersionId
    });

    if (this.isShuttingDown) {
      return;
    }

    await this.store.setVersionHead(roomId, response.version.relativePath, response.version.id);
    this.invalidateHistoryCache(roomId, response.version.relativePath);
    this.notify("sync:uploaded", response.version);
  }

  async applyRemoteUpdate(payload) {
    if (this.isShuttingDown) {
      return;
    }

    const binding = this.store.getBinding(payload.roomId);
    if (!binding) {
      return;
    }

    const fileBytes = await this.apiClient.downloadVersion(payload.roomId, payload.versionId);
    if (this.isShuttingDown) {
      return;
    }

    const absolutePath = path.join(binding.folderPath, ...payload.relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    this.suppress(payload.roomId, payload.relativePath);
    await fs.writeFile(absolutePath, fileBytes);
    if (this.isShuttingDown) {
      return;
    }
    await this.store.setVersionHead(payload.roomId, payload.relativePath, payload.versionId);
    this.invalidateHistoryCache(payload.roomId, payload.relativePath);
    this.notify("sync:downloaded", payload);
  }

  async downloadRemoteOnlyFiles(roomId) {
    const statuses = await this.refreshRoomStatus(roomId);
    for (const file of statuses) {
      if (this.isShuttingDown) {
        return;
      }

      if (file.status !== "REMOTE" || !file.currentVersionId) {
        continue;
      }

      await this.applyRemoteUpdate({
        roomId,
        relativePath: file.relativePath,
        versionId: file.currentVersionId
      });
    }
  }

  async handleRemoteFileUpdated(payload) {
    if (this.isShuttingDown) {
      return;
    }

    this.invalidateHistoryCache(payload.roomId, payload.relativePath);

    const syncMode = this.store.getRoomSyncMode(payload.roomId);
    if (syncMode === "RUNNING") {
      const statuses = await this.refreshRoomStatus(payload.roomId);
      const entry = statuses.find((file) => file.relativePath === payload.relativePath);
      if (entry?.status === "REMOTE") {
        await this.applyRemoteUpdate(payload);
      }
    }

    await this.refreshRoomStatus(payload.roomId);
  }

  async handleRemoteFileDeleted(payload) {
    if (this.isShuttingDown) {
      return;
    }

    const binding = this.store.getBinding(payload.roomId);
    if (binding) {
      const absolutePath = path.join(binding.folderPath, ...payload.relativePath.split("/"));
      const exists = await fileExists(absolutePath);
      if (!exists) {
        await this.store.removeVersionHead(payload.roomId, payload.relativePath);
      }
    }

    await this.refreshRoomStatus(payload.roomId);
  }

  async scanLocalFiles(folderPath) {
    const files = new Map();
    const absolutePaths = await walkFiles(folderPath);

    for (const absolutePath of absolutePaths) {
      const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
      if (!relativePath || this.isIgnored(relativePath)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      files.set(relativePath, {
        absolutePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        checksum: null
      });
    }

    return files;
  }

  async ensureLocalChecksum(localFile) {
    if (!localFile || localFile.checksum) {
      return localFile?.checksum ?? null;
    }

    localFile.checksum = await readChecksum(localFile.absolutePath);
    return localFile.checksum;
  }

  async refreshRoomStatus(roomId) {
    if (this.isShuttingDown) {
      return [];
    }

    const binding = this.store.getBinding(roomId);
    const folderPath = binding?.folderPath ?? null;
    const syncMode = this.store.getRoomSyncMode(roomId);
    const memberSyncState = this.getLocalMemberSyncState(roomId);
    const remoteResponse = await this.apiClient.listFileStatuses(roomId);
    const remoteFiles = new Map(remoteResponse.files.map((file) => [file.relativePath, file]));
    const localFiles = binding ? await this.scanLocalFiles(binding.folderPath) : new Map();
    const runningFiles = this.runningFiles.get(roomId) ?? new Set();
    const allPaths = [...new Set([...remoteFiles.keys(), ...localFiles.keys()])].sort((left, right) => left.localeCompare(right));
    const nextStatuses = [];

    for (const relativePath of allPaths) {
      const localFile = localFiles.get(relativePath) ?? null;
      const remoteFile = remoteFiles.get(relativePath) ?? null;
      const lastSyncedHead = this.store.getVersionHead(roomId, relativePath);
      const needsChecksum = Boolean(localFile && remoteFile);
      const localChecksum = needsChecksum ? await this.ensureLocalChecksum(localFile) : null;
      let matchedVersionId = null;

      if (localFile && remoteFile) {
        const historyVersions = await this.getHistoryVersions(roomId, relativePath);
        const matchedVersion = historyVersions.find((version) => version.checksum === localChecksum);
        matchedVersionId = matchedVersion?.id ?? null;

        if (matchedVersionId && matchedVersionId !== lastSyncedHead) {
          await this.store.setVersionHead(roomId, relativePath, matchedVersionId);
        }
      }

      const status = deriveFileStatus({
        hasLocalFile: Boolean(localFile),
        hasRemoteFile: Boolean(remoteFile),
        isRunning: runningFiles.has(relativePath),
        localChecksum,
        remoteChecksum: remoteFile?.checksum ?? null,
        matchedVersionId,
        remoteVersionId: remoteFile?.currentVersionId ?? null,
      });

      if (status === "SYNCED" && remoteFile && lastSyncedHead !== remoteFile.currentVersionId) {
        await this.store.setVersionHead(roomId, relativePath, remoteFile.currentVersionId);
      }

      nextStatuses.push({
        roomId,
        relativePath,
        displayName: path.basename(relativePath),
        status,
        localExists: Boolean(localFile),
        remoteExists: Boolean(remoteFile),
        localSize: localFile?.size ?? null,
        remoteSize: remoteFile?.originalSize ?? null,
        localModifiedAt: localFile?.modifiedAt ?? null,
        remoteModifiedAt: remoteFile?.updatedAt ?? null,
        ownerUsername: remoteFile?.ownerUsername ?? null,
        currentVersionId: remoteFile?.currentVersionId ?? null,
        currentVersionNumber: remoteFile?.versionNumber ?? null,
        isSelectedForSync: Boolean(lastSyncedHead || remoteFile)
      });
    }

    this.roomStatusLists.set(roomId, nextStatuses);
    await this.store.setRoomStatusCache(
      roomId,
      summarizeRoomStatuses(roomId, folderPath, syncMode, memberSyncState, nextStatuses)
    );
    return nextStatuses;
  }

  getCachedRoomStatuses(roomId) {
    return structuredClone(this.roomStatusLists.get(roomId) ?? []);
  }

  async listRoomFiles(roomId) {
    return this.refreshRoomStatus(roomId);
  }

  async syncFile(roomId, relativePath) {
    const binding = this.store.getBinding(roomId);
    if (!binding) {
      throw new Error("Bind a folder before syncing files.");
    }

    const absolutePath = path.join(binding.folderPath, ...relativePath.split("/"));
    await this.uploadFromPath(roomId, binding.folderPath, absolutePath);
    return this.refreshRoomStatus(roomId);
  }

  async syncAllOffline(roomId) {
    const binding = this.store.getBinding(roomId);
    if (!binding) {
      throw new Error("Bind a folder before syncing files.");
    }

    const statuses = await this.refreshRoomStatus(roomId);
    for (const file of statuses) {
      if (file.status !== "OFFLINE") {
        continue;
      }

      const absolutePath = path.join(binding.folderPath, ...file.relativePath.split("/"));
      await this.uploadFromPath(roomId, binding.folderPath, absolutePath);
    }

    return this.refreshRoomStatus(roomId);
  }

  async resolveModifiedLocal(roomId, relativePath) {
    return this.syncFile(roomId, relativePath);
  }

  async resolveModifiedRemote(roomId, relativePath) {
    const statuses = await this.refreshRoomStatus(roomId);
    const file = statuses.find((entry) => entry.relativePath === relativePath);
    if (!file?.currentVersionId) {
      throw new Error("Remote version not found for this file.");
    }

    await this.applyRemoteUpdate({
      roomId,
      relativePath,
      versionId: file.currentVersionId
    });
    return this.refreshRoomStatus(roomId);
  }
}

module.exports = {
  BUILT_IN_IGNORED_PATTERNS,
  SyncManager,
  deriveFileStatus,
  shouldNotifyRoomFileRefresh,
  summarizeRoomStatuses
};
