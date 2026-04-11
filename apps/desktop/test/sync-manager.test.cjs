const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const { SyncManager, deriveFileStatus } = require("../src/electron/services/sync-manager.cjs");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "syncall-sync-manager-"));
}

function cleanupTempRoot(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

function createStore(rootDir) {
  return {
    getToken: () => "",
    getBindings: () => ({ room1: { folderPath: rootDir } }),
    getBinding: () => ({ folderPath: rootDir }),
    setBinding: async () => {},
    getJoinedRooms: () => ["room1"],
    setJoinedRooms: async () => {},
    getServerUrl: () => "http://localhost:4000",
    getVersionHead: () => null,
    setVersionHead: async () => {},
    removeVersionHead: async () => {},
    getRoomSyncMode: () => "PAUSED",
    setRoomSyncMode: async () => {},
    setRoomStatusCache: async () => {}
  };
}

test("shutdown cancels pending uploads before they run", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "live.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {},
      uploadIdleMs: 25
    });

    let uploadCount = 0;
    manager.uploadFromPath = async () => {
      uploadCount += 1;
    };

    manager.scheduleUpload("room1", rootDir, filePath);
    await manager.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(uploadCount, 0);
    assert.equal(manager.pendingUploads.size, 0);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("scheduleUpload ignores new work after shutdown begins", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "tail.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {},
      uploadIdleMs: 25
    });

    await manager.shutdown();
    manager.scheduleUpload("room1", rootDir, filePath);

    assert.equal(manager.pendingUploads.size, 0);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("bindFolder keeps the room paused and does not start a watcher immediately", async () => {
  const rootDir = createTempRoot();
  const bindings = {};

  try {
    const store = {
      ...createStore(rootDir),
      getBindings: () => bindings,
      getBinding: (roomId) => bindings[roomId] ?? null,
      setBinding: async (roomId, binding) => {
        bindings[roomId] = binding;
      }
    };

    const manager = new SyncManager({
      store,
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    await manager.bindFolder("room1", rootDir);

    assert.equal(manager.watchers.size, 0);
    assert.equal(store.getBinding("room1").folderPath, rootDir);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("deriveFileStatus classifies common room file states", () => {
  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: false,
      isRunning: false
    }),
    "OFFLINE"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: false,
      hasRemoteFile: true,
      isRunning: false
    }),
    "REMOTE"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: true,
      isRunning: false,
      localChecksum: "a",
      remoteChecksum: "a"
    }),
    "SYNCED"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: true,
      isRunning: false,
      localChecksum: "a",
      remoteChecksum: "b",
      matchedVersionId: null,
      remoteVersionId: "v1"
    }),
    "MODIFIED_LOCAL"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: true,
      isRunning: false,
      localChecksum: "a",
      remoteChecksum: "b",
      matchedVersionId: "v1",
      remoteVersionId: "v2"
    }),
    "MODIFIED_REMOTE"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: true,
      isRunning: false,
      localChecksum: "a",
      remoteChecksum: "b",
      matchedVersionId: "v2",
      remoteVersionId: "v2"
    }),
    "SYNCED"
  );

  assert.equal(
    deriveFileStatus({
      hasLocalFile: true,
      hasRemoteFile: true,
      isRunning: true,
      localChecksum: "a",
      remoteChecksum: "b"
    }),
    "RUNNING"
  );
});
