import fp from "fastify-plugin";
import { Server } from "socket.io";
import { SOCKET_EVENTS } from "@syncall/shared";
import type { MemberSyncState } from "@syncall/shared";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../services/token-service";
import { clearRoomPresence, clearUserPresence, setRoomPresence } from "../services/presence-service";

async function socketPlugin(app: import("fastify").FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin: config.corsOrigin,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;

      if (!token) {
        throw new Error("Missing token");
      }

      const user = await verifyToken(token);
      socket.data.user = user;
      next();
    } catch (error) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on(SOCKET_EVENTS.roomJoin, async (payload: string | { roomId: string; syncState?: MemberSyncState }) => {
      const roomId = typeof payload === "string" ? payload : payload.roomId;
      const syncState = typeof payload === "string" ? "OFFLINE" : payload.syncState ?? "OFFLINE";
      const membership = await prisma.roomMembership.findUnique({
        where: {
          roomId_userId: {
            roomId,
            userId: socket.data.user.id
          }
        }
      });

      if (!membership) {
        socket.emit(SOCKET_EVENTS.syncError, { message: "Not a room member." });
        return;
      }

      socket.join(roomId);
      const update = setRoomPresence(roomId, socket.data.user.id, socket.data.user.username, syncState);
      io.to(roomId).emit(SOCKET_EVENTS.presenceUpdate, update);
    });

    socket.on(SOCKET_EVENTS.roomLeave, (roomId: string) => {
      socket.leave(roomId);
      const update = clearRoomPresence(roomId, socket.data.user.id, socket.data.user.username);
      io.to(roomId).emit(SOCKET_EVENTS.presenceUpdate, update);
    });

    socket.on(SOCKET_EVENTS.roomSyncState, ({ roomId, syncState }: { roomId: string; syncState: MemberSyncState }) => {
      const update = setRoomPresence(roomId, socket.data.user.id, socket.data.user.username, syncState);
      io.to(roomId).emit(SOCKET_EVENTS.presenceUpdate, update);
    });

    socket.on("disconnect", () => {
      const updates = clearUserPresence(socket.data.user.id, socket.data.user.username);
      for (const update of updates) {
        io.to(update.roomId).emit(SOCKET_EVENTS.presenceUpdate, update);
      }
    });
  });

  app.decorate("io", io);

  app.addHook("onClose", async () => {
    await io.close();
  });
}

export default fp(socketPlugin);
