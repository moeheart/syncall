import type { MemberSyncState, PresenceUpdateEvent } from "@syncall/shared";

type PresenceRecord = {
  userId: string;
  username: string;
  syncState: MemberSyncState;
};

const roomPresence = new Map<string, Map<string, PresenceRecord>>();

export function setRoomPresence(roomId: string, userId: string, username: string, syncState: MemberSyncState): PresenceUpdateEvent {
  const roomMap = roomPresence.get(roomId) ?? new Map<string, PresenceRecord>();
  roomMap.set(userId, {
    userId,
    username,
    syncState
  });
  roomPresence.set(roomId, roomMap);

  return {
    roomId,
    userId,
    username,
    syncState
  };
}

export function clearRoomPresence(roomId: string, userId: string, username = ""): PresenceUpdateEvent {
  const roomMap = roomPresence.get(roomId);
  roomMap?.delete(userId);
  if (roomMap && roomMap.size === 0) {
    roomPresence.delete(roomId);
  }

  return {
    roomId,
    userId,
    username,
    syncState: "OFFLINE"
  };
}

export function clearUserPresence(userId: string, username = ""): PresenceUpdateEvent[] {
  const updates: PresenceUpdateEvent[] = [];

  for (const [roomId, roomMap] of roomPresence.entries()) {
    if (!roomMap.has(userId)) {
      continue;
    }

    roomMap.delete(userId);
    if (roomMap.size === 0) {
      roomPresence.delete(roomId);
    }

    updates.push({
      roomId,
      userId,
      username,
      syncState: "OFFLINE"
    });
  }

  return updates;
}

export function getUserSyncState(roomId: string, userId: string): MemberSyncState {
  return roomPresence.get(roomId)?.get(userId)?.syncState ?? "OFFLINE";
}
