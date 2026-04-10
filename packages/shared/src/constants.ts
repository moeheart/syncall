export const SOCKET_EVENTS = {
  roomJoin: "room:join",
  roomLeave: "room:leave",
  presenceUpdate: "presence:update",
  inviteReceived: "invite:received",
  fileUpdated: "sync:file-updated",
  fileDeleted: "sync:file-deleted",
  restoreCompleted: "sync:restore-completed",
  syncError: "sync:error"
} as const;

export const COMPRESSION_ALGORITHM = "gzip";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const IGNORED_FILE_PATTERNS = [
  /^\.syncall(\/|\\|$)/,
  /\.tmp$/i,
  /\.swp$/i,
  /~$/
] as const;

