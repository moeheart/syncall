export type CompressionAlgorithm = "gzip";
export type RoomSyncMode = "PAUSED" | "RUNNING";
export type MemberSyncState = "SYNCING" | "PAUSED" | "OFFLINE";
export type FileStatus = "OFFLINE" | "REMOTE" | "SYNCED" | "MODIFIED_LOCAL" | "MODIFIED_REMOTE" | "RUNNING";

export interface AuthTokens {
  token: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  username: string;
  email: string;
}

export interface RoomMemberSummary {
  id: string;
  username: string;
  email: string;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
  syncState?: MemberSyncState;
}

export interface RoomSummary {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  memberCount: number;
}

export interface InviteSummary {
  id: string;
  roomId: string;
  roomName: string;
  inviterUsername: string;
  inviteeUsername: string;
  status: "PENDING" | "ACCEPTED";
  createdAt: string;
}

export interface FileVersionSummary {
  id: string;
  fileEntryId: string;
  roomId: string;
  relativePath: string;
  versionNumber: number;
  checksum: string;
  originalSize: number;
  compressedSize: number;
  compressionAlgorithm: CompressionAlgorithm;
  uploaderUsername: string;
  createdAt: string;
  isConflict: boolean;
}

export interface ActiveFileSummary {
  fileEntryId: string;
  roomId: string;
  relativePath: string;
  currentVersionId: string;
  versionNumber: number;
  checksum: string;
  originalSize: number;
  compressedSize: number;
  updatedAt: string;
  ownerUsername: string;
  createdAt: string;
}

export interface RoomSyncStateSummary {
  roomId: string;
  folderPath: string | null;
  syncMode: RoomSyncMode;
  memberSyncState?: MemberSyncState;
  offlineCount: number;
  remoteCount: number;
  modifiedLocalCount: number;
  modifiedRemoteCount: number;
  runningCount: number;
}

export interface RoomFileStatusSummary {
  roomId: string;
  relativePath: string;
  displayName: string;
  status: FileStatus;
  localExists: boolean;
  remoteExists: boolean;
  localSize: number | null;
  remoteSize: number | null;
  localModifiedAt: string | null;
  remoteModifiedAt: string | null;
  ownerUsername: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  isSelectedForSync: boolean;
}

export interface NotificationSummary {
  invitesUnread: number;
  noticesUnread: number;
  activityUnread: number;
}

export interface PresenceUpdateEvent {
  roomId: string;
  userId: string;
  username: string;
  syncState: MemberSyncState;
}

export interface SyncEventSummary {
  id: string;
  roomId: string;
  relativePath: string;
  type: "FILE_UPLOADED" | "FILE_DELETED" | "FILE_RESTORED";
  actorUsername: string;
  createdAt: string;
}

export interface FileUpdateEvent {
  roomId: string;
  relativePath: string;
  versionId: string;
  versionNumber: number;
  checksum: string;
  originalSize: number;
  compressedSize: number;
  updatedBy: string;
  createdAt: string;
  isConflict: boolean;
}

export interface FileDeleteEvent {
  roomId: string;
  relativePath: string;
  deletedBy: string;
  createdAt: string;
}
