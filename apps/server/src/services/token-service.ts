import fastify from "fastify";
import { config } from "../config";

const verifier = fastify();
await verifier.register(import("@fastify/jwt"), { secret: config.jwtSecret });

export async function signToken(payload: { id: string; username: string; email: string }): Promise<string> {
  return verifier.jwt.sign(payload);
}

export async function verifyToken(token: string): Promise<{ id: string; username: string; email: string }> {
  return verifier.jwt.verify(token) as { id: string; username: string; email: string };
}

