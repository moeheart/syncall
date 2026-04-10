const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const chokidar = require("chokidar");
const { io } = require("socket.io-client");

const IGNORED_PATTERNS = [/^\.syncall(\/|\\|$)/, /\.tmp$/i, /\.swp$/i, /~$/];
const MAX_ORIGINAL_FILE_BYTES = 200 * 1024 * 1024;

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
  constructor({ store, apiClient, notify }) {
    this.store = store;
    this.apiClient = apiClient;
    this.notify = notify;
    this.watchers = new Map();
    this.suppressed = new Map();
    this.socket = null;
  }

  async initialize() {
    if (this.store.getToken()) {
      await this.connectSocket();
      await this.restartBindings();
    }
  }

  async updateSession() {
    await this.disconnectSocket();
    await this.connectSocket();
    await this.restartBindings();
  }

  async clearSession() {
    for (const roomId of this.watchers.keys()) {
      await this.stopWatcher(roomId);
    }
    await this.disconnectSocket();
  }

  isIgnored(relativePath) {
    return IGNORED_PATTERNS.some((pattern) => pattern.test(relativePath));
  }

  suppressionKey(roomId, relativePath) {
    return `${roomId}:${relativePath}`;
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
    const token = this.store.getToken();
    if (!token) {
      return;
    }

    this.socket = io(this.store.getServerUrl(), {
      autoConnect: true,
      auth: { token }
    });

    this.socket.on("connect", async () => {
      for (const roomId of Object.keys(this.store.getBindings())) {
        this.socket.emit("room:join", roomId);
        await this.resyncRoom(roomId);
      }
      this.notify("socket:connected", { connected: true });
    });

    this.socket.on("sync:file-updated", async (payload) => {
      await this.applyRemoteUpdate(payload);
    });

    this.socket.on("sync:restore-completed", async (payload) => {
      await this.applyRemoteUpdate(payload);
    });

    this.socket.on("sync:file-deleted", async (payload) => {
      await this.applyRemoteDelete(payload);
    });

    this.socket.on("invite:received", (payload) => {
      this.notify("invite:received", payload);
    });

    this.socket.on("sync:error", (payload) => {
      this.notify("sync:error", payload);
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
    for (const roomId of this.watchers.keys()) {
      await this.stopWatcher(roomId);
    }

    const bindings = this.store.getBindings();
    for (const [roomId, binding] of Object.entries(bindings)) {
      await this.startWatcher(roomId, binding.folderPath);
      await this.resyncRoom(roomId);
      await this.syncExistingLocalFiles(roomId);
    }
  }

  async bindFolder(roomId, folderPath) {
    await this.store.setBinding(roomId, { folderPath });
    if (this.socket) {
      this.socket.emit("room:join", roomId);
    }
    await this.startWatcher(roomId, folderPath);
    await this.resyncRoom(roomId);
    await this.syncExistingLocalFiles(roomId);
    return this.store.getBinding(roomId);
  }

  async startWatcher(roomId, folderPath) {
    await this.stopWatcher(roomId);

    const watcher = chokidar.watch(folderPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      }
    });

    watcher.on("add", (absolutePath) => {
      void this.uploadFromPath(roomId, folderPath, absolutePath).catch((error) => {
        this.handleSyncError("upload", roomId, absolutePath, error);
      });
    });
    watcher.on("change", (absolutePath) => {
      void this.uploadFromPath(roomId, folderPath, absolutePath).catch((error) => {
        this.handleSyncError("upload", roomId, absolutePath, error);
      });
    });
    watcher.on("unlink", (absolutePath) => {
      void this.deleteFromPath(roomId, folderPath, absolutePath).catch((error) => {
        this.handleSyncError("delete", roomId, absolutePath, error);
      });
    });

    this.watchers.set(roomId, watcher);
  }

  handleSyncError(action, roomId, absolutePath, error) {
    this.notify("sync:error", {
      action,
      roomId,
      path: absolutePath,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  async stopWatcher(roomId) {
    const watcher = this.watchers.get(roomId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(roomId);
    }
  }

  async uploadFromPath(roomId, folderPath, absolutePath) {
    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }

    const fileBytes = await fs.readFile(absolutePath);
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

    await this.store.setVersionHead(roomId, response.version.relativePath, response.version.id);
    this.notify("sync:uploaded", response.version);
  }

  async deleteFromPath(roomId, folderPath, absolutePath) {
    const relativePath = normalizeRelativePath(path.relative(folderPath, absolutePath));
    if (!relativePath || this.isIgnored(relativePath) || this.isSuppressed(roomId, relativePath)) {
      return;
    }
    await this.apiClient.deleteFile(roomId, relativePath);
    await this.store.removeVersionHead(roomId, relativePath);
    this.notify("sync:deleted", { roomId, relativePath });
  }

  async applyRemoteUpdate(payload) {
    const binding = this.store.getBinding(payload.roomId);
    if (!binding) {
      return;
    }

    const currentVersionId = this.store.getVersionHead(payload.roomId, payload.relativePath);
    if (currentVersionId === payload.versionId) {
      return;
    }

    const fileBytes = await this.apiClient.downloadVersion(payload.roomId, payload.versionId);
    const absolutePath = path.join(binding.folderPath, ...payload.relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    this.suppress(payload.roomId, payload.relativePath);
    await fs.writeFile(absolutePath, fileBytes);
    await this.store.setVersionHead(payload.roomId, payload.relativePath, payload.versionId);
    this.notify("sync:downloaded", payload);
  }

  async applyRemoteDelete(payload) {
    const binding = this.store.getBinding(payload.roomId);
    if (!binding) {
      return;
    }

    const absolutePath = path.join(binding.folderPath, ...payload.relativePath.split("/"));
    this.suppress(payload.roomId, payload.relativePath);
    await fs.rm(absolutePath, { force: true });
    await this.store.removeVersionHead(payload.roomId, payload.relativePath);
    this.notify("sync:remote-delete", payload);
  }

  async resyncRoom(roomId) {
    const binding = this.store.getBinding(roomId);
    if (!binding) {
      return [];
    }

    const response = await this.apiClient.listFiles(roomId);
    for (const file of response.files) {
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
    const binding = this.store.getBinding(roomId);
    if (!binding) {
      return;
    }

    const serverFiles = await this.apiClient.listFiles(roomId);
    const serverMap = new Map(serverFiles.files.map((file) => [file.relativePath, file]));
    const localFiles = await walkFiles(binding.folderPath);

    for (const absolutePath of localFiles) {
      const relativePath = normalizeRelativePath(path.relative(binding.folderPath, absolutePath));
      if (!relativePath || this.isIgnored(relativePath)) {
        continue;
      }

      const localBytes = await fs.readFile(absolutePath);
      const checksum = createHash("sha256").update(localBytes).digest("hex");
      const serverFile = serverMap.get(relativePath);

      if (!serverFile || serverFile.checksum !== checksum) {
        try {
          await this.uploadFromPath(roomId, binding.folderPath, absolutePath);
        } catch (error) {
          this.handleSyncError("upload", roomId, absolutePath, error);
        }
      } else {
        await this.store.setVersionHead(roomId, relativePath, serverFile.currentVersionId);
      }
    }
  }
}

module.exports = { SyncManager };
