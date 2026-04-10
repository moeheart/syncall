import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE = {
  serverUrl: "http://localhost:4000",
  token: "",
  user: null,
  bindings: {},
  versionHeads: {}
};

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(DEFAULT_STATE);
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      this.state = {
        ...structuredClone(DEFAULT_STATE),
        ...JSON.parse(content)
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.save();
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
    this.state.serverUrl = serverUrl;
    await this.save();
  }

  async setSession({ token, user, serverUrl }) {
    this.state.token = token;
    this.state.user = user;
    if (serverUrl) {
      this.state.serverUrl = serverUrl;
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
}

