<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { FileVersionSummary, InviteSummary, RoomMemberSummary, RoomSummary, SyncEventSummary, UserSummary } from "@syncall/shared";

interface DesktopState {
  serverUrl: string;
  token: string;
  user: { id: string; username: string; email: string } | null;
  bindings: Record<string, { folderPath: string }>;
}

interface DashboardPayload {
  rooms: RoomSummary[];
  invites: InviteSummary[];
  events: SyncEventSummary[];
  users: UserSummary[];
  bindings: Record<string, { folderPath: string }>;
  user: DesktopState["user"];
  serverUrl: string;
  profile: string;
}

declare global {
  interface Window {
    syncall: {
      getState: () => Promise<DesktopState>;
      setServerUrl: (serverUrl: string) => Promise<DesktopState>;
      register: (payload: { username: string; email: string; password: string }) => Promise<DashboardPayload>;
      login: (payload: { email: string; password: string }) => Promise<DashboardPayload>;
      logout: () => Promise<DesktopState>;
      fetchDashboard: () => Promise<DashboardPayload>;
      createRoom: (name: string) => Promise<DashboardPayload>;
      inviteUser: (roomId: string, username: string) => Promise<DashboardPayload>;
      acceptInvite: (inviteId: string) => Promise<DashboardPayload>;
      listRoomMembers: (roomId: string) => Promise<{ members: RoomMemberSummary[] }>;
      chooseFolder: () => Promise<string | null>;
      bindFolder: (roomId: string, folderPath: string) => Promise<DashboardPayload>;
      listHistory: (roomId: string, relativePath: string) => Promise<{ versions: FileVersionSummary[] }>;
      restoreVersion: (roomId: string, versionId: string) => Promise<FileVersionSummary>;
      onEvent: (callback: (payload: { type: string; payload: unknown }) => void) => () => void;
    };
  }
}

const state = ref<DesktopState>({
  serverUrl: "http://localhost:4000",
  token: "",
  user: null,
  bindings: {}
});
const rooms = ref<RoomSummary[]>([]);
const invites = ref<InviteSummary[]>([]);
const events = ref<SyncEventSummary[]>([]);
const users = ref<UserSummary[]>([]);
const members = ref<RoomMemberSummary[]>([]);
const selectedRoomId = ref("");
const selectedHistoryPath = ref("");
const historyVersions = ref<FileVersionSummary[]>([]);
const notices = ref<string[]>([]);
const loading = ref(false);
const authMode = ref<"login" | "register">("login");
const username = ref("");
const email = ref("");
const password = ref("");
const newRoomName = ref("");
const inviteUsername = ref("");
const userSearch = ref("");
const serverUrlInput = ref("http://localhost:4000");
const errorMessage = ref("");
const profileName = ref("default");
const bridgeReady = computed(() => typeof window !== "undefined" && typeof window.syncall !== "undefined");

const isAuthenticated = computed(() => Boolean(state.value.token && state.value.user));
const selectedRoom = computed(() => rooms.value.find((room) => room.id === selectedRoomId.value) ?? null);
const filteredUsers = computed(() => {
  const query = userSearch.value.trim().toLowerCase();
  const memberUsernames = new Set(members.value.map((member) => member.username));

  return users.value.filter((user) => {
    if (memberUsernames.has(user.username)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
  });
});

function applyDashboard(payload: DashboardPayload) {
  rooms.value = payload.rooms;
  invites.value = payload.invites;
  events.value = payload.events;
  users.value = payload.users;
  state.value.user = payload.user;
  state.value.serverUrl = payload.serverUrl;
  state.value.bindings = payload.bindings;
  state.value.token = "session";
  serverUrlInput.value = payload.serverUrl;
  profileName.value = payload.profile;

  if (payload.rooms.length === 0) {
    selectedRoomId.value = "";
    members.value = [];
    return;
  }

  const hasSelection = payload.rooms.some((room) => room.id === selectedRoomId.value);
  if (!hasSelection) {
    selectedRoomId.value = payload.rooms[0].id;
  }
}

async function loadMembers(roomId: string) {
  if (!bridgeReady.value || !roomId) {
    return;
  }

  const response = await window.syncall.listRoomMembers(roomId);
  members.value = response.members;
}

async function refreshDashboard() {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }

  applyDashboard(await window.syncall.fetchDashboard());

  if (selectedRoomId.value) {
    await loadMembers(selectedRoomId.value);
  }
}

