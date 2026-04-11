const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const chokidar = require("chokidar");
const { io } = require("socket.io-client");

const IGNORED_PATTERNS = [/^\.syncall(\/|\\|$)/, /\.tmp$/i, /\.swp$/i, /~$/];
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
  }

  async initialize() {
    if (this.isShuttingDown) {
      return;
    }

    if (this.store.getToken()) {
      await this.connectSocket();
      await this.restartBindings();
    }
  }

  async updateSession() {
    if (this.isShuttingDown) {
      return;
    }

    await this.disconnectSocket();
    await this.connectSocket();
    await this.restartBindings();
  }

  async stopRuntime() {
    this.clearPendingUploads();

    for (const roomId of [...this.watchers.keys()]) {
      await this.stopWatcher(roomId);
    }

    await this.disconnectSocket();
  }

  async clearSession() {
    await this.stopRuntime();
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
    return IGNORED_PATTERNS.some((pattern) => pattern.test(relativePath));
  }

  suppressionKey(roomId, relativePath) {
    return `${roomId}:${relativePath}`;
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
      void (async () => {
        try {
          if (this.isShuttingDown || !this.socket) {
            return;
          }

          for (const roomId of Object.keys(this.store.getBindings())) {
            if (this.isShuttingDown || !this.socket) {
              return;
            }

            this.socket.emit("room:join", roomId);
            await this.resyncRoom(roomId);
          }

          if (!this.isShuttingDown) {
            this.notify("socket:connected", { connected: true });
          }
        } catch (error) {
          this.handleSyncError("connect", "socket", this.store.getServerUrl(), error);
        }
      })();
    });

    this.socket.on("sync:file-updated", (payload) => {
      void this.applyRemoteUpdate(payload).catch((error) => {
        this.handleSyncError("download", payload.roomId, payload.relativePath, error);
      });
    });

    this.socket.on("sync:restore-completed", (payload) => {
      void this.applyRemoteUpdate(payload).catch((error) => {
        this.handleSyncError("restore-download", payload.roomId, payload.relativePath, error);
      });
    });

    this.socket.on("sync:file-deleted", (payload) => {
      void this.applyRemoteDelete(payload).catch((error) => {
        this.handleSyncError("remote-delete", payload.roomId, payload.relativePath, error);
      });
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

  async restartBindings() {
    if (this.isShuttingDown) {
      return;
    }

    for (const roomId of [...this.watchers.keys()]) {
      await this.stopWatcher(roomId);
    }

    const bindings = this.store.getBindings();
    for (const [roomId, binding] of Object.entries(bindings)) {
      if (this.isShuttingDown) {
        return;
      }

      await this.startWatcher(roomId, binding.folderPath);
      await this.resyncRoom(roomId);
      await this.syncExistingLocalFiles(roomId);
    }
  }

  async bindFolder(roomId, folderPath) {
    if (this.isShuttingDown) {
      return this.store.getBinding(roomId);
    }

    await this.store.setBinding(roomId, { folderPath });
    if (this.socket && !this.isShuttingDown) {
      this.socket.emit("room:join", roomId);
    }
    await this.startWatcher(roomId, folderPath);
    await this.resyncRoom(roomId);
    await this.syncExistingLocalFiles(roomId);
    return this.store.getBinding(roomId);
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
      this.scheduleUpload(roomId, folderPath, absolutePath);
    });
    watcher.on("change", (absolutePath) => {
      this.scheduleUpload(roomId, folderPath, absolutePath);
    });
    watcher.on("unlink", (absolutePath) => {
      const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
      this.cancelPendingUpload(roomId, relativePath);
      void this.deleteFromPath(roomId, folderPath, absolutePath).catch((error) => {
        this.handleSyncError("delete", roomId, absolutePath, error);
      });
    });

    this.watchers.set(roomId, watcher);
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

  async stopWatcher(roomId) {
    this.clearPendingUploads(roomId);
    const watcher = this.watchers.get(roomId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(roomId);
    }
  }

  scheduleUpload(roomId, folderPath, absolutePath) {
    if (this.isShuttingDown) {
      return;
    }

    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }

    const key = this.suppressionKey(roomId, relativePath);
    const existingTimeout = this.pendingUploads.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      if (this.isShuttingDown) {
        this.pendingUploads.delete(key);
        return;
      }

      this.pendingUploads.delete(key);
      void this.uploadFromPath(roomId, folderPath, absolutePath).catch((error) => {
        this.handleSyncError("upload", roomId, absolutePath, error);
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
    const response = await this.apiClient.uploadFile(roomId, {
      relativePath,
      checksum,
      originalSize: fileBytes.byteLength,
      compressedSize: compressedBytes.byteLength,
      compressedBytes,
      baseVersionId
    });

    if (this.isShuttingDown) {
      return;
    }

    await this.store.setVersionHead(roomId, response.version.relativePath, response.version.id);
    this.notify("sync:uploaded", response.version);
  }

  async deleteFromPath(roomId, folderPath, absolutePath) {
    if (this.isShuttingDown) {
      return;
    }

    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }
    await this.apiClient.deleteFile(roomId, relativePath);
    if (this.isShuttingDown) {
      return;
    }
    await this.store.removeVersionHead(roomId, relativePath);
    this.notify("sync:deleted", { roomId, relativePath });
  }

  async applyRemoteUpdate(payload) {
    if (this.isShuttingDown) {
      return;
    }

    const binding = this.store.getBinding(payload.roomId);
    if (!binding) {
      return;
    }

    const currentVersionId = this.store.getVersionHead(payload.roomId, payload.relativePath);
    if (currentVersionId === payload.versionId) {
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
    this.notify("sync:downloaded", payload);
  }

  async applyRemoteDelete(payload) {
    if (this.isShuttingDown) {
      return;
    }

    const binding = this.store.getBinding(payload.roomId);
    if (!binding) {
      return;
    }

    const absolutePath = path.join(binding.folderPath, ...payload.relativePath.split("/"));
    this.suppress(payload.roomId, payload.relativePath);
    await fs.rm(absolutePath, { force: true });
    if (this.isShuttingDown) {
      return;
    }
    await this.store.removeVersionHead(payload.roomId, payload.relativePath);
    this.notify("sync:remote-delete", payload);
  }

  async resyncRoom(roomId) {
    if (this.isShuttingDown) {
      return [];
    }

    const binding = this.store.getBinding(roomId);
    if (!binding) {
      return [];
    }

    const response = await this.apiClient.listFiles(roomId);
    if (this.isShuttingDown) {
      return [];
    }

    for (const file of response.files) {
      if (this.isShuttingDown) {
        return response.files;
      }

      const knownVersion = this.store.getVersionHead(roomId, file.relativePath);
      if (knownVersion !== file.currentVersionId) {
        await this.applyRemoteUpdate({
          roomId,
          relativePath: file.relativePath,
          versionId: file.currentVersionId
        });
      }
    }
    return response.files;
  }

  async syncExistingLocalFiles(roomId) {
    if (this.isShuttingDown) {
      return;
    }

    const binding = this.store.getBinding(roomId);
    if (!binding) {
      return;
    }

    const serverFiles = await this.apiClient.listFiles(roomId);
    if (this.isShuttingDown) {
      return;
    }

    const serverMap = new Map(serverFiles.files.map((file) => [file.relativePath, file]));
    const localFiles = await walkFiles(binding.folderPath);

    for (const absolutePath of localFiles) {
      if (this.isShuttingDown) {
        return;
      }

      const relativePath = normalizeRelativePath(path.relative(binding.folderPath, absolutePath));
      if (!relativePath || this.isIgnored(relativePath)) {
        continue;
      }

      const localBytes = await fs.readFile(absolutePath);
      const checksum = createHash("sha256").update(localBytes).digest("hex");
      const serverFile = serverMap.get(relativePath);

      if (!serverFile || serverFile.checksum !== checksum) {
        this.scheduleUpload(roomId, binding.folderPath, absolutePath);
      } else {
        await this.store.setVersionHead(roomId, relativePath, serverFile.currentVersionId);
      }
    }
  }
}

module.exports = { SyncManager };
