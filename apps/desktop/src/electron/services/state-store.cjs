const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STATE = {
  serverUrl: "http://localhost:4000",
  token: "",
  user: null,
  bindings: {},
  versionHeads: {}
};

function normalizeServerUrl(serverUrl) {
  const trimmed = String(serverUrl ?? "").trim();
  if (!trimmed) {
    return DEFAULT_STATE.serverUrl;
  }

  return trimmed.replace(/\/+$/, "");
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

      this.state = {
        ...structuredClone(DEFAULT_STATE),
        ...JSON.parse(loaded.content)
      };
      this.state.serverUrl = normalizeServerUrl(this.state.serverUrl);

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

    return this.getState();
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
    await this.save();
  }

  async setBinding(roomId, binding) {
    this.state.bindings[roomId] = binding;
    this.state.versionHeads[roomId] ??= {};
    await this.save();
  }

  getBinding(roomId) {
    return this.state.bindings[roomId] ?? null;
  }

  getBindings() {
    return structuredClone(this.state.bindings);
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
