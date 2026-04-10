import { InviteStatus, MembershipRole } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function createRoom(ownerId: string, name: string) {
  return prisma.room.create({
    data: {
      name,
      ownerId,
      memberships: {
        create: {
          userId: ownerId,
          role: MembershipRole.OWNER
        }
      }
    },
    include: {
      memberships: true
    }
  });
}

export async function listRoomsForUser(userId: string) {
  return prisma.room.findMany({
    where: {
      memberships: {
        some: { userId }
      }
    },
    include: {
      memberships: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function listInvitesForUser(userId: string) {
  return prisma.roomInvite.findMany({
    where: {
      inviteeId: userId,
      status: InviteStatus.PENDING
    },
    include: {
      room: true,
      inviter: {
        select: { username: true }
      },
      invitee: {
        select: { username: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function ensureRoomMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId
      }
    }
  });

  if (!membership) {
    throw new Error("Not a member of this room.");
  }

  return membership;
}