async function saveServerUrl() {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  state.value = await window.syncall.setServerUrl(serverUrlInput.value);
}

async function submitAuth() {
  loading.value = true;
  errorMessage.value = "";

  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    loading.value = false;
    return;
  }

  try {
    const payload =
      authMode.value === "login"
        ? await window.syncall.login({ email: email.value, password: password.value })
        : await window.syncall.register({
            username: username.value,
            email: email.value,
            password: password.value
          });

    applyDashboard(payload);
    if (selectedRoomId.value) {
      await loadMembers(selectedRoomId.value);
    }
  } catch (error) {
    errorMessage.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
}

async function createRoom() {
  if (!newRoomName.value || !bridgeReady.value) {
    return;
  }
  applyDashboard(await window.syncall.createRoom(newRoomName.value));
  newRoomName.value = "";
  if (selectedRoomId.value) {
    await loadMembers(selectedRoomId.value);
  }
}

async function inviteUser(usernameToInvite = inviteUsername.value) {
  if (!selectedRoomId.value || !usernameToInvite || !bridgeReady.value) {
    return;
  }

  errorMessage.value = "";

  try {
    applyDashboard(await window.syncall.inviteUser(selectedRoomId.value, usernameToInvite));
    inviteUsername.value = "";
    await loadMembers(selectedRoomId.value);
  } catch (error) {
    errorMessage.value = (error as Error).message;
  }
}

async function acceptInvite(inviteId: string) {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  applyDashboard(await window.syncall.acceptInvite(inviteId));
  if (selectedRoomId.value) {
    await loadMembers(selectedRoomId.value);
  }
}

async function bindFolder(roomId: string) {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  const folderPath = await window.syncall.chooseFolder();
  if (!folderPath) {
    return;
  }
  applyDashboard(await window.syncall.bindFolder(roomId, folderPath));
}

async function loadHistory(relativePath: string) {
  if (!selectedRoomId.value || !relativePath || !bridgeReady.value) {
    return;
  }
  selectedHistoryPath.value = relativePath;
  const response = await window.syncall.listHistory(selectedRoomId.value, relativePath);
  historyVersions.value = response.versions;
}

async function restoreVersion(versionId: string) {
  if (!selectedRoomId.value || !bridgeReady.value) {
    return;
  }
  await window.syncall.restoreVersion(selectedRoomId.value, versionId);
  await loadHistory(selectedHistoryPath.value);
}

async function logout() {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  state.value = await window.syncall.logout();
  rooms.value = [];
  invites.value = [];
  events.value = [];
  users.value = [];
  members.value = [];
  historyVersions.value = [];
}

watch(selectedRoomId, async (roomId) => {
  if (roomId) {
    await loadMembers(roomId);
  } else {
    members.value = [];
  }
});

onMounted(async () => {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge failed to load. Close the app and open the newest build.";
    return;
  }

  state.value = await window.syncall.getState();
  serverUrlInput.value = state.value.serverUrl;
  if (state.value.token) {
    try {
      await refreshDashboard();
    } catch (error) {
      errorMessage.value = (error as Error).message;
    }
  }

  window.syncall.onEvent(({ type, payload }) => {
    notices.value = [`${type}: ${JSON.stringify(payload)}`, ...notices.value].slice(0, 8);
    void refreshDashboard();
  });
});
</script>

