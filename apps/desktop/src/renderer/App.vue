<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  CompatibilitySummary,
  FileStatus,
  FileVersionSummary,
  InviteSummary,
  NotificationSummary,
  RoomFileStatusSummary,
  RoomMemberSummary,
  RoomSummary,
  RoomSyncStateSummary,
  SyncEventSummary,
  UserSummary
} from "@syncall/shared";

interface DesktopState {
  appVersion: string;
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
  roomStates: RoomSyncStateSummary[];
  notifications: NotificationSummary;
  bindings: Record<string, { folderPath: string }>;
  user: DesktopState["user"];
  serverUrl: string;
  profile: string;
  appVersion: string;
}

declare global {
  interface Window {
    syncall: {
      getState: () => Promise<DesktopState>;
      getCompatibility: () => Promise<CompatibilitySummary>;
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
      listRoomFiles: (roomId: string) => Promise<{ files: RoomFileStatusSummary[] }>;
      startRoomSync: (roomId: string) => Promise<DashboardPayload>;
      pauseRoomSync: (roomId: string) => Promise<DashboardPayload>;
      syncFile: (roomId: string, relativePath: string) => Promise<{ files: RoomFileStatusSummary[] }>;
      syncAllOffline: (roomId: string) => Promise<{ files: RoomFileStatusSummary[] }>;
      resolveModifiedLocal: (roomId: string, relativePath: string) => Promise<{ files: RoomFileStatusSummary[] }>;
      resolveModifiedRemote: (roomId: string, relativePath: string) => Promise<{ files: RoomFileStatusSummary[] }>;
      markPanelRead: (panelId: "invites" | "activity" | "notices") => Promise<{ success: boolean }>;
      listHistory: (roomId: string, relativePath: string) => Promise<{ versions: FileVersionSummary[] }>;
      restoreVersion: (roomId: string, versionId: string) => Promise<FileVersionSummary>;
      onEvent: (callback: (payload: { type: string; payload: unknown }) => void) => () => void;
    };
  }
}

const state = ref<DesktopState>({ appVersion: "1.0.0", serverUrl: "http://syncall.moeheart.cn", token: "", user: null, bindings: {} });
const rooms = ref<RoomSummary[]>([]);
const invites = ref<InviteSummary[]>([]);
const events = ref<SyncEventSummary[]>([]);
const users = ref<UserSummary[]>([]);
const roomStates = ref<RoomSyncStateSummary[]>([]);
const notifications = ref<NotificationSummary>({ invitesUnread: 0, noticesUnread: 0, activityUnread: 0 });
const members = ref<RoomMemberSummary[]>([]);
const roomFiles = ref<RoomFileStatusSummary[]>([]);
const notices = ref<string[]>([]);
const selectedRoomId = ref("");
const selectedHistoryPath = ref("");
const historyVersions = ref<FileVersionSummary[]>([]);
const loading = ref(false);
const authMode = ref<"login" | "register">("login");
const username = ref("");
const email = ref("");
const password = ref("");
const newRoomName = ref("");
const inviteUsername = ref("");
const userSearch = ref("");
const serverUrlInput = ref("http://syncall.moeheart.cn");
const errorMessage = ref("");
const profileName = ref("default");
const activeDrawer = ref<"invites" | "activity" | "notices" | "history" | null>(null);
const ignoredRoomSelection = ref<string | null>(null);
const serverCompatibility = ref<CompatibilitySummary | null>(null);
const bridgeReady = computed(() => typeof window !== "undefined" && typeof window.syncall !== "undefined");

const isAuthenticated = computed(() => Boolean(state.value.token && state.value.user));
const selectedRoom = computed(() => rooms.value.find((room) => room.id === selectedRoomId.value) ?? null);
const selectedRoomState = computed(() => roomStates.value.find((roomState) => roomState.roomId === selectedRoomId.value) ?? null);
const selectedRoomHasBinding = computed(() => Boolean(selectedRoomState.value?.folderPath));
const filteredUsers = computed(() => {
  const query = userSearch.value.trim().toLowerCase();
  const memberUsernames = new Set(members.value.map((member) => member.username));
  return users.value.filter((user) => !memberUsernames.has(user.username) && (!query || user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)));
});
const offlineFileCount = computed(() => roomFiles.value.filter((file) => file.status === "OFFLINE").length);

