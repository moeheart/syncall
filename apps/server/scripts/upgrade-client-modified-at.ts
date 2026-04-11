import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$connect();

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "FileVersion"
      ADD COLUMN IF NOT EXISTS "clientModifiedAt" TIMESTAMP(3)
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "FileVersion"
      SET "clientModifiedAt" = "createdAt"
      WHERE "clientModifiedAt" IS NULL
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "FileVersion"
      ALTER COLUMN "clientModifiedAt" SET NOT NULL
    `);

    console.log('Upgraded "FileVersion.clientModifiedAt" successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to upgrade "FileVersion.clientModifiedAt".');
  console.error(error);
  process.exit(1);
});
