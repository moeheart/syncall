import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(process.cwd());
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const config = {
  serverVersion: String(packageJson.version ?? "1.0.0"),
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "syncall-dev-secret",
  storageDir: process.env.STORAGE_DIR ?? path.join(rootDir, "storage"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5174",
  databaseUrl: process.env.DATABASE_URL ?? "",
  maxOriginalFileBytes: Number(process.env.MAX_ORIGINAL_FILE_BYTES ?? 200 * 1024 * 1024),
  maxUploadBodyBytes: Number(process.env.MAX_UPLOAD_BODY_BYTES ?? 240 * 1024 * 1024),
  minimumCompatibleClientVersion: process.env.MINIMUM_COMPATIBLE_CLIENT_VERSION ?? "1.0.0"
};