function applyDashboard(payload: DashboardPayload) {
  const previousSelection = selectedRoomId.value;
  rooms.value = payload.rooms;
  invites.value = payload.invites;
  events.value = payload.events;
  users.value = payload.users;
  roomStates.value = payload.roomStates;
  notifications.value = payload.notifications;
  state.value.user = payload.user;
  state.value.serverUrl = payload.serverUrl;
  state.value.appVersion = payload.appVersion;
  state.value.bindings = payload.bindings;
  state.value.token = payload.user ? "session" : "";
  serverUrlInput.value = payload.serverUrl;
  profileName.value = payload.profile;
  if (payload.rooms.length === 0) {
    selectedRoomId.value = "";
    members.value = [];
    roomFiles.value = [];
    return;
  }
  const nextSelection = payload.rooms.some((room) => room.id === previousSelection) ? previousSelection : payload.rooms[0].id;
  if (nextSelection !== selectedRoomId.value) {
    ignoredRoomSelection.value = nextSelection;
    selectedRoomId.value = nextSelection;
  }
}

async function loadMembers(roomId: string) {
  if (!bridgeReady.value || !roomId) return;
  members.value = (await window.syncall.listRoomMembers(roomId)).members;
}

async function loadRoomFiles(roomId: string) {
  if (!bridgeReady.value || !roomId || !selectedRoomHasBinding.value) {
    roomFiles.value = [];
    return;
  }
  roomFiles.value = (await window.syncall.listRoomFiles(roomId)).files;
}

async function refreshSelectedRoom() {
  if (!selectedRoomId.value) {
    members.value = [];
    roomFiles.value = [];
    return;
  }
  await Promise.all([loadMembers(selectedRoomId.value), loadRoomFiles(selectedRoomId.value)]);
}

async function refreshDashboard() {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  applyDashboard(await window.syncall.fetchDashboard());
  await refreshSelectedRoom();
}

async function saveServerUrl() {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge is unavailable. Please restart the client.";
    return;
  }
  state.value = await window.syncall.setServerUrl(serverUrlInput.value);
  try {
    serverCompatibility.value = await window.syncall.getCompatibility();
  } catch {
    serverCompatibility.value = null;
  }
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
    const payload = authMode.value === "login"
      ? await window.syncall.login({ email: email.value, password: password.value })
      : await window.syncall.register({ username: username.value, email: email.value, password: password.value });
    applyDashboard(payload);
    await refreshSelectedRoom();
  } catch (error) {
    errorMessage.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
}

async function createRoom() {
  if (!newRoomName.value || !bridgeReady.value) return;
  applyDashboard(await window.syncall.createRoom(newRoomName.value));
  newRoomName.value = "";
  await refreshSelectedRoom();
}

async function inviteUser(usernameToInvite = inviteUsername.value) {
  if (!selectedRoomId.value || !usernameToInvite || !bridgeReady.value) return;
  errorMessage.value = "";
  try {
    applyDashboard(await window.syncall.inviteUser(selectedRoomId.value, usernameToInvite));
    inviteUsername.value = "";
    userSearch.value = "";
    await refreshSelectedRoom();
  } catch (error) {
    errorMessage.value = (error as Error).message;
  }
}

async function acceptInvite(inviteId: string) {
  if (!bridgeReady.value) return;
  applyDashboard(await window.syncall.acceptInvite(inviteId));
  await refreshSelectedRoom();
}

async function bindFolder(roomId: string) {
  if (!bridgeReady.value) return;
  const folderPath = await window.syncall.chooseFolder();
  if (!folderPath) return;
  applyDashboard(await window.syncall.bindFolder(roomId, folderPath));
  await loadRoomFiles(roomId);
}

async function toggleRoomSync() {
  if (!selectedRoomId.value || !bridgeReady.value || !selectedRoomState.value) return;
  const payload = selectedRoomState.value.syncMode === "RUNNING"
    ? await window.syncall.pauseRoomSync(selectedRoomId.value)
    : await window.syncall.startRoomSync(selectedRoomId.value);
  applyDashboard(payload);
  await refreshSelectedRoom();
}

