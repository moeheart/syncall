import fp from "fastify-plugin";
import { Server } from "socket.io";
import { SOCKET_EVENTS } from "@syncall/shared";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../services/token-service";

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
    socket.on(SOCKET_EVENTS.roomJoin, async (roomId: string) => {
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
      io.to(roomId).emit(SOCKET_EVENTS.presenceUpdate, {
        roomId,
        username: socket.data.user.username,
        online: true
      });
    });

    socket.on(SOCKET_EVENTS.roomLeave, (roomId: string) => {
      socket.leave(roomId);
      io.to(roomId).emit(SOCKET_EVENTS.presenceUpdate, {
        roomId,
        username: socket.data.user.username,
        online: false
      });
    });
  });

  app.decorate("io", io);

  app.addHook("onClose", async () => {
    await io.close();
  });
}

export default fp(socketPlugin);

