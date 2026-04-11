import { describe, expect, it } from "vitest";
import {
  buildCompatibilityErrorPayload,
  compareEditions,
  isClientEditionCompatible,
  readClientEdition
} from "../src/utils/client-compatibility";

describe("client edition compatibility", () => {
  it("compares semantic-style editions correctly", () => {
    expect(compareEditions("1.0.0", "0.1.1")).toBeGreaterThan(0);
    expect(compareEditions("1.0.0", "1.0.0")).toBe(0);
    expect(compareEditions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("treats missing or legacy client editions as unsupported", () => {
    expect(isClientEditionCompatible(null)).toBe(false);
    expect(isClientEditionCompatible("0.1.0")).toBe(false);
    expect(isClientEditionCompatible("1.0.0")).toBe(true);
  });

  it("normalizes client edition headers", () => {
    expect(readClientEdition(" 1.0.0 ")).toBe("1.0.0");
    expect(readClientEdition(["1.0.0", "0.1.0"])).toBe("1.0.0");
    expect(readClientEdition(undefined)).toBeNull();
  });

  it("builds a clear upgrade-required payload", () => {
    expect(buildCompatibilityErrorPayload("0.1.0")).toMatchObject({
      code: "CLIENT_VERSION_UNSUPPORTED",
      clientVersion: "0.1.0",
      minimumCompatibleClientVersion: "1.0.0"
    });
  });
});
