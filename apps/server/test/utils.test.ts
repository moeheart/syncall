import { describe, expect, it } from "vitest";
import { compressBuffer, decompressBuffer } from "../src/utils/compression";
import { buildConflictPath, normalizeRelativePath } from "../src/utils/paths";
import { sha256 } from "../src/utils/checksum";

describe("compression utilities", () => {
  it("round-trips text buffers through gzip", async () => {
    const input = Buffer.from("error\n".repeat(200), "utf8");
    const compressed = await compressBuffer(input);
    const restored = await decompressBuffer(compressed);

    expect(restored.equals(input)).toBe(true);
    expect(compressed.byteLength).toBeLessThan(input.byteLength);
  });
});

describe("path helpers", () => {
  it("normalizes Windows separators", () => {
    expect(normalizeRelativePath("logs\\today\\service.log")).toBe("logs/today/service.log");
  });

  it("rejects parent traversal", () => {
    expect(() => normalizeRelativePath("../secret.txt")).toThrow(/Invalid relative path/);
  });

  it("creates timestamped conflict file names", () => {
    const conflictPath = buildConflictPath("logs/service.log", "alice", new Date("2026-04-09T12:00:00.000Z"));
    expect(conflictPath).toContain("service.conflict-alice-2026-04-09T12-00-00-000Z.log");
  });
});

describe("checksum helper", () => {
  it("produces stable SHA-256 hashes", () => {
    expect(sha256(Buffer.from("syncall", "utf8"))).toBe("a178fbf69d7ee812f1209f22ca6c90626bdef62b7637934e08a73edbabb2bbbf");
  });
});