async function syncOfflineFile(relativePath: string) {
  if (!selectedRoomId.value || !bridgeReady.value) return;
  await window.syncall.syncFile(selectedRoomId.value, relativePath);
  await refreshDashboard();
}

async function syncAllOfflineFiles() {
  if (!selectedRoomId.value || !bridgeReady.value) return;
  if (offlineFileCount.value >= 5 && !window.confirm(`This room has ${offlineFileCount.value} offline files. Sync all of them now?`)) {
    return;
  }
  await window.syncall.syncAllOffline(selectedRoomId.value);
  await refreshDashboard();
}

async function resolveModifiedLocal(relativePath: string) {
  if (!selectedRoomId.value || !bridgeReady.value) return;
  await window.syncall.resolveModifiedLocal(selectedRoomId.value, relativePath);
  await refreshDashboard();
}

async function resolveModifiedRemote(relativePath: string) {
  if (!selectedRoomId.value || !bridgeReady.value) return;
  await window.syncall.resolveModifiedRemote(selectedRoomId.value, relativePath);
  await refreshDashboard();
}

async function openDrawer(panelId: "invites" | "activity" | "notices") {
  if (!bridgeReady.value) return;
  activeDrawer.value = panelId;
  await window.syncall.markPanelRead(panelId);
  notifications.value = {
    ...notifications.value,
    invitesUnread: panelId === "invites" ? 0 : notifications.value.invitesUnread,
    activityUnread: panelId === "activity" ? 0 : notifications.value.activityUnread,
    noticesUnread: panelId === "notices" ? 0 : notifications.value.noticesUnread
  };
}

function closeDrawer() {
  activeDrawer.value = null;
}

async function loadHistory(relativePath: string) {
  if (!selectedRoomId.value || !relativePath || !bridgeReady.value) return;
  selectedHistoryPath.value = relativePath;
  historyVersions.value = (await window.syncall.listHistory(selectedRoomId.value, relativePath)).versions;
  activeDrawer.value = "history";
}

async function restoreVersion(versionId: string) {
  if (!selectedRoomId.value || !bridgeReady.value) return;
  await window.syncall.restoreVersion(selectedRoomId.value, versionId);
  await loadHistory(selectedHistoryPath.value);
  await refreshDashboard();
}

async function logout() {
  if (!bridgeReady.value) return;
  state.value = await window.syncall.logout();
  rooms.value = [];
  invites.value = [];
  events.value = [];
  users.value = [];
  roomStates.value = [];
  members.value = [];
  roomFiles.value = [];
  notices.value = [];
  historyVersions.value = [];
  notifications.value = { invitesUnread: 0, noticesUnread: 0, activityUnread: 0 };
  selectedRoomId.value = "";
  activeDrawer.value = null;
}

function formatBytes(size: number | null) {
  if (size == null) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "--";
}

function statusTone(status: FileStatus) {
  if (status === "SYNCED") return "success";
  if (status === "RUNNING") return "warning";
  if (status === "MODIFIED_LOCAL" || status === "MODIFIED_REMOTE") return "danger";
  return "neutral";
}

function fileActionLabel(status: FileStatus) {
  if (status === "OFFLINE") return "Sync";
  if (status === "REMOTE") return "Download";
  if (status === "MODIFIED_LOCAL") return "Upload Local";
  if (status === "MODIFIED_REMOTE") return "Download Remote";
  return "";
}

async function runPrimaryFileAction(file: RoomFileStatusSummary) {
  if (file.status === "OFFLINE") {
    await syncOfflineFile(file.relativePath);
  } else if (file.status === "REMOTE" || file.status === "MODIFIED_REMOTE") {
    await resolveModifiedRemote(file.relativePath);
  } else if (file.status === "MODIFIED_LOCAL") {
    await resolveModifiedLocal(file.relativePath);
  }
}

watch(selectedRoomId, async () => {
  if (ignoredRoomSelection.value && ignoredRoomSelection.value === selectedRoomId.value) {
    ignoredRoomSelection.value = null;
    return;
  }
  if (selectedRoomId.value) {
    await refreshSelectedRoom();
  } else {
    members.value = [];
    roomFiles.value = [];
  }
});

