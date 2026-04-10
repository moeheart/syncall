import { Blob } from "node:buffer";

export class ApiClient {
  constructor(store) {
    this.store = store;
  }

  get baseUrl() {
    return this.store.getServerUrl();
  }

  get headers() {
    const token = this.store.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async request(path, init = {}) {
    const hasJsonBody = typeof init.body === "string";
    const isFormBody = init.body instanceof FormData;

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(hasJsonBody && !isFormBody ? { "Content-Type": "application/json" } : {}),
        ...this.headers,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ message: response.statusText }));
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
