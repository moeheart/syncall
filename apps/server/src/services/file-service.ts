import fs from "node:fs/promises";
import path from "node:path";
import { SyncEventType } from "@prisma/client";
import { COMPRESSION_ALGORITHM } from "@syncall/shared";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { compressBuffer, decompressBuffer } from "../utils/compression";
import { sha256 } from "../utils/checksum";
import { normalizeRelativePath } from "../utils/paths";

async function ensureStorageDir(roomId: string) {
  const dir = path.join(config.storageDir, roomId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeCompressedBlob(roomId: string, versionId: string, compressedBytes: Buffer) {
  const roomDir = await ensureStorageDir(roomId);
  const storagePath = path.join(roomDir, `${versionId}.gz`);
  await fs.writeFile(storagePath, compressedBytes);
  return storagePath;
}

export async function createVersionFromCompressedUpload(input: {
  roomId: string;
  relativePath: string;
  uploaderId: string;
  uploaderUsername: string;
  compressedBytes: Buffer;
  clientChecksum: string;
  originalSize: number;
  compressedSize: number;
  clientModifiedAt: string;
  baseVersionId?: string | null;
}) {
  const normalizedPath = normalizeRelativePath(input.relativePath);
  const decompressed = await decompressBuffer(input.compressedBytes);
  const checksum = sha256(decompressed);
  const clientModifiedAt = new Date(input.clientModifiedAt);

  if (Number.isNaN(clientModifiedAt.getTime())) {
    throw new Error("Invalid client modification time.");
  }

  if (checksum !== input.clientChecksum) {
    throw new Error("Checksum mismatch.");
  }

  if (decompressed.byteLength !== input.originalSize) {
    throw new Error("Original size mismatch.");
  }

  if (input.compressedBytes.byteLength !== input.compressedSize) {
    throw new Error("Compressed size mismatch.");
  }

  return prisma.$transaction(async (tx) => {
    const existingEntry = await tx.fileEntry.findUnique({
      where: {
        roomId_relativePath: {
          roomId: input.roomId,
          relativePath: normalizedPath
        }
      },
      include: {
        currentVersion: true
      }
    });

    const isConflict =
      !!existingEntry &&
      !!existingEntry.currentVersionId &&
      input.baseVersionId !== existingEntry.currentVersionId;

    const fileEntry = await tx.fileEntry.upsert({
      where: {
        roomId_relativePath: {
          roomId: input.roomId,
          relativePath: normalizedPath
        }
      },
      update: {
        deletedAt: null
      },
      create: {
        roomId: input.roomId,
        relativePath: normalizedPath
      }
    });

    const latestVersion = await tx.fileVersion.findFirst({
      where: {
        fileEntryId: fileEntry.id
      },
      orderBy: {
        versionNumber: "desc"
      }
    });

    const version = await tx.fileVersion.create({
      data: {
        fileEntryId: fileEntry.id,
        parentVersionId: latestVersion?.id ?? null,
        storagePath: "",
        checksum,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        originalSize: input.originalSize,
        compressedSize: input.compressedSize,
        compressionAlgorithm: COMPRESSION_ALGORITHM,
        isConflict,
        uploaderId: input.uploaderId,
        clientModifiedAt
      }
    });

    const storagePath = await writeCompressedBlob(input.roomId, version.id, input.compressedBytes);

    const savedVersion = await tx.fileVersion.update({
      where: { id: version.id },
      data: { storagePath },
      include: {
        uploader: {
          select: { username: true }
        },
        fileEntry: {
          select: {
            roomId: true,
            relativePath: true
          }
        }
      }
    });

    const shouldPromoteToHead =
      !existingEntry?.currentVersion ||
      clientModifiedAt.getTime() > existingEntry.currentVersion.clientModifiedAt.getTime() ||
      clientModifiedAt.getTime() === existingEntry.currentVersion.clientModifiedAt.getTime();

    if (shouldPromoteToHead) {
      await tx.fileEntry.update({
        where: { id: fileEntry.id },
        data: {
          currentVersionId: savedVersion.id,
          deletedAt: null
        }
      });
    } else if (fileEntry.deletedAt) {
      await tx.fileEntry.update({
        where: { id: fileEntry.id },
        data: {
          deletedAt: null
        }
      });
    }

    await tx.syncEvent.create({
      data: {
        roomId: input.roomId,
        actorId: input.uploaderId,
        type: SyncEventType.FILE_UPLOADED,
        relativePath: normalizedPath
      }
    });

    return {
      version: savedVersion,
      relativePath: normalizedPath,
      roomId: input.roomId
    };
  });
}

export async function deleteFileForRoom(input: { roomId: string; relativePath: string; actorId: string }) {
  const normalizedPath = normalizeRelativePath(input.relativePath);

  return prisma.$transaction(async (tx) => {
    const entry = await tx.fileEntry.findUnique({
      where: {
        roomId_relativePath: {
          roomId: input.roomId,
          relativePath: normalizedPath
        }
      }
    });

    if (!entry) {
      throw new Error("File not found.");
    }

    await tx.fileEntry.update({
      where: { id: entry.id },
      data: {
        deletedAt: new Date(),
        currentVersionId: null
      }
    });

    await tx.syncEvent.create({
      data: {
        roomId: input.roomId,
        actorId: input.actorId,
        type: SyncEventType.FILE_DELETED,
        relativePath: normalizedPath
      }
    });

    return normalizedPath;
  });
}

export async function listHistoryForRoom(roomId: string, relativePath: string) {
  const normalizedPath = normalizeRelativePath(relativePath);

  return prisma.fileVersion.findMany({
    where: {
      fileEntry: {
        roomId,
        relativePath: normalizedPath
      }
    },
    include: {
      uploader: {
        select: { username: true }
      },
      fileEntry: {
        select: {
          roomId: true,
          relativePath: true,
          currentVersionId: true
        }
      }
    },
    orderBy: {
      versionNumber: "desc"
    }
  });
}

export async function readVersionContent(versionId: string) {
  const version = await prisma.fileVersion.findUnique({
    where: { id: versionId },
    include: {
      fileEntry: true,
      uploader: {
        select: { username: true }
      }
    }
  });

  if (!version) {
    throw new Error("Version not found.");
  }

  const compressed = await fs.readFile(version.storagePath);
  const content = await decompressBuffer(compressed);

  return {
    version,
    content
  };
}

export async function restoreVersion(input: { roomId: string; versionId: string; actorId: string }) {
  const selected = await prisma.fileVersion.findUnique({
    where: { id: input.versionId },
    include: {
      fileEntry: true
    }
  });

  if (!selected || selected.fileEntry.roomId !== input.roomId) {
    throw new Error("Version not found.");
  }

  const compressedBytes = await fs.readFile(selected.storagePath);
  const decompressed = await decompressBuffer(compressedBytes);
  const checksum = sha256(decompressed);

  return prisma.$transaction(async (tx) => {
    const latestVersion = await tx.fileVersion.findFirst({
      where: {
        fileEntryId: selected.fileEntryId
      },
      orderBy: {
        versionNumber: "desc"
      }
    });

    const created = await tx.fileVersion.create({
      data: {
        fileEntryId: selected.fileEntryId,
        parentVersionId: selected.id,
        storagePath: "",
        checksum,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        originalSize: selected.originalSize,
        compressedSize: selected.compressedSize,
        compressionAlgorithm: COMPRESSION_ALGORITHM,
        isConflict: false,
        uploaderId: input.actorId,
        clientModifiedAt: new Date()
      }
    });

    const storagePath = await writeCompressedBlob(input.roomId, created.id, compressedBytes);

    const restored = await tx.fileVersion.update({
      where: { id: created.id },
      data: { storagePath },
      include: {
        uploader: {
          select: { username: true }
        },
        fileEntry: {
          select: {
            roomId: true,
            relativePath: true,
            currentVersionId: true
          }
        }
      }
    });

    await tx.fileEntry.update({
      where: { id: selected.fileEntryId },
      data: {
        currentVersionId: restored.id,
        deletedAt: null
      }
    });

    await tx.syncEvent.create({
      data: {
        roomId: input.roomId,
        actorId: input.actorId,
        type: SyncEventType.FILE_RESTORED,
        relativePath: selected.fileEntry.relativePath
      }
    });

    return restored;
  });
}

export async function recompressBuffer(input: Buffer) {
  return compressBuffer(input);
}
