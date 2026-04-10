import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "./constants";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export const registerSchema = credentialsSchema.extend({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/)
});

export const loginSchema = credentialsSchema;

export const createRoomSchema = z.object({
  name: z.string().min(1).max(120)
});

export const inviteUserSchema = z.object({
  username: z.string().min(3).max(32)
});

export const historyQuerySchema = z.object({
  path: z.string().min(1)
});

export const roomIdSchema = z.object({
  roomId: z.string().cuid()
});

export const inviteIdSchema = z.object({
  inviteId: z.string().cuid()
});

export const uploadMetadataSchema = z.object({
  roomId: z.string().cuid(),
  relativePath: z.string().min(1),
  checksum: z.string().length(64),
  originalSize: z.coerce.number().int().min(0).max(MAX_UPLOAD_BYTES),
  compressedSize: z.coerce.number().int().min(0).max(MAX_UPLOAD_BYTES),
  baseVersionId: z.string().cuid().optional().nullable()
});

export const deleteFileSchema = z.object({
  relativePath: z.string().min(1)
});

export const restoreFileSchema = z.object({
  versionId: z.string().cuid()
});
