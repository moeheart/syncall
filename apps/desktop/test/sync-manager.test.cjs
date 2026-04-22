const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const {
  BUILT_IN_IGNORED_PATTERNS,
  SyncManager,
  deriveFileStatus,
  shouldNotifyRoomFileRefresh
} = require("../src/electron/services/sync-manager.cjs");

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
    getServerUrl: () => "http://syncall.moeheart.cn",
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

test("scheduleUpload settles tracked edits into a status refresh without uploading", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "tracked.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const notifications = [];
    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: (type, payload) => {
        notifications.push({ type, payload });
      },
      uploadIdleMs: 25
    });

    let uploadCount = 0;
    manager.uploadFromPath = async () => {
      uploadCount += 1;
    };
    manager.refreshRoomStatus = async () => [
      {
        relativePath: "tracked.log",
        status: "MODIFIED_LOCAL"
      }
    ];

    manager.scheduleUpload("room1", rootDir, filePath);
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(uploadCount, 0);
    assert.equal(manager.pendingUploads.size, 0);
    assert.deepEqual(
      notifications.map((event) => [event.type, event.payload.status]),
      [
        ["sync:status-changed", "RUNNING"],
        ["sync:status-changed", "MODIFIED_LOCAL"]
      ]
    );
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("scheduleUpload uploads newly created files when auto-sync is enabled", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "new.log");
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

    manager.scheduleUpload("room1", rootDir, filePath, { uploadAfterQuiet: true });
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(uploadCount, 1);
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

test("handleLocalChange auto-syncs new files created after room sync has started", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "new.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const store = {
      ...createStore(rootDir),
      getRoomSyncMode: () => "RUNNING"
    };

    const manager = new SyncManager({
      store,
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    const scheduled = [];
    manager.scheduleUpload = (roomId, folderPath, absolutePath, options) => {
      scheduled.push({ roomId, folderPath, absolutePath, options });
    };
    manager.refreshRoomStatus = async () => [
      {
        relativePath: "new.log",
        status: "OFFLINE",
        remoteExists: false
      }
    ];

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.deepEqual(scheduled, [
      {
        roomId: "room1",
        folderPath: rootDir,
        absolutePath: filePath,
        options: { uploadAfterQuiet: true }
      }
    ]);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalChange ignores temporary .jcl.log files", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "combat", "foo.jcl.log");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    let refreshCount = 0;
    let scheduled = 0;
    manager.refreshRoomStatus = async () => {
      refreshCount += 1;
      return [];
    };
    manager.scheduleUpload = () => {
      scheduled += 1;
    };

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.equal(refreshCount, 0);
    assert.equal(scheduled, 0);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalChange auto-syncs a final .jcl file after temp rename", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "combat", "foo.jcl");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "hello", "utf8");

    const store = {
      ...createStore(rootDir),
      getRoomSyncMode: () => "RUNNING"
    };

    const manager = new SyncManager({
      store,
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    const scheduled = [];
    manager.scheduleUpload = (roomId, folderPath, absolutePath, options) => {
      scheduled.push({ roomId, folderPath, absolutePath, options });
    };
    manager.refreshRoomStatus = async () => [
      {
        relativePath: "combat/foo.jcl",
        status: "OFFLINE",
        remoteExists: false
      }
    ];

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.deepEqual(scheduled, [
      {
        roomId: "room1",
        folderPath: rootDir,
        absolutePath: filePath,
        options: { uploadAfterQuiet: true }
      }
    ]);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalChange keeps offline-only files manual", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "offline.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    let scheduled = 0;
    manager.scheduleUpload = () => {
      scheduled += 1;
    };
    manager.refreshRoomStatus = async () => [
      {
        relativePath: "offline.log",
        status: "OFFLINE",
        remoteExists: false
      }
    ];

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.equal(scheduled, 0);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalChange notifies the renderer for visible offline-only local files", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "offline.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const notifications = [];
    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: (type, payload) => {
        notifications.push({ type, payload });
      }
    });

    manager.refreshRoomStatus = async () => [
      {
        relativePath: "offline.log",
        status: "OFFLINE",
        remoteExists: false,
        localExists: true,
        remoteSize: null,
        localSize: 5,
        ownerUsername: null,
        localModifiedAt: "2026-04-21T00:00:00.000Z",
        remoteModifiedAt: null,
        currentVersionId: null,
        currentVersionNumber: null
      }
    ];

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.deepEqual(notifications, [
      {
        type: "sync:status-changed",
        payload: {
          roomId: "room1",
          relativePath: "offline.log",
          status: "OFFLINE"
        }
      }
    ]);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalDelete notifies the renderer when a visible file disappears locally", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "tracked.log");
    const notifications = [];
    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: (type, payload) => {
        notifications.push({ type, payload });
      }
    });

    manager.roomStatusLists.set("room1", [
      {
        relativePath: "tracked.log",
        status: "SYNCED",
        localExists: true,
        remoteExists: true,
        remoteSize: 5,
        localSize: 5,
        ownerUsername: "alice",
        localModifiedAt: "2026-04-21T00:00:00.000Z",
        remoteModifiedAt: "2026-04-21T00:00:00.000Z",
        currentVersionId: "v1",
        currentVersionNumber: 1
      }
    ]);
    manager.refreshRoomStatus = async () => [];

    await manager.handleLocalDelete("room1", rootDir, filePath);

    assert.deepEqual(notifications, [
      {
        type: "sync:status-changed",
        payload: {
          roomId: "room1",
          relativePath: "tracked.log",
          status: null
        }
      }
    ]);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("handleLocalChange debounces tracked remote-backed edits", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "tracked.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {
        listFileStatuses: async () => ({ files: [] })
      },
      notify: () => {}
    });

    const scheduled = [];
    manager.scheduleUpload = (roomId, folderPath, absolutePath) => {
      scheduled.push({ roomId, folderPath, absolutePath });
    };
    manager.refreshRoomStatus = async () => [
      {
        relativePath: "tracked.log",
        status: "MODIFIED_LOCAL",
        remoteExists: true
      }
    ];

    await manager.handleLocalChange("room1", rootDir, filePath);

    assert.deepEqual(scheduled, [
      {
        roomId: "room1",
        folderPath: rootDir,
        absolutePath: filePath
      }
    ]);
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("built-in ignored patterns include temporary .jcl.log files", () => {
  assert.equal(BUILT_IN_IGNORED_PATTERNS.some((pattern) => pattern.test("foo.jcl.log")), true);
});

test("shouldNotifyRoomFileRefresh detects meaningful room-table changes", () => {
  assert.equal(
    shouldNotifyRoomFileRefresh(null, {
      status: "OFFLINE",
      localExists: true,
      remoteExists: false
    }),
    true
  );

  assert.equal(
    shouldNotifyRoomFileRefresh(
      {
        status: "SYNCED",
        localExists: true,
        remoteExists: true,
        ownerUsername: "alice",
        localSize: 1,
        remoteSize: 1,
        localModifiedAt: "a",
        remoteModifiedAt: "a",
        currentVersionId: "v1",
        currentVersionNumber: 1
      },
      {
        status: "SYNCED",
        localExists: true,
        remoteExists: true,
        ownerUsername: "alice",
        localSize: 1,
        remoteSize: 1,
        localModifiedAt: "a",
        remoteModifiedAt: "a",
        currentVersionId: "v1",
        currentVersionNumber: 1
      }
    ),
    false
  );
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
