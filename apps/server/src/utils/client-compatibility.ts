import type { CompatibilityErrorPayload, CompatibilitySummary } from "@syncall/shared";
import { config } from "../config";

export function compareEditions(left: string | null | undefined, right: string | null | undefined) {
  const leftParts = String(left ?? "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right ?? "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export function getCompatibilitySummary(): CompatibilitySummary {
  return {
    serverVersion: config.serverVersion,
    minimumCompatibleClientVersion: config.minimumCompatibleClientVersion
  };
}

export function readClientEdition(headerValue: string | string[] | undefined) {
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  const trimmed = String(headerValue ?? "").trim();
  return trimmed || null;
}

export function isClientEditionCompatible(clientVersion: string | null | undefined) {
  if (!clientVersion) {
    return false;
  }

  return compareEditions(clientVersion, config.minimumCompatibleClientVersion) >= 0;
}

export function buildCompatibilityErrorPayload(clientVersion: string | null | undefined): CompatibilityErrorPayload {
  const summary = getCompatibilitySummary();
  const normalizedClientVersion = readClientEdition(clientVersion ?? undefined);

  return {
    code: "CLIENT_VERSION_UNSUPPORTED",
    clientVersion: normalizedClientVersion,
    message: normalizedClientVersion
      ? `Client edition ${normalizedClientVersion} is no longer supported. Please upgrade to edition ${summary.minimumCompatibleClientVersion} or newer.`
      : `This client package does not report a supported edition. Please upgrade to edition ${summary.minimumCompatibleClientVersion} or newer.`,
    ...summary
  };
}
