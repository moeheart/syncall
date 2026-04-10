import path from "node:path";

export function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid relative path.");
  }

  return normalized;
}

export function buildConflictPath(relativePath: string, username: string, at = new Date()): string {
  const parsed = path.posix.parse(relativePath);
  const timestamp = at.toISOString().replace(/[:.]/g, "-");
  return path.posix.join(parsed.dir, `${parsed.name}.conflict-${username}-${timestamp}${parsed.ext}`);
}

