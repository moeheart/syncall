import type { ActiveFileSummary, FileDeleteEvent, FileVersionSummary, InviteSummary, RoomSummary, SyncEventSummary } from "@syncall/shared";
import type { FileEntry, FileVersion, RoomInvite, RoomMembership, Room, SyncEvent, User } from "@prisma/client";

type RoomWithMemberships = Room & {
  memberships: RoomMembership[];
};

type InviteWithUsers = RoomInvite & {
  room: Room;
  inviter: Pick<User, "username">;
  invitee: Pick<User, "username">;
};

type VersionWithUploader = FileVersion & {
  uploader: Pick<User, "username">;
  fileEntry: {
    roomId: string;
    relativePath: string;
  };
};

type ActiveFileWithVersion = FileEntry & {
  currentVersion: FileVersion | null;
};

type SyncEventWithActor = SyncEvent & {
  actor: Pick<User, "username">;
};

export function toRoomSummary(room: RoomWithMemberships): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    createdAt: room.createdAt.toISOString(),
    memberCount: room.memberships.length
  };
}

export function toInviteSummary(invite: InviteWithUsers): InviteSummary {
  return {
    id: invite.id,
    roomId: invite.roomId,
    roomName: invite.room.name,
    inviterUsername: invite.inviter.username,
    inviteeUsername: invite.invitee.username,
    status: invite.status,
    createdAt: invite.createdAt.toISOString()
  };
}

export function toVersionSummary(version: VersionWithUploader): FileVersionSummary {
  return {
    id: version.id,
    fileEntryId: version.fileEntryId,
    roomId: version.fileEntry.roomId,
    relativePath: version.fileEntry.relativePath,
    versionNumber: version.versionNumber,
    checksum: version.checksum,
    originalSize: version.originalSize,
    compressedSize: version.compressedSize,
    compressionAlgorithm: version.compressionAlgorithm as "gzip",
    uploaderUsername: version.uploader.username,
    createdAt: version.createdAt.toISOString(),
    isConflict: version.isConflict
  };
}

export function toActiveFileSummary(file: ActiveFileWithVersion): ActiveFileSummary {
  if (!file.currentVersion) {
    throw new Error("File is missing current version.");
  }

  return {
    fileEntryId: file.id,
    roomId: file.roomId,
    relativePath: file.relativePath,
    currentVersionId: file.currentVersion.id,
    versionNumber: file.currentVersion.versionNumber,
    checksum: file.currentVersion.checksum,
    originalSize: file.currentVersion.originalSize,
    compressedSize: file.currentVersion.compressedSize,
    updatedAt: file.updatedAt.toISOString()
  };
}

export function toFileDeleteEvent(roomId: string, relativePath: string, username: string, createdAt: Date): FileDeleteEvent {
  return {
    roomId,
    relativePath,
    deletedBy: username,
    createdAt: createdAt.toISOString()
  };
}

export function toSyncEventSummary(event: SyncEventWithActor): SyncEventSummary {
  return {
    id: event.id,
    roomId: event.roomId,
    relativePath: event.relativePath,
    type: event.type,
    actorUsername: event.actor.username,
    createdAt: event.createdAt.toISOString()
  };
}
