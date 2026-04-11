import type { FastifyPluginAsync } from "fastify";
import { loginSchema, registerSchema } from "@syncall/shared";
import { loginUser, registerUser } from "../services/auth-service";
import {
  buildCompatibilityErrorPayload,
  getCompatibilitySummary,
  isClientEditionCompatible,
  readClientEdition
} from "../utils/client-compatibility";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/compatibility", async () => getCompatibilitySummary());

  app.post("/register", async (request, reply) => {
    const clientVersion = readClientEdition(request.headers["x-syncall-client-version"]);
    if (!isClientEditionCompatible(clientVersion)) {
      return reply.code(426).send(buildCompatibilityErrorPayload(clientVersion));
    }

    const body = registerSchema.parse(request.body);

    try {
      const result = await registerUser(body);
      return reply.send({
        token: result.token,
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          createdAt: result.user.createdAt.toISOString()
        }
      });
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.post("/login", async (request, reply) => {
    const clientVersion = readClientEdition(request.headers["x-syncall-client-version"]);
    if (!isClientEditionCompatible(clientVersion)) {
      return reply.code(426).send(buildCompatibilityErrorPayload(clientVersion));
    }

    const body = loginSchema.parse(request.body);

    try {
      const result = await loginUser(body);
      return reply.send({
        token: result.token,
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          createdAt: result.user.createdAt.toISOString()
        }
      });
    } catch (error) {
      return reply.code(401).send({ message: (error as Error).message });
    }
  });

  app.get("/me", { preHandler: [app.authenticate] }, async (request) => {
    return {
      user: request.user
    };
  });
};

export default authRoutes;
