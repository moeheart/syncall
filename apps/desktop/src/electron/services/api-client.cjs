const { Blob } = require("node:buffer");

class ApiClient {
  constructor(store, options = {}) {
    this.store = store;
    this.clientVersion = options.clientVersion ?? "1.0.0";
    this.clientName = options.clientName ?? "desktop";
  }

  get baseUrl() {
    return this.store.getServerUrl();
  }

  get headers() {
    const token = this.store.getToken();
    return {
      "X-Syncall-Client-Version": this.clientVersion,
      "X-Syncall-Client-Name": this.clientName,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async request(path, init = {}) {
    const hasJsonBody = typeof init.body === "string";
    const isFormBody = init.body instanceof FormData;
    const url = `${this.baseUrl}${path}`;

    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...(hasJsonBody && !isFormBody ? { "Content-Type": "application/json" } : {}),
          ...this.headers,
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      const reason = error?.cause?.code === "UND_ERR_CONNECT_TIMEOUT"
        ? "Connection timed out"
        : "Network request failed";
      throw new Error(`${reason} for ${url}. Check that the server URL is correct and the backend is reachable.`);
    }

    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("Upload rejected: the file is larger than the server allows. Increase the server upload limit or choose a smaller file.");
      }
      const payload = await response.json().catch(() => ({ message: response.statusText }));
      if (payload.code === "CLIENT_VERSION_UNSUPPORTED") {
        throw new Error(
          `${payload.message} Server edition: ${payload.serverVersion}. Minimum supported client edition: ${payload.minimumCompatibleClientVersion}.`
        );
      }
      throw new Error(payload.message ?? "Request failed.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    return response.arrayBuffer();
  }

  register(payload) {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  login(payload) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getCompatibility() {
    return this.request("/auth/compatibility");
  }

  listRooms() {
    return this.request("/rooms");
  }

  createRoom(name) {
    return this.request("/rooms", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  listInvites() {
    return this.request("/invites");
  }

  listUsers() {
    return this.request("/users");
  }

  listRoomMembers(roomId) {
    return this.request(`/rooms/${roomId}/members`);
  }

  createInvite(roomId, username) {
    return this.request(`/rooms/${roomId}/invites`, {
      method: "POST",
      body: JSON.stringify({ username })
    });
  }

  acceptInvite(inviteId) {
    return this.request(`/invites/${inviteId}/accept`, {
      method: "POST"
    });
  }

  listActivity() {
    return this.request("/activity");
  }

  listFiles(roomId) {
    return this.request(`/rooms/${roomId}/files`);
  }

  listFileStatuses(roomId) {
    return this.request(`/rooms/${roomId}/files/status`);
  }

  listHistory(roomId, relativePath) {
    const query = new URLSearchParams({ path: relativePath }).toString();
    return this.request(`/rooms/${roomId}/files/history?${query}`);
  }

  restoreVersion(roomId, versionId) {
    return this.request(`/rooms/${roomId}/files/restore`, {
      method: "POST",
      body: JSON.stringify({ versionId })
    });
  }

  async downloadVersion(roomId, versionId) {
    const buffer = await this.request(`/rooms/${roomId}/files/download/${versionId}`);
    return Buffer.from(buffer);
  }

  uploadFile(roomId, payload) {
    const form = new FormData();
    form.set("roomId", roomId);
    form.set("relativePath", payload.relativePath);
    form.set("checksum", payload.checksum);
    form.set("originalSize", String(payload.originalSize));
    form.set("compressedSize", String(payload.compressedSize));
    form.set("clientModifiedAt", payload.clientModifiedAt);
    if (payload.baseVersionId) {
      form.set("baseVersionId", payload.baseVersionId);
    }
    form.set("file", new Blob([payload.compressedBytes]), "sync.gz");
    return this.request(`/rooms/${roomId}/files/upload`, {
      method: "POST",
      body: form
    });
  }

  deleteFile(roomId, relativePath) {
    return this.request(`/rooms/${roomId}/files/delete`, {
      method: "POST",
      body: JSON.stringify({ relativePath })
    });
  }
}

module.exports = { ApiClient };