onMounted(async () => {
  if (!bridgeReady.value) {
    errorMessage.value = "Desktop bridge failed to load. Close the app and open the newest build.";
    return;
  }
  state.value = await window.syncall.getState();
  serverUrlInput.value = state.value.serverUrl;
  try {
    serverCompatibility.value = await window.syncall.getCompatibility();
  } catch {
    serverCompatibility.value = null;
  }
  if (state.value.token) {
    try {
      await refreshDashboard();
    } catch (error) {
      errorMessage.value = (error as Error).message;
    }
  }
  window.syncall.onEvent(({ type, payload }) => {
    notices.value = [`${type}: ${JSON.stringify(payload)}`, ...notices.value].slice(0, 40);
    if (!isAuthenticated.value) {
      return;
    }

    if (type === "invite:received") {
      void refreshDashboard();
      return;
    }

    if (type === "presence:update") {
      const roomId = (payload as { roomId?: string } | null)?.roomId;
      if (roomId && roomId === selectedRoomId.value) {
        void loadMembers(roomId);
      }
      return;
    }

    if (["sync:uploaded", "sync:downloaded", "sync:deleted", "sync:remote-delete", "sync:restore-completed", "sync:status-changed"].includes(type)) {
      const roomId = (payload as { roomId?: string } | null)?.roomId;
      if (roomId && roomId === selectedRoomId.value && selectedRoomHasBinding.value) {
        void loadRoomFiles(roomId);
      }
      return;
    }

    if (["sync:error", "socket:connected", "socket:disconnected"].includes(type)) {
      notifications.value = {
        ...notifications.value,
        noticesUnread: notifications.value.noticesUnread + 1
      };
    }
  });
});
</script>

