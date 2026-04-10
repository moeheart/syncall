import type { FastifyPluginAsync } from "fastify";
import { loginSchema, registerSchema } from "@syncall/shared";
import { loginUser, registerUser } from "../services/auth-service";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply) => {
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

