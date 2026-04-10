export type CompressionAlgorithm = "gzip";

export interface AuthTokens {
  token: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
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
