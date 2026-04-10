import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";

interface TokenUser {
  id: string;
  username: string;
  email: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: TokenUser;
  }
}

async function authPlugin(app: import("fastify").FastifyInstance) {
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify<TokenUser>();
    } catch (error) {
      reply.code(401).send({ message: "Unauthorized" });
    }
  });
}

export default fp(authPlugin);