<template>
  <main class="shell">
    <aside class="rail">
      <section class="card hero">
        <div class="between">
          <div>
            <p class="eyebrow">Syncall Desktop</p>
            <h1>Room-controlled sync for heavy log folders.</h1>
          </div>
          <span class="chip">{{ profileName }} | v{{ state.appVersion }}</span>
        </div>
        <p class="muted">Bind first, inspect status, then decide what enters sync.</p>
        <p class="muted" v-if="serverCompatibility">Server requires edition {{ serverCompatibility.minimumCompatibleClientVersion }} or newer.</p>
      </section>

      <section class="card">
        <div class="between">
          <h2>Server</h2>
          <button class="secondary" @click="saveServerUrl">Save</button>
        </div>
        <input v-model="serverUrlInput" type="url" />
      </section>

      <section v-if="!isAuthenticated" class="card">
        <div class="segmented">
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'">Login</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'">Register</button>
        </div>
        <input v-if="authMode === 'register'" v-model="username" placeholder="Username" />
        <input v-model="email" type="email" placeholder="Email" />
        <input v-model="password" type="password" placeholder="Password" />
        <button class="primary" @click="submitAuth">{{ loading ? "Working..." : authMode === "login" ? "Sign in" : "Create account" }}</button>
      </section>

      <template v-else>
        <section class="card">
          <div class="between">
            <div>
              <h2>{{ state.user?.username }}</h2>
              <p class="muted">{{ state.user?.email }}</p>
            </div>
            <button class="secondary" @click="logout">Log out</button>
          </div>
        </section>

        <section class="card">
          <div class="between">
            <h2>Rooms</h2>
            <button class="secondary" @click="refreshDashboard">Refresh</button>
          </div>
          <div class="inline">
            <input v-model="newRoomName" placeholder="Create a new room" />
            <button class="primary" @click="createRoom">Create</button>
          </div>
          <ul class="room-list">
            <li v-for="room in rooms" :key="room.id" :class="{ active: room.id === selectedRoomId }" @click="selectedRoomId = room.id">
              <div class="between">
                <strong>{{ room.name }}</strong>
                <span class="pill" :data-tone="roomStates.find((entry) => entry.roomId === room.id)?.syncMode === 'RUNNING' ? 'success' : 'neutral'">
                  {{ roomStates.find((entry) => entry.roomId === room.id)?.syncMode ?? "PAUSED" }}
                </span>
              </div>
              <small>{{ state.bindings[room.id]?.folderPath ?? "No folder bound" }}</small>
            </li>
          </ul>
        </section>

        <section class="card stack">
          <button class="drawer-btn" @click="openDrawer('invites')">
            <span>Invites</span>
            <span v-if="notifications.invitesUnread" class="bubble">{{ notifications.invitesUnread }}</span>
          </button>
          <button class="drawer-btn" @click="openDrawer('activity')">
            <span>Recent activity</span>
            <span v-if="notifications.activityUnread" class="bubble">{{ notifications.activityUnread }}</span>
          </button>
          <button class="drawer-btn" @click="openDrawer('notices')">
            <span>Notices</span>
            <span v-if="notifications.noticesUnread" class="bubble">{{ notifications.noticesUnread }}</span>
          </button>
        </section>
      </template>
    </aside>

    <section class="workspace">
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <template v-if="isAuthenticated && selectedRoom">
        <article class="card room-panel">
          <div class="between">
            <div>
              <p class="eyebrow">Room workspace</p>
              <h2>{{ selectedRoom.name }}</h2>
              <p class="muted">{{ selectedRoom.memberCount }} members in this room.</p>
            </div>
            <div class="inline">
              <button class="secondary" @click="openDrawer('invites')">Invite</button>
              <button class="secondary" @click="bindFolder(selectedRoom.id)">Bind Folder</button>
              <button class="primary" @click="toggleRoomSync">{{ selectedRoomState?.syncMode === "RUNNING" ? "Pause Sync" : "Start Sync" }}</button>
            </div>
          </div>

          <div class="stats">
            <span class="pill">{{ selectedRoomState?.folderPath ?? "No folder bound yet" }}</span>
            <span class="pill" :data-tone="selectedRoomState?.syncMode === 'RUNNING' ? 'success' : 'neutral'">{{ selectedRoomState?.syncMode ?? "PAUSED" }}</span>
            <span class="pill">Offline {{ selectedRoomState?.offlineCount ?? 0 }}</span>
            <span class="pill">Remote {{ selectedRoomState?.remoteCount ?? 0 }}</span>
            <span class="pill" data-tone="danger">Modified {{ (selectedRoomState?.modifiedLocalCount ?? 0) + (selectedRoomState?.modifiedRemoteCount ?? 0) }}</span>
            <span class="pill" data-tone="warning">Running {{ selectedRoomState?.runningCount ?? 0 }}</span>
          </div>

          <div class="members">
            <div v-for="member in members" :key="member.id" class="member">
              <div>
                <strong>{{ member.username }}</strong>
                <small>{{ member.role }}</small>
              </div>
              <span class="pill" :data-tone="member.syncState === 'SYNCING' ? 'success' : member.syncState === 'PAUSED' ? 'neutral' : 'danger'">
                {{ member.syncState ?? "OFFLINE" }}
              </span>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="between">
            <div>
              <h2>Folder binding</h2>
              <p class="muted">Existing local files stay offline until you promote them.</p>
            </div>
            <div class="inline">
              <button class="secondary" :disabled="offlineFileCount === 0" @click="syncAllOfflineFiles">Sync All Offline</button>
              <button class="secondary" @click="loadRoomFiles(selectedRoom.id)">Refresh Files</button>
            </div>
          </div>

          <div v-if="!selectedRoomState?.folderPath" class="empty">Bind a local folder to inspect files and room status.</div>

          <div v-else class="table-wrap">
            <table class="files">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Action</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="file in roomFiles" :key="file.relativePath">
                  <td><div class="file-name"><strong>{{ file.displayName }}</strong><small>{{ file.relativePath }}</small></div></td>
                  <td>{{ formatBytes(file.localSize ?? file.remoteSize) }}</td>
                  <td>{{ formatDate(file.localModifiedAt ?? file.remoteModifiedAt) }}</td>
                  <td>{{ file.ownerUsername ?? "--" }}</td>
                  <td><span class="pill" :data-tone="statusTone(file.status)">{{ file.status }}</span></td>
                  <td>
                    <button v-if="fileActionLabel(file.status)" class="secondary small" @click="runPrimaryFileAction(file)">{{ fileActionLabel(file.status) }}</button>
                    <span v-else class="muted">No action</span>
                  </td>
                  <td><button class="secondary small" @click="loadHistory(file.relativePath)">History</button></td>
                </tr>
                <tr v-if="roomFiles.length === 0"><td colspan="7" class="empty-row">No files detected for this room yet.</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </template>

      <article v-else-if="isAuthenticated" class="card empty">Choose or create a room to start organizing its sync workspace.</article>
      <article v-else class="card empty">Sign in to manage rooms, bind folders, and inspect file status before syncing.</article>
    </section>

    <div v-if="activeDrawer" class="overlay" @click.self="closeDrawer">
      <aside class="drawer">
        <div class="between">
          <h2 v-if="activeDrawer === 'invites'">Invites</h2>
          <h2 v-else-if="activeDrawer === 'activity'">Recent activity</h2>
          <h2 v-else-if="activeDrawer === 'notices'">Notices</h2>
          <h2 v-else>Version history</h2>
          <button class="secondary" @click="closeDrawer">Close</button>
        </div>

        <template v-if="activeDrawer === 'invites'">
          <div v-if="selectedRoom" class="stack">
            <h3>Invite by username</h3>
            <div class="inline">
              <input v-model="inviteUsername" placeholder="Username" />
              <button class="primary" @click="inviteUser()">Invite</button>
            </div>
            <input v-model="userSearch" placeholder="Search users" />
            <ul class="drawer-list">
              <li v-for="user in filteredUsers" :key="user.id">
                <div><strong>{{ user.username }}</strong><small>{{ user.email }}</small></div>
                <button class="secondary small" @click="inviteUser(user.username)">Invite</button>
              </li>
            </ul>
          </div>

          <h3>Pending invites</h3>
          <ul class="drawer-list">
            <li v-for="invite in invites" :key="invite.id">
              <div><strong>{{ invite.roomName }}</strong><small>from {{ invite.inviterUsername }}</small></div>
              <button class="primary small" @click="acceptInvite(invite.id)">Accept</button>
            </li>
            <li v-if="invites.length === 0" class="muted">No pending invites.</li>
          </ul>
        </template>

        <ul v-else-if="activeDrawer === 'activity'" class="drawer-list">
          <li v-for="event in events" :key="event.id">
            <div><strong>{{ event.type }}</strong><small>{{ event.relativePath }}</small></div>
            <span class="muted">{{ event.actorUsername }} | {{ formatDate(event.createdAt) }}</span>
          </li>
          <li v-if="events.length === 0" class="muted">No room activity yet.</li>
        </ul>

        <ul v-else-if="activeDrawer === 'notices'" class="drawer-list">
          <li v-for="notice in notices" :key="notice">{{ notice }}</li>
          <li v-if="notices.length === 0" class="muted">Sync notices will appear here.</li>
        </ul>

        <template v-else>
          <p class="muted">{{ selectedHistoryPath || "Choose a file from the table to inspect history." }}</p>
          <ul class="drawer-list">
            <li v-for="version in historyVersions" :key="version.id">
              <div>
                <strong>#{{ version.versionNumber }} <span v-if="version.isCurrentHead">(current)</span></strong>
                <small>{{ formatDate(version.clientModifiedAt) }} | {{ version.uploaderUsername }} <span v-if="version.isConflict">| conflict</span></small>
              </div>
              <div class="between"><span>{{ formatBytes(version.originalSize) }} -> {{ formatBytes(version.compressedSize) }}</span><button class="secondary small" @click="restoreVersion(version.id)">Restore</button></div>
            </li>
            <li v-if="historyVersions.length === 0" class="muted">No version history loaded yet.</li>
          </ul>
        </template>
      </aside>
    </div>
  </main>
