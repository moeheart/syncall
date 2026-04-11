const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const {
  acquireProfileRuntimeSync,
  evaluateExistingProfileLock,
  resolveRequestedProfileName
} = require("../src/electron/services/profile-runtime.cjs");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "syncall-profile-runtime-"));
}

function cleanupTempRoot(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

test("resolveRequestedProfileName returns default when no profile is provided", () => {
  assert.deepEqual(resolveRequestedProfileName([], {}), {
    profileName: "default",
    explicit: false
  });
});

test("resolveRequestedProfileName prefers explicit argv profile", () => {
  assert.deepEqual(resolveRequestedProfileName(["--profile=alice"], {}), {
    profileName: "alice",
    explicit: true
  });
});

test("acquireProfileRuntimeSync reclaims malformed lock files", () => {
  const rootDir = createTempRoot();

  try {
    const lockDir = path.join(rootDir, "Syncall Desktop", "profiles", "default");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, ".profile.lock"), "not-json", "utf8");

    const runtime = acquireProfileRuntimeSync({
      appDataRoot: rootDir,
      argv: [],
      env: {},
      pid: 101,
      exePath: "C:\\Syncall\\Syncall.exe",
      getProcessExecutablePath: () => null
    });

    assert.equal(runtime.status, "acquired");
    assert.equal(runtime.profileName, "default");
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("evaluateExistingProfileLock rejects live locks from the same executable", () => {
  const rootDir = createTempRoot();

  try {
    const lockPath = path.join(rootDir, ".profile.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 200,
        profile: "bob",
        exePath: "C:\\Syncall\\Syncall.exe",
        createdAt: "2026-04-10T00:00:00.000Z"
      }),
      "utf8"
    );

    const result = evaluateExistingProfileLock({
      lockPath,
      currentExePath: "C:\\Syncall\\Syncall.exe",
      getProcessExecutablePath: () => "C:\\Syncall\\Syncall.exe"
    });

    assert.equal(result.action, "locked");
    assert.equal(result.lockData.profile, "bob");
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("evaluateExistingProfileLock reclaims stale locks when the process is gone", () => {
  const rootDir = createTempRoot();

  try {
    const lockPath = path.join(rootDir, ".profile.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 300,
        profile: "alice",
        exePath: "C:\\Syncall\\Syncall.exe",
        createdAt: "2026-04-10T00:00:00.000Z"
      }),
      "utf8"
    );

    const result = evaluateExistingProfileLock({
      lockPath,
      currentExePath: "C:\\Syncall\\Syncall.exe",
      getProcessExecutablePath: () => null
    });

    assert.equal(result.action, "reclaim");
  } finally {
    cleanupTempRoot(rootDir);
  }
});

test("evaluateExistingProfileLock reclaims locks when the pid belongs to a different executable", () => {
  const rootDir = createTempRoot();

  try {
    const lockPath = path.join(rootDir, ".profile.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 400,
        profile: "alice",
        exePath: "C:\\Syncall\\Syncall.exe",
        createdAt: "2026-04-10T00:00:00.000Z"
      }),
      "utf8"
    );

    const result = evaluateExistingProfileLock({
      lockPath,
      currentExePath: "C:\\Syncall\\Syncall.exe",
      getProcessExecutablePath: () => "C:\\Other\\Other.exe"
    });

    assert.equal(result.action, "reclaim");
  } finally {
    cleanupTempRoot(rootDir);
  }
});