<template>
  <main class="layout">
    <section class="sidebar">
      <div class="brand-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Syncall Desktop</p>
            <h1>Real-time room sync for shared log folders.</h1>
          </div>
          <span class="profile-chip">Profile: {{ profileName }}</span>
        </div>
        <p class="muted">
          Electron watches the local filesystem, compresses log-heavy uploads, and keeps rollback history
          available from one place.
        </p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Server</h2>
          <button class="secondary" @click="saveServerUrl">Save</button>
        </div>
        <input v-model="serverUrlInput" type="url" />
      </div>

      <div v-if="!isAuthenticated" class="panel auth-panel">
        <p v-if="!bridgeReady" class="error-text">Desktop bridge failed to load. Rebuild or restart the client.</p>
        <div class="segmented">
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'">Login</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'">Register</button>
        </div>
        <input v-if="authMode === 'register'" v-model="username" placeholder="Username" />
        <input v-model="email" type="email" placeholder="Email" />
        <input v-model="password" type="password" placeholder="Password" />
        <button @click="submitAuth">{{ loading ? "Working..." : authMode === "login" ? "Sign in" : "Create account" }}</button>
      </div>

      <div v-else class="panel">
        <div class="panel-header">
          <h2>Signed in</h2>
          <button class="secondary" @click="logout">Log out</button>
        </div>
        <p>{{ state.user?.username }}</p>
        <p class="muted">{{ state.user?.email }}</p>
      </div>

      <div class="panel">
        <h2>Live notices</h2>
        <ul class="compact-list">
          <li v-for="notice in notices" :key="notice">{{ notice }}</li>
          <li v-if="notices.length === 0" class="muted">Socket and sync events will appear here.</li>
        </ul>
      </div>
    </section>

    <section class="content">
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

      <div class="panel-grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Rooms</h2>
            <button class="secondary" @click="refreshDashboard" :disabled="!isAuthenticated">Refresh</button>
          </div>
          <div v-if="isAuthenticated" class="stack">
            <div class="inline-form">
              <input v-model="newRoomName" placeholder="New room name" />
              <button @click="createRoom">Create</button>
            </div>
            <ul class="room-list">
              <li
                v-for="room in rooms"
                :key="room.id"
                :class="{ active: selectedRoomId === room.id }"
                @click="selectedRoomId = room.id"
              >
                <div>
                  <strong>{{ room.name }}</strong>
                  <span>{{ room.memberCount }} members</span>
                </div>
                <small>{{ state.bindings[room.id]?.folderPath ?? "No local folder bound" }}</small>
              </li>
            </ul>
          </div>
          <p v-else class="muted">Sign in to create and manage rooms.</p>
        </article>

        <article class="panel">
          <h2>Invites</h2>
          <ul class="compact-list">
            <li v-for="invite in invites" :key="invite.id">
              <strong>{{ invite.roomName }}</strong>
              <span>from {{ invite.inviterUsername }}</span>
              <button class="secondary small" @click="acceptInvite(invite.id)">Accept</button>
            </li>
            <li v-if="invites.length === 0" class="muted">No pending invites.</li>
          </ul>
        </article>

        <article class="panel">
          <h2>Recent activity</h2>
          <ul class="compact-list">
            <li v-for="event in events" :key="event.id">
              <strong>{{ event.type }}</strong>
              <span>{{ event.relativePath }}</span>
              <small>{{ event.actorUsername }}</small>
            </li>
            <li v-if="events.length === 0" class="muted">No room activity yet.</li>
          </ul>
        </article>
      </div>

      <article class="panel detail-panel" v-if="selectedRoom">
        <div class="panel-header detail-header">
          <div>
            <p class="eyebrow">Selected room</p>
            <h2>{{ selectedRoom.name }}</h2>
          </div>
          <button @click="bindFolder(selectedRoom.id)">Bind local folder</button>
        </div>

        <div class="detail-grid">
          <section class="panel inner-panel">
            <h3>Members in this room</h3>
            <ul class="compact-list">
              <li v-for="member in members" :key="member.id">
                <strong>{{ member.username }}</strong>
                <span>{{ member.email }}</span>
                <small>{{ member.role }}</small>
              </li>
              <li v-if="members.length === 0" class="muted">No members loaded yet.</li>
            </ul>
          </section>

          <section class="panel inner-panel">
            <h3>Invite by username</h3>
            <div class="inline-form">
              <input v-model="inviteUsername" placeholder="Username" />
              <button @click="inviteUser()">Invite</button>
            </div>

            <h3>Available users</h3>
            <input v-model="userSearch" placeholder="Search users by name or email" />
            <ul class="compact-list">
              <li v-for="user in filteredUsers" :key="user.id">
                <strong>{{ user.username }}</strong>
                <span>{{ user.email }}</span>
                <button class="secondary small" @click="inviteUser(user.username)">Invite</button>
              </li>
              <li v-if="filteredUsers.length === 0" class="muted">No additional users available to invite.</li>
            </ul>
          </section>

          <section class="panel inner-panel">
            <h3>Folder binding</h3>
            <p class="muted">{{ state.bindings[selectedRoom.id]?.folderPath ?? "No folder bound yet." }}</p>

            <h3>History lookup</h3>
            <div class="inline-form">
              <input v-model="selectedHistoryPath" placeholder="relative/path/to/log.txt" />
              <button class="secondary" @click="loadHistory(selectedHistoryPath)">Load</button>
            </div>

            <h3>Version history</h3>
            <ul class="history-list">
              <li v-for="version in historyVersions" :key="version.id">
                <div>
                  <strong>#{{ version.versionNumber }} {{ version.relativePath }}</strong>
                  <span>
                    {{ version.originalSize }} bytes -> {{ version.compressedSize }} bytes
                    <template v-if="version.originalSize > 0">
                      ({{ Math.round((1 - version.compressedSize / version.originalSize) * 100) }}% smaller)
                    </template>
                  </span>
                  <small>{{ version.uploaderUsername }}</small>
                </div>
                <button class="secondary small" @click="restoreVersion(version.id)">Restore</button>
              </li>
              <li v-if="historyVersions.length === 0" class="muted">Choose a file path to inspect version history.</li>
            </ul>
          </section>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  min-width: 0;
  font-family: "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #020617 0%, #0f172a 45%, #132742 100%);
  color: #e2e8f0;
}

