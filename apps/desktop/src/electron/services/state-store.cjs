const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STATE = {
  serverUrl: "http://localhost:4000",
  token: "",
  user: null,
  bindings: {},
  versionHeads: {},
  joinedRooms: [],
  roomSyncModes: {},
  roomStatusCache: {},
  panelReadAt: {
    invites: null,
    activity: null
  },
  noticeUnreadCount: 0
};

function normalizeServerUrl(serverUrl) {
  const trimmed = String(serverUrl ?? "").trim();
  if (!trimmed) {
    return DEFAULT_STATE.serverUrl;
  }

  return trimmed.replace(/\/+$/, "");
}

function normalizeState(input) {
  const next = {
    ...structuredClone(DEFAULT_STATE),
    ...input,
    bindings: {
      ...structuredClone(DEFAULT_STATE.bindings),
      ...(input.bindings ?? {})
    },
    versionHeads: {
      ...structuredClone(DEFAULT_STATE.versionHeads),
      ...(input.versionHeads ?? {})
    },
    roomSyncModes: {
      ...structuredClone(DEFAULT_STATE.roomSyncModes),
      ...(input.roomSyncModes ?? {})
    },
    roomStatusCache: {
      ...structuredClone(DEFAULT_STATE.roomStatusCache),
      ...(input.roomStatusCache ?? {})
    },
    panelReadAt: {
      ...structuredClone(DEFAULT_STATE.panelReadAt),
      ...(input.panelReadAt ?? {})
    }
  };

  next.serverUrl = normalizeServerUrl(next.serverUrl);
  next.joinedRooms = Array.isArray(next.joinedRooms) ? [...new Set(next.joinedRooms.filter(Boolean))] : [];

  for (const roomId of Object.keys(next.roomSyncModes)) {
    if (next.roomSyncModes[roomId] === "RUNNING") {
      next.roomSyncModes[roomId] = "PAUSED";
    }
  }

  return next;
}

class StateStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.fallbackPaths = Array.isArray(options.fallbackPaths) ? options.fallbackPaths : [];
    this.state = structuredClone(DEFAULT_STATE);
  }

  async readFirstAvailableStateFile() {
    const candidates = [this.filePath, ...this.fallbackPaths];

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, "utf8");
        return {
          content,
          sourcePath: candidate
        };
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    return null;
  }

  async load() {
    const loaded = await this.readFirstAvailableStateFile();

    try {
      if (!loaded) {
        await this.save();
        return this.getState();
      }

      this.state = normalizeState(JSON.parse(loaded.content));

      if (loaded.sourcePath !== this.filePath) {
        await this.save();
      }

      return this.getState();
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.state = structuredClone(DEFAULT_STATE);
        await this.save();
        return this.getState();
      }
      throw error;
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getState() {
    return structuredClone(this.state);
  }

  async setServerUrl(serverUrl) {
    this.state.serverUrl = normalizeServerUrl(serverUrl);
    await this.save();
  }

  async setSession({ token, user, serverUrl }) {
    this.state.token = token;
    this.state.user = user;
    if (serverUrl) {
      this.state.serverUrl = normalizeServerUrl(serverUrl);
    }
    await this.save();
  }

  async clearSession() {
    this.state.token = "";
    this.state.user = null;
    this.state.bindings = {};
    this.state.versionHeads = {};
    this.state.joinedRooms = [];
    this.state.roomSyncModes = {};
    this.state.roomStatusCache = {};
    this.state.panelReadAt = structuredClone(DEFAULT_STATE.panelReadAt);
    this.state.noticeUnreadCount = 0;
    await this.save();
  }

  async setBinding(roomId, binding) {
    this.state.bindings[roomId] = binding;
    this.state.versionHeads[roomId] ??= {};
    this.state.roomSyncModes[roomId] ??= "PAUSED";
    await this.save();
  }

  getBinding(roomId) {
    return this.state.bindings[roomId] ?? null;
  }

  getBindings() {
    return structuredClone(this.state.bindings);
  }

  async setJoinedRooms(roomIds) {
    this.state.joinedRooms = [...new Set(roomIds)];
    await this.save();
  }

  getJoinedRooms() {
    return [...this.state.joinedRooms];
  }

  getVersionHead(roomId, relativePath) {
    return this.state.versionHeads[roomId]?.[relativePath] ?? null;
  }

  async setVersionHead(roomId, relativePath, versionId) {
    this.state.versionHeads[roomId] ??= {};
    this.state.versionHeads[roomId][relativePath] = versionId;
    await this.save();
  }

  async removeVersionHead(roomId, relativePath) {
    if (this.state.versionHeads[roomId]) {
      delete this.state.versionHeads[roomId][relativePath];
    }
    await this.save();
  }

  getRoomSyncMode(roomId) {
    return this.state.roomSyncModes[roomId] ?? "PAUSED";
  }

  getRoomSyncModes() {
    return structuredClone(this.state.roomSyncModes);
  }

  async setRoomSyncMode(roomId, syncMode) {
    this.state.roomSyncModes[roomId] = syncMode;
    await this.save();
  }

  getRoomStatusCache(roomId) {
    return structuredClone(this.state.roomStatusCache[roomId] ?? null);
  }

  getAllRoomStatusCache() {
    return structuredClone(this.state.roomStatusCache);
  }

  async setRoomStatusCache(roomId, summary) {
    this.state.roomStatusCache[roomId] = summary;
    await this.save();
  }

  getPanelReadAt(panelId) {
    return this.state.panelReadAt[panelId] ?? null;
  }

  async markPanelRead(panelId, readAt = new Date().toISOString()) {
    if (panelId === "notices") {
      this.state.noticeUnreadCount = 0;
    } else if (panelId === "invites" || panelId === "activity") {
      this.state.panelReadAt[panelId] = readAt;
    }

    await this.save();
  }

  getNoticeUnreadCount() {
    return this.state.noticeUnreadCount;
  }

  async incrementNoticeUnread(amount = 1) {
    this.state.noticeUnreadCount += amount;
    await this.save();
  }

  async setNoticeUnreadCount(count) {
    this.state.noticeUnreadCount = count;
    await this.save();
  }

  getServerUrl() {
    return this.state.serverUrl;
  }

  getToken() {
    return this.state.token;
  }

  getUser() {
    return this.state.user;
  }

  getProfile() {
    return path.basename(this.filePath, path.extname(this.filePath));
  }
}

module.exports = { StateStore };
