import type { FastifyPluginAsync } from "fastify";
import { createRoomSchema, inviteIdSchema, inviteUserSchema } from "@syncall/shared";
import { InviteStatus, MembershipRole } from "@prisma/client";
import { SOCKET_EVENTS } from "@syncall/shared";
import { prisma } from "../lib/prisma";
import { createRoom, ensureRoomMembership, listInvitesForUser, listRoomsForUser } from "../services/room-service";
import { toInviteSummary, toRoomSummary, toSyncEventSummary } from "../utils/serialization";

const roomRoutes: FastifyPluginAsync = async (app) => {
  app.get("/rooms", { preHandler: [app.authenticate] }, async (request) => {
    const rooms = await listRoomsForUser(request.user.id);
    return { rooms: rooms.map(toRoomSummary) };
  });

  app.post("/rooms", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createRoomSchema.parse(request.body);
    const room = await createRoom(request.user.id, body.name);
    return reply.code(201).send({ room: toRoomSummary(room) });
  });

  app.post("/rooms/:roomId/invites", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const body = inviteUserSchema.parse(request.body);

    const membership = await ensureRoomMembership(roomId, request.user.id);

    if (membership.role !== MembershipRole.OWNER) {
      return reply.code(403).send({ message: "Only room owners can invite users." });
    }

    const invitee = await prisma.user.findUnique({
      where: { username: body.username }
    });

    if (!invitee) {
      return reply.code(404).send({ message: "User not found." });
    }

    const invite = await prisma.roomInvite.create({
      data: {
        roomId,
        inviterId: request.user.id,
        inviteeId: invitee.id
      },
      include: {
        room: true,
        inviter: {
          select: { username: true }
        },
        invitee: {
          select: { username: true }
        }
      }
    });

    const payload = toInviteSummary(invite);
    app.io.emit(SOCKET_EVENTS.inviteReceived, payload);

    return reply.code(201).send({ invite: payload });
  });

  app.get("/invites", { preHandler: [app.authenticate] }, async (request) => {
    const invites = await listInvitesForUser(request.user.id);
    return { invites: invites.map(toInviteSummary) };
  });

  app.get("/activity", { preHandler: [app.authenticate] }, async (request) => {
    const events = await prisma.syncEvent.findMany({
      where: {
        room: {
          memberships: {
            some: { userId: request.user.id }
          }
        }
      },
      include: {
        actor: {
          select: { username: true }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 25
    });

    return {
      events: events.map(toSyncEventSummary)
    };
  });

  app.post("/invites/:inviteId/accept", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { inviteId } = inviteIdSchema.parse(request.params);
    const invite = await prisma.roomInvite.findUnique({
      where: { id: inviteId }
    });

    if (!invite || invite.inviteeId !== request.user.id || invite.status !== InviteStatus.PENDING) {
      return reply.code(404).send({ message: "Invite not found." });
    }

    await prisma.$transaction([
      prisma.roomInvite.update({
        where: { id: inviteId },
        data: {
          status: InviteStatus.ACCEPTED,
          acceptedAt: new Date()
        }
      }),
      prisma.roomMembership.upsert({
        where: {
          roomId_userId: {
            roomId: invite.roomId,
            userId: request.user.id
          }
        },
        update: {},
        create: {
          roomId: invite.roomId,
          userId: request.user.id,
          role: MembershipRole.MEMBER
        }
      })
    ]);

    return reply.send({ success: true });
  });
};

export default roomRoutes;
