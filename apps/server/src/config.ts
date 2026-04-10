import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(process.cwd());

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "syncall-dev-secret",
  storageDir: process.env.STORAGE_DIR ?? path.join(rootDir, "storage"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5174",
  databaseUrl: process.env.DATABASE_URL ?? "",
  maxOriginalFileBytes: Number(process.env.MAX_ORIGINAL_FILE_BYTES ?? 200 * 1024 * 1024),
  maxUploadBodyBytes: Number(process.env.MAX_UPLOAD_BODY_BYTES ?? 240 * 1024 * 1024)
};
