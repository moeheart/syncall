const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const { SyncManager } = require("../src/electron/services/sync-manager.cjs");

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
    getServerUrl: () => "http://localhost:4000",
    getVersionHead: () => null,
    setVersionHead: async () => {},
    removeVersionHead: async () => {}
  };
}

test("shutdown cancels pending uploads before they run", async () => {
  const rootDir = createTempRoot();

  try {
    const filePath = path.join(rootDir, "live.log");
    fs.writeFileSync(filePath, "hello", "utf8");

    const manager = new SyncManager({
      store: createStore(rootDir),
      apiClient: {},
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
      apiClient: {},
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
