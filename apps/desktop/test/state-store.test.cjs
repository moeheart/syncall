const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const { StateStore } = require("../src/electron/services/state-store.cjs");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "syncall-state-store-"));
}

function cleanupTempRoot(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

test("StateStore resets older profile state when a newer app edition loads it", async () => {
  const rootDir = createTempRoot();

  try {
    const statePath = path.join(rootDir, "state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      profileName: "alice",
      stateVersion: "0.1.0",
      serverUrl: "http://custom.example",
      token: "stale-token",
      user: { id: "u1", username: "alice", email: "alice@example.com" },
      bindings: { room1: { folderPath: "C:\\syncall-test\\alice" } },
      versionHeads: { room1: { "tracked.log": "v1" } },
      joinedRooms: ["room1"],
      roomSyncModes: { room1: "RUNNING" },
      roomStatusCache: { room1: { roomId: "room1" } },
      panelReadAt: { invites: "2026-04-01T00:00:00.000Z", activity: "2026-04-01T00:00:00.000Z" },
      noticeUnreadCount: 5
    }, null, 2));

    const store = new StateStore(statePath, {
      appVersion: "1.0.0",
      profileName: "alice"
    });

    const state = await store.load();

    assert.equal(state.profileName, "alice");
    assert.equal(state.stateVersion, "1.0.0");
    assert.equal(state.serverUrl, "http://custom.example");
    assert.equal(state.token, "");
    assert.equal(state.user, null);
    assert.deepEqual(state.bindings, {});
    assert.deepEqual(state.versionHeads, {});
    assert.deepEqual(state.joinedRooms, []);
    assert.deepEqual(state.roomSyncModes, {});
    assert.deepEqual(state.roomStatusCache, {});
    assert.deepEqual(state.panelReadAt, { invites: null, activity: null });
    assert.equal(state.noticeUnreadCount, 0);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("StateStore resets mismatched profile files to the active profile name", async () => {
  const rootDir = createTempRoot();

  try {
    const statePath = path.join(rootDir, "state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      profileName: "bob",
      stateVersion: "1.0.0",
      token: "stale-token"
    }, null, 2));

    const store = new StateStore(statePath, {
      appVersion: "1.0.0",
      profileName: "alice"
    });

    const state = await store.load();

    assert.equal(state.profileName, "alice");
    assert.equal(state.stateVersion, "1.0.0");
    assert.equal(state.token, "");
  } finally {
    cleanupTempRoot(rootDir);
  }
});
