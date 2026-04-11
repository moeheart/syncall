import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { config } from "../src/config";

async function recreateStorageRoot() {
  await fs.rm(config.storageDir, { recursive: true, force: true });
  await fs.mkdir(config.storageDir, { recursive: true });
}

async function resetSyncData() {
  const result = await prisma.$transaction(async (tx) => {
    await tx.fileEntry.updateMany({
      data: {
        currentVersionId: null,
        deletedAt: null
      }
    });

    const deletedSyncEvents = await tx.syncEvent.deleteMany();
    const deletedFileVersions = await tx.fileVersion.deleteMany();
    const deletedFileEntries = await tx.fileEntry.deleteMany();
    const deletedBindings = await tx.clientFolderBinding.deleteMany();

    return {
      deletedSyncEvents: deletedSyncEvents.count,
      deletedFileVersions: deletedFileVersions.count,
      deletedFileEntries: deletedFileEntries.count,
      deletedBindings: deletedBindings.count
    };
  });

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
