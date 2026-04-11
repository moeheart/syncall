<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { CompatibilitySummary, InviteSummary, RoomSummary, SyncEventSummary } from "@syncall/shared";

const apiBaseUrl = ref("http://syncall.moeheart.cn");
const clientVersion = "1.0.0";
const token = ref(localStorage.getItem("syncall-web-token") ?? "");
const email = ref("");
const password = ref("");
const errorMessage = ref("");
const loading = ref(false);
const compatibility = ref<CompatibilitySummary | null>(null);
const rooms = ref<RoomSummary[]>([]);
const invites = ref<InviteSummary[]>([]);
const events = ref<SyncEventSummary[]>([]);

const isAuthenticated = computed(() => token.value.length > 0);

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl.value}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Syncall-Client-Version": clientVersion,
      "X-Syncall-Client-Name": "web",
      ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    if ((payload as { code?: string }).code === "CLIENT_VERSION_UNSUPPORTED") {
      throw new Error(
        `${(payload as { message: string }).message} Minimum supported client edition: ${(payload as { minimumCompatibleClientVersion: string }).minimumCompatibleClientVersion}.`
      );
    }
    throw new Error(payload.message ?? "Request failed.");
  }

  return response.json() as Promise<T>;
}

async function login() {
  errorMessage.value = "";
  loading.value = true;

  try {
    const payload = await fetchJson<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: email.value,
        password: password.value
      })
    });
    token.value = payload.token;
    localStorage.setItem("syncall-web-token", payload.token);
    await refreshDashboard();
  } catch (error) {
    errorMessage.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
}

async function refreshDashboard() {
  if (!token.value) {
    return;
  }

  const [roomPayload, invitePayload, activityPayload] = await Promise.all([
    fetchJson<{ rooms: RoomSummary[] }>("/rooms"),
    fetchJson<{ invites: InviteSummary[] }>("/invites"),
    fetchJson<{ events: SyncEventSummary[] }>("/activity")
  ]);

  rooms.value = roomPayload.rooms;
  invites.value = invitePayload.invites;
  events.value = activityPayload.events;
}

async function loadCompatibility() {
  compatibility.value = await fetchJson<CompatibilitySummary>("/auth/compatibility");
}

function logout() {
  token.value = "";
  rooms.value = [];
  invites.value = [];
  events.value = [];
  localStorage.removeItem("syncall-web-token");
}

onMounted(async () => {
  try {
    await loadCompatibility();
  } catch {
    compatibility.value = null;
  }

  if (token.value) {
    try {
      await refreshDashboard();
    } catch {
      logout();
    }
  }
});
</script>

<template>
  <main class="page-shell">
    <section class="hero-card">
      <div>
        <p class="eyebrow">Windows-first real-time sync</p>
        <h1>Syncall keeps shared log folders moving without the usual friction.</h1>
        <p class="lede">
          Desktop clients watch one local folder per room, upload whole-file gzip versions through the
          server, and preserve rollback history with conflict-safe copies.
        </p>
      </div>
      <div class="stats-grid">
        <article>
          <strong>Compression-first</strong>
          <span>Gzip in transfer and storage for text-heavy log files.</span>
        </article>
        <article>
          <strong>Room-based</strong>
          <span>Trusted small-team collaboration with username invites.</span>
        </article>
        <article>
          <strong>Recoverable</strong>
          <span>Per-file history and restore flows without losing newer work.</span>
        </article>
      </div>
    </section>

    <section class="panel-grid">
      <article class="panel">
        <div class="panel-header">
          <h2>Website access</h2>
          <button v-if="isAuthenticated" class="ghost-button" @click="logout">Sign out</button>
        </div>
        <p class="muted">
          This lightweight surface is for project overview and status checks. The Electron client remains
          the main product experience.
        </p>
        <p class="muted">Web edition {{ clientVersion }}<span v-if="compatibility"> | server requires {{ compatibility.minimumCompatibleClientVersion }}+</span></p>
        <form v-if="!isAuthenticated" class="login-form" @submit.prevent="login">
          <label>
            API base URL
            <input v-model="apiBaseUrl" type="url" required />
          </label>
          <label>
            Email
            <input v-model="email" type="email" required />
          </label>
          <label>
            Password
            <input v-model="password" type="password" required />
          </label>
          <button type="submit" :disabled="loading">{{ loading ? "Signing in..." : "Sign in" }}</button>
        </form>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </article>

      <article class="panel">
        <div class="panel-header">
          <h2>Current rooms</h2>
          <button v-if="isAuthenticated" class="ghost-button" @click="refreshDashboard">Refresh</button>
        </div>
        <ul v-if="rooms.length" class="summary-list">
          <li v-for="room in rooms" :key="room.id">
            <strong>{{ room.name }}</strong>
            <span>{{ room.memberCount }} members</span>
          </li>
        </ul>
        <p v-else class="muted">No rooms to show yet.</p>
      </article>

      <article class="panel">
        <h2>Pending invites</h2>
        <ul v-if="invites.length" class="summary-list">
          <li v-for="invite in invites" :key="invite.id">
            <strong>{{ invite.roomName }}</strong>
            <span>From {{ invite.inviterUsername }}</span>
          </li>
        </ul>
        <p v-else class="muted">No pending invites.</p>
      </article>

      <article class="panel">
        <h2>Recent activity</h2>
        <ul v-if="events.length" class="summary-list">
          <li v-for="event in events" :key="event.id">
            <strong>{{ event.type }}</strong>
            <span>{{ event.relativePath }} by {{ event.actorUsername }}</span>
          </li>
        </ul>
        <p v-else class="muted">No recent sync events.</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  min-width: 320px;
  font-family: "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(106, 188, 255, 0.25), transparent 38%),
    linear-gradient(180deg, #061626 0%, #0b1f36 42%, #102e4d 100%);
  color: #eff6ff;
}

.page-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 20px 56px;
}

.hero-card,
.panel {
  border: 1px solid rgba(173, 216, 255, 0.22);
  border-radius: 24px;
  background: rgba(10, 28, 48, 0.82);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
}

.hero-card {
  display: grid;
  gap: 24px;
  padding: 28px;
}

.eyebrow {
  margin: 0 0 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #7dd3fc;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 14px;
  font-size: clamp(2rem, 5vw, 3.75rem);
  line-height: 1.05;
}

.lede,
.muted {
  color: rgba(226, 232, 240, 0.84);
}

.stats-grid,
.panel-grid {
  display: grid;
  gap: 18px;
}

.stats-grid article,
.panel {
  padding: 18px;
}

.stats-grid article {
  display: grid;
  gap: 8px;
  border-radius: 18px;
  background: rgba(125, 211, 252, 0.08);
}

.panel-grid {
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  margin-top: 22px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.login-form,
.summary-list {
  display: grid;
  gap: 12px;
}

.summary-list {
  padding: 0;
  list-style: none;
}

.summary-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.summary-list li:first-child {
  border-top: none;
}

label {
  display: grid;
  gap: 8px;
  font-weight: 600;
}

input,
button {
  border: none;
  border-radius: 12px;
  font: inherit;
}

input {
  padding: 12px 14px;
  background: rgba(226, 232, 240, 0.12);
  color: inherit;
}

button {
  padding: 12px 14px;
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  color: white;
  font-weight: 700;
  cursor: pointer;
}

.ghost-button {
  background: rgba(226, 232, 240, 0.08);
}

.error-text {
  color: #fda4af;
}

@media (min-width: 900px) {
  .hero-card {
    grid-template-columns: 1.2fr 1fr;
    align-items: stretch;
  }
}
</style>
