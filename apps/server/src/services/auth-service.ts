import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signToken } from "./token-service";

export async function registerUser(input: { username: string; email: string; password: string }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash
    }
  });

  const token = await signToken({
    id: user.id,
    username: user.username,
    email: user.email
  });

  return {
    token,
    user
  };
}

export async function loginUser(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (!user) {
    throw new Error("Invalid email or password.");
  }

  const isValid = await bcrypt.compare(input.password, user.passwordHash);

  if (!isValid) {
    throw new Error("Invalid email or password.");
  }

  const token = await signToken({
    id: user.id,
    username: user.username,
    email: user.email
  });

  return {
    token,
    user
  };
}