</template>

<style scoped>
:global(body) { margin: 0; font-family: "Segoe UI", sans-serif; background: linear-gradient(180deg, #08111d, #10233c); color: #e5edf7; }
:global(*) { box-sizing: border-box; }
.shell { display: grid; grid-template-columns: minmax(300px, 350px) minmax(0, 1fr); gap: 24px; min-height: 100vh; padding: 24px; align-items: start; }
.rail, .workspace, .stack { display: grid; gap: 18px; align-content: start; min-width: 0; }
.workspace > *, .rail > * { min-width: 0; }
.card, .drawer { border: 1px solid rgba(148,163,184,.16); background: rgba(10,18,30,.88); box-shadow: 0 24px 70px rgba(2,6,23,.35); min-width: 0; }
.card { border-radius: 24px; padding: 20px; overflow: hidden; }
.hero { background: radial-gradient(circle at top left, rgba(34,197,94,.18), transparent 38%), rgba(10,18,30,.88); }
.between, .inline, .segmented, .stats, .members { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.between { justify-content: space-between; }
.between > *, .inline > * { min-width: 0; }
.eyebrow { margin: 0 0 8px; color: #86efac; text-transform: uppercase; letter-spacing: .08em; font-size: .78rem; }
h1, h2, h3, p { margin-top: 0; }
h1, h2, h3, p, strong, small, span { overflow-wrap: anywhere; }
.muted, small { color: rgba(229,237,247,.7); }
.chip, .pill, .bubble { border-radius: 999px; white-space: nowrap; }
.chip, .pill { padding: 6px 10px; background: rgba(148,163,184,.14); border: 1px solid rgba(148,163,184,.18); max-width: 100%; }
.pill { white-space: normal; }
.pill[data-tone="success"] { background: rgba(22,101,52,.35); color: #bbf7d0; }
.pill[data-tone="warning"] { background: rgba(120,53,15,.35); color: #fde68a; }
.pill[data-tone="danger"] { background: rgba(127,29,29,.35); color: #fecaca; }
.bubble { min-width: 24px; padding: 4px 8px; text-align: center; font-size: .78rem; font-weight: 700; background: #fb7185; color: white; }
input, button { border: none; border-radius: 14px; font: inherit; }
input { width: 100%; padding: 12px 14px; background: rgba(15,23,42,.92); color: inherit; }
.inline input { flex: 1 1 220px; min-width: 0; }
.inline button { flex: 0 0 auto; }
button { cursor: pointer; color: white; transition: transform .12s ease, opacity .12s ease; }
button:hover { transform: translateY(-1px); }
button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.primary, .secondary, .drawer-btn { padding: 11px 14px; }
.primary { background: linear-gradient(135deg, #16a34a, #2563eb); font-weight: 700; }
.secondary, .drawer-btn, .segmented button { background: rgba(148,163,184,.14); }
.segmented .active { background: linear-gradient(135deg, #16a34a, #0f766e); }
.drawer-btn { display: flex; justify-content: space-between; width: 100%; }
.small { padding: 8px 10px; font-size: .88rem; }
.room-list, .drawer-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.room-list li, .drawer-list li, .member, .empty { border-radius: 18px; border: 1px solid rgba(71,85,105,.28); background: rgba(12,19,31,.74); }
.room-list li { padding: 14px; display: grid; gap: 8px; cursor: pointer; }
.room-list li.active { border-color: rgba(134,239,172,.45); background: rgba(20,42,28,.5); }
.member { padding: 12px 14px; display: flex; gap: 12px; justify-content: space-between; min-width: 210px; }
.room-panel { display: grid; gap: 18px; }
.room-panel .between:first-child { align-items: flex-start; }
.stats, .members { align-items: stretch; }
.table-wrap { overflow: auto; border-radius: 20px; border: 1px solid rgba(71,85,105,.28); }
.files { width: 100%; min-width: 860px; border-collapse: collapse; }
.files thead { background: rgba(15,23,42,.94); }
.files th, .files td { padding: 14px 16px; text-align: left; border-bottom: 1px solid rgba(71,85,105,.22); vertical-align: middle; }
.file-name { display: grid; gap: 4px; }
.files th, .files td, .room-list li, .drawer-list li, .member { overflow-wrap: anywhere; }
.empty { padding: 22px; text-align: center; color: rgba(229,237,247,.74); }
.empty-row { text-align: center; color: rgba(229,237,247,.64); }
.error { margin: 0; padding: 14px 16px; border-radius: 18px; background: rgba(127,29,29,.45); color: #fecaca; border: 1px solid rgba(248,113,113,.35); }
.overlay { position: fixed; inset: 0; background: rgba(2,6,23,.56); display: flex; justify-content: flex-end; padding: 24px; }
.drawer { width: min(480px, 100%); height: calc(100vh - 48px); border-radius: 28px; padding: 22px; overflow: auto; display: grid; gap: 18px; }
@media (max-width: 1180px) { .shell { grid-template-columns: 1fr; } .overlay { justify-content: center; } .drawer { height: min(80vh, 920px); } }
</style>
