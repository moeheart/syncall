import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { ZodError } from "zod";
import authPlugin from "./plugins/auth";
import socketPlugin from "./plugins/socket";
import authRoutes from "./routes/auth-routes";
import roomRoutes from "./routes/room-routes";
import fileRoutes from "./routes/file-routes";
import { config } from "./config";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: config.maxUploadBodyBytes
  });

  await app.register(fastifyCors, {
    origin: true,
    credentials: true
  });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxUploadBodyBytes
    }
  });
  await app.register(authPlugin);
  await app.register(socketPlugin);

  app.get("/health", async () => ({
    status: "ok",
    compression: "gzip",
    origin: config.corsOrigin,
    serverVersion: config.serverVersion,
    minimumCompatibleClientVersion: config.minimumCompatibleClientVersion
  }));

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(roomRoutes);
  await app.register(fileRoutes);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: "Validation failed.",
        issues: error.issues
      });
    }

    request.log.error(error);
    return reply.code(500).send({ message: error instanceof Error ? error.message : "Unexpected error" });
  });

  return app;
}
