import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/config";

async function recreateStorageRoot() {
  await fs.rm(config.storageDir, { recursive: true, force: true });
  await fs.mkdir(config.storageDir, { recursive: true });
}

async function resetSyncData() {
  const [deletedSyncEvents, deletedFileVersions, deletedFileEntries, deletedBindings] = await Promise.all([
    prisma.syncEvent.count(),
    prisma.fileVersion.count(),
    prisma.fileEntry.count(),
    prisma.clientFolderBinding.count()
  ]);

  // Use a single PostgreSQL TRUNCATE instead of long-running row-by-row deletes.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SyncEvent",
      "ClientFolderBinding",
      "FileVersion",
      "FileEntry"
    RESTART IDENTITY
    CASCADE
  `);

  const [remainingSyncEvents, remainingFileVersions, remainingFileEntries, remainingBindings] = await Promise.all([
    prisma.syncEvent.count(),
    prisma.fileVersion.count(),
    prisma.fileEntry.count(),
    prisma.clientFolderBinding.count()
  ]);

  const result = {
    deletedSyncEvents,
    deletedFileVersions,
    deletedFileEntries,
    deletedBindings,
    remainingSyncEvents,
    remainingFileVersions,
    remainingFileEntries,
    remainingBindings
  };

  await recreateStorageRoot();

  return {
    ...result,
    storageDir: path.resolve(config.storageDir)
  };
}

async function main() {
  await prisma.$connect();

  try {
    const result = await resetSyncData();
    console.log("Sync data reset completed.");
    console.log(JSON.stringify(result, null, 2));
    console.log("Preserved tables: User, Room, RoomMembership, RoomInvite.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to reset sync data.");
  console.error(error);
  process.exit(1);
});