:global(*) {
  box-sizing: border-box;
}

.layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 20px;
  min-height: 100vh;
  padding: 20px;
}

.sidebar,
.content,
.stack,
.panel-grid,
.room-list,
.compact-list,
.history-list {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.panel,
.brand-card,
.inner-panel {
  min-width: 0;
  overflow: hidden;
}

.panel,
.brand-card {
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.82);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
}

.panel h1,
.panel h2,
.panel h3,
.brand-card h1,
.brand-card p,
.panel p {
  margin-top: 0;
}

.eyebrow {
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #67e8f9;
  font-size: 0.8rem;
}

.muted,
small,
span {
  color: rgba(226, 232, 240, 0.72);
}

.profile-chip {
  align-self: flex-start;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.12);
  color: #a5f3fc;
  font-size: 0.9rem;
  white-space: nowrap;
}

.panel-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
}

.detail-header,
.panel-header,
.inline-form,
.segmented {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.panel-header {
  justify-content: space-between;
}

.inline-form input {
  flex: 1 1 180px;
}

input,
button {
  border: none;
  border-radius: 12px;
  font: inherit;
  max-width: 100%;
}

input {
  width: 100%;
  padding: 12px 14px;
  background: rgba(30, 41, 59, 0.88);
  color: inherit;
}

button {
  padding: 11px 14px;
  background: linear-gradient(135deg, #06b6d4, #2563eb);
  color: white;
  font-weight: 700;
  cursor: pointer;
}

.secondary {
  background: rgba(148, 163, 184, 0.18);
}

.small {
  padding: 8px 10px;
}

.segmented button {
  flex: 1 1 120px;
  background: rgba(30, 41, 59, 0.9);
}

.segmented .active {
  background: linear-gradient(135deg, #22d3ee, #0f766e);
}

.room-list,
.compact-list,
.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.room-list li,
.compact-list li,
.history-list li {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(71, 85, 105, 0.34);
  overflow-wrap: anywhere;
}

.room-list li {
  cursor: pointer;
}

.room-list li.active {
  border-color: rgba(34, 211, 238, 0.7);
  background: rgba(8, 47, 73, 0.9);
}

.detail-panel {
  margin-top: 20px;
}

.error-banner,
.error-text {
  color: #fecaca;
}

.error-banner {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(127, 29, 29, 0.45);
  border: 1px solid rgba(248, 113, 113, 0.4);
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
