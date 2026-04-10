import type { User } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    io: import("socket.io").Server;
  }

  interface FastifyRequest {
    user: Pick<User, "id" | "username" | "email">;
  }
}

