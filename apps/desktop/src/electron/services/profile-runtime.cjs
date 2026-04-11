const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function resolveRequestedProfileName(argv = [], env = {}) {
  const envProfile = String(env.SYNCALL_PROFILE ?? "").trim();
  if (envProfile) {
    return {
      profileName: envProfile,
      explicit: true
    };
  }

  const profileArgument = argv.find((value) => String(value).startsWith("--profile="));
  if (profileArgument) {
    const value = String(profileArgument).slice("--profile=".length).trim();
    return {
      profileName: value || "default",
      explicit: true
    };
  }

  const profileIndex = argv.findIndex((value) => value === "--profile");
  if (profileIndex >= 0) {
    const value = String(argv[profileIndex + 1] ?? "").trim();
    return {
      profileName: value || "default",
      explicit: true
    };
  }

  return {
    profileName: "default",
    explicit: false
  };
}

function normalizeExecutablePath(value) {
  if (!value) {
    return "";
  }

  return path.resolve(String(value)).toLowerCase();
}

function createProfileLockPayload({ pid, profileName, exePath, createdAt = new Date().toISOString() }) {
  return {
    pid,
    profile: profileName,
    exePath,
    createdAt
  };
}

function parseProfileLockContent(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.profile !== "string" ||
      !Number.isInteger(parsed.pid) ||
      typeof parsed.exePath !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getProcessExecutablePathSync(pid) {
  try {
    const command = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.ExecutablePath }`;
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }
    ).trim();

    return output || null;
  } catch {
    return null;
  }
}

function evaluateExistingProfileLock({ lockPath, currentExePath, getProcessExecutablePath = getProcessExecutablePathSync }) {
  let rawContent;
  try {
    rawContent = fs.readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        action: "acquire"
      };
    }

    return {
      action: "reclaim",
      reason: "unreadable-lock"
    };
  }

  const lockData = parseProfileLockContent(rawContent);
  if (!lockData) {
    return {
      action: "reclaim",
      reason: "invalid-lock"
    };
  }

  const runningExePath = getProcessExecutablePath(lockData.pid);
  if (!runningExePath) {
    return {
      action: "reclaim",
      reason: "stale-pid",
      lockData
    };
  }

  const normalizedRunningExePath = normalizeExecutablePath(runningExePath);
  const normalizedRecordedExePath = normalizeExecutablePath(lockData.exePath);
  const normalizedCurrentExePath = normalizeExecutablePath(currentExePath);

  if (
    normalizedRunningExePath !== normalizedRecordedExePath ||
    normalizedRunningExePath !== normalizedCurrentExePath
  ) {
    return {
      action: "reclaim",
      reason: "exe-mismatch",
      lockData
    };
  }

  return {
    action: "locked",
    lockData
  };
}

function acquireProfileRuntimeSync({
  appDataRoot,
  argv = process.argv,
  env = process.env,
  pid = process.pid,
  exePath = process.execPath,
  createdAt = new Date().toISOString(),
  getProcessExecutablePath = getProcessExecutablePathSync
}) {
  const requested = resolveRequestedProfileName(argv, env);
  const profilesRoot = path.join(appDataRoot, "Syncall Desktop", "profiles");
  const profileDir = path.join(profilesRoot, requested.profileName);
  const lockPath = path.join(profileDir, ".profile.lock");

  fs.mkdirSync(profileDir, { recursive: true });

  const existingLock = evaluateExistingProfileLock({
    lockPath,
    currentExePath: exePath,
    getProcessExecutablePath
  });

  if (existingLock.action === "locked") {
    return {
      status: "locked",
      profileName: requested.profileName,
      profileDir,
      lockPath,
      lockData: existingLock.lockData
    };
  }

  if (existingLock.action === "reclaim") {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {}
  }

  const payload = createProfileLockPayload({
    pid,
    profileName: requested.profileName,
    exePath,
    createdAt
  });

  let fileHandle = null;
  try {
    fileHandle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fileHandle, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    if (fileHandle !== null) {
      try {
        fs.closeSync(fileHandle);
      } catch {}
    }

    if (error.code === "EEXIST") {
      return {
        status: "locked",
        profileName: requested.profileName,
        profileDir,
        lockPath
      };
    }

    throw error;
  }

  if (fileHandle !== null) {
    fs.closeSync(fileHandle);
  }

  return {
    status: "acquired",
    profileName: requested.profileName,
    profileDir,
    lockPath,
    lockData: payload
  };
}

function releaseProfileLockSync(lockPath) {
  if (!lockPath) {
    return;
  }

  try {
    fs.rmSync(lockPath, { force: true });
  } catch {}
}

module.exports = {
  acquireProfileRuntimeSync,
  createProfileLockPayload,
  evaluateExistingProfileLock,
  parseProfileLockContent,
  releaseProfileLockSync,
  resolveRequestedProfileName
};
