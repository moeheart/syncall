import type { FastifyPluginAsync } from "fastify";
import type { Multipart } from "@fastify/multipart";
import { historyQuerySchema, restoreFileSchema, uploadMetadataSchema, deleteFileSchema, SOCKET_EVENTS } from "@syncall/shared";
import { prisma } from "../lib/prisma";
import { createVersionFromCompressedUpload, deleteFileForRoom, listHistoryForRoom, readVersionContent, restoreVersion } from "../services/file-service";
import { ensureRoomMembership } from "../services/room-service";
import { toActiveFileSummary, toFileDeleteEvent, toVersionSummary } from "../utils/serialization";

const fileRoutes: FastifyPluginAsync = async (app) => {
  const fieldValue = (field?: Multipart | Multipart[]) => {
    if (!field || Array.isArray(field) || !("value" in field)) {
      return undefined;
    }
    return String(field.value);
  };

  app.get("/rooms/:roomId/files", { preHandler: [app.authenticate] }, async (request) => {
    const { roomId } = request.params as { roomId: string };
    await ensureRoomMembership(roomId, request.user.id);
    const files = await prisma.fileEntry.findMany({
      where: {
        roomId,
        deletedAt: null,
        currentVersionId: {
          not: null
        }
      },
      include: {
        currentVersion: true
      },
      orderBy: {
        relativePath: "asc"
      }
    });

    return {
      files: files.map(toActiveFileSummary)
    };
  });

  app.get("/rooms/:roomId/files/history", { preHandler: [app.authenticate] }, async (request) => {
    const { roomId } = request.params as { roomId: string };
    const query = historyQuerySchema.parse(request.query);
    await ensureRoomMembership(roomId, request.user.id);
    const versions = await listHistoryForRoom(roomId, query.path);
    return {
      versions: versions.map(toVersionSummary)
    };
  });

  app.post("/rooms/:roomId/files/upload", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ message: "Missing file upload." });
    }

    const fields = {
      roomId: fieldValue(file.fields.roomId),
      relativePath: fieldValue(file.fields.relativePath),
      checksum: fieldValue(file.fields.checksum),
      originalSize: fieldValue(file.fields.originalSize),
      compressedSize: fieldValue(file.fields.compressedSize),
      baseVersionId: fieldValue(file.fields.baseVersionId)
    };

    const metadata = uploadMetadataSchema.parse(fields);
    if (metadata.roomId !== roomId) {
      return reply.code(400).send({ message: "Room id mismatch." });
    }
    await ensureRoomMembership(metadata.roomId, request.user.id);

    const compressedBytes = await file.toBuffer();
    const result = await createVersionFromCompressedUpload({
      roomId: metadata.roomId,
      relativePath: metadata.relativePath,
      uploaderId: request.user.id,
      uploaderUsername: request.user.username,
      compressedBytes,
      clientChecksum: metadata.checksum,
      originalSize: metadata.originalSize,
      compressedSize: metadata.compressedSize,
      baseVersionId: metadata.baseVersionId
    });

    const version = await prisma.fileVersion.findUniqueOrThrow({
      where: { id: result.version.id },
      include: {
        uploader: {
          select: { username: true }
        },
        fileEntry: {
          select: { relativePath: true, roomId: true }
        }
      }
    });

    const summary = toVersionSummary(version);
    app.io.to(metadata.roomId).emit(SOCKET_EVENTS.fileUpdated, {
      roomId: version.fileEntry.roomId,
      relativePath: version.fileEntry.relativePath,
      versionId: version.id,
      versionNumber: version.versionNumber,
      checksum: version.checksum,
      originalSize: version.originalSize,
      compressedSize: version.compressedSize,
      updatedBy: version.uploader.username,
      createdAt: version.createdAt.toISOString(),
      isConflict: version.isConflict
    });

    return reply.code(201).send({ version: summary });
  });

  app.post("/rooms/:roomId/files/delete", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const body = deleteFileSchema.parse(request.body);
    await ensureRoomMembership(roomId, request.user.id);
    const relativePath = await deleteFileForRoom({
      roomId,
      relativePath: body.relativePath,
      actorId: request.user.id
    });
    app.io.to(roomId).emit(SOCKET_EVENTS.fileDeleted, toFileDeleteEvent(roomId, relativePath, request.user.username, new Date()));
    return reply.send({ success: true });
  });

  app.post("/rooms/:roomId/files/restore", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const body = restoreFileSchema.parse(request.body);
    await ensureRoomMembership(roomId, request.user.id);
    const restored = await restoreVersion({
      roomId,
      versionId: body.versionId,
      actorId: request.user.id
    });

    app.io.to(roomId).emit(SOCKET_EVENTS.restoreCompleted, {
      roomId,
      relativePath: restored.fileEntry.relativePath,
      versionId: restored.id,
      versionNumber: restored.versionNumber,
      checksum: restored.checksum,
      originalSize: restored.originalSize,
      compressedSize: restored.compressedSize,
      updatedBy: restored.uploader.username,
      createdAt: restored.createdAt.toISOString(),
      isConflict: restored.isConflict
    });

    return reply.send({
      version: toVersionSummary(restored)
    });
  });

  app.get("/rooms/:roomId/files/download/:versionId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { roomId, versionId } = request.params as { roomId: string; versionId: string };
    await ensureRoomMembership(roomId, request.user.id);
    const { version, content } = await readVersionContent(versionId);

    if (version.fileEntry.roomId !== roomId) {
      return reply.code(404).send({ message: "Version not found." });
    }

    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${version.fileEntry.relativePath.split("/").pop() ?? "file"}"`)
      .send(content);
  });
};

export default fileRoutes;
