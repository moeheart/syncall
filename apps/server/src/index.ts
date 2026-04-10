import fs from "node:fs/promises";
import { buildApp } from "./app";
import { prisma } from "./lib/prisma";
import { config } from "./config";

const app = await buildApp();

try {
  await prisma.$connect();
  await fs.mkdir(config.storageDir, { recursive: true });
  await app.listen({
    port: config.port,
    host: config.host
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
