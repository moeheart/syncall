# Syncall: trusted room-based log-folder synchronization with simple rollback for small teams

Syncall addresses a real-time collaboration problem: when logs or output files are generated automatically by programs, especially third-party programs, collecting and distributing them manually is slow and inconvenient.

Multiple clients can connect to the same room and mark a folder as "shared." Any creation, modification, or removal of a file will be synchronized across all connected clients.

This is a term project of WashU CSE5306.

## Comparisons and Advantages

There are several existing approaches to similar problems.

- (vs. cloud file systems) They are not always easy to integrate into automated workflows, and authorization may become complicated in multi-user scenarios.
- (vs. Git) Git focuses on version control rather than low-friction real-time synchronization, so it is useful to reference but is not the primary model for this project.
- (vs. SFTP) SFTP is useful for file transfer, but it usually requires more manual configuration and is less convenient for lightweight room-based collaboration.

In general, the purpose of Syncall is close to SFTP, but extended for easier collaboration. Its main features are:

- It assumes that users in the same room are trusted participants, which keeps file sharing simple.
- It provides lightweight version control to help users recover from mistakes.
- It focuses on transfer speed and storage efficiency to better support real-time usage.

The existing projects with similar goals are: [Syncthing](https://docs.syncthing.net/), [Resilio Sync](https://help.resilio.com/hc/en-us/articles/204754319-How-soon-does-synchronization-start), [SparkleShare](https://www.sparkleshare.org/).

## Plan

- Client: Electron + Vue.js for the desktop sync client
- Website: Vue.js for the landing page and signed-in status page
- Server: Node.js + Fastify + Socket.IO for authentication, room management, event broadcasting, and sync coordination
- Database: PostgreSQL for users, rooms, file metadata, and version records
- File storage: shared version blobs stored on the server filesystem in gzip-compressed form

## Rubric

**TA checkpoint**
- (5 pt) Check on 04/08/2026

**Languages/Frameworks used**
- (10 pt) Electron
- (5 pt) Vue.js
- (10 pt) Node.js + Fastify + Socket.IO
- (5 pt) PostgreSQL

**Functionality**
- (10 pt) Users can register, log in, and create or join a room
- (10 pt) File creation, modification, and deletion are synchronized correctly across connected clients
- (10 pt) Version control allows users to review and roll back file history
- (10 pt) The system handles invalid requests and basic security risks safely and robustly
- (10 pt) The project website and admin dashboard are clear, usable, and visually polished

**Best Practices**
- (3 pt) Code is readable and well formatted
- (2 pt) All website pages pass the HTML validator

**Creative Portion**
- (10 pt) TBD

Approved by Edgar

## Development Setup

### Workspace layout

- `apps/server`: Fastify + Socket.IO + Prisma backend
- `apps/desktop`: Electron + Vue desktop client
- `apps/web`: Vue landing page and signed-in status page
- `packages/shared`: shared schemas and TypeScript contracts

## Server Side

### Responsibilities

- Accept user registration and login
- Manage rooms, members, and username-based invites
- Receive gzip-compressed file uploads from clients
- Store file version metadata in PostgreSQL
- Store compressed file blobs on the server filesystem
- Broadcast sync events to connected clients through Socket.IO
- Provide file history and restore APIs

### Main server files

- `apps/server/src/app.ts`: Fastify app bootstrap and route registration
- `apps/server/src/routes`: REST API routes
- `apps/server/src/services`: auth, room, and file/version logic
- `apps/server/prisma/schema.prisma`: database schema

### Server prerequisites

- Node.js 24+
- PostgreSQL 16+ or Docker Desktop for local development

### Server setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start PostgreSQL with Docker if needed:
   ```bash
   docker compose up -d
   ```
3. Copy the server environment template and adjust it:
   ```bash
   copy apps\server\.env.example apps\server\.env
   ```
4. Generate Prisma client and run the initial migration:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```
5. Start the backend:
   ```bash
   npm run dev:server
   ```

### Ubuntu server notes

- The production server target can stay `Node.js + Fastify + PostgreSQL` on Ubuntu without any architecture change.
- On Ubuntu, use `cp` instead of `copy` when preparing the environment file:
  ```bash
  cp apps/server/.env.example apps/server/.env
  ```
- Set `HOST=0.0.0.0` in `apps/server/.env` so the Fastify server listens on the network interface.
- Make sure the server has a writable storage directory for compressed blobs, for example:
  ```bash
  mkdir -p /var/lib/syncall/storage
  ```
  Then set `STORAGE_DIR=/var/lib/syncall/storage`.
- Install PostgreSQL on the Ubuntu host or run it separately with Docker.
- For deployment, put Nginx or another reverse proxy in front of Fastify if you want HTTPS and easier firewall management.
- No code change is required just because the server runs on Ubuntu, but you should use Linux paths and deployment commands in production.

## Client Side

### Responsibilities

- Let users register, log in, create rooms, and accept invites
- Bind one local folder per room
- Watch the local folder for file create/change/delete events
- Gzip-compress changed files before upload
- Download remote updates and write them into the local folder
- Show history and compression statistics, then trigger restore requests

### Main client files

- `apps/desktop/src/electron/main.cjs`: Electron window and IPC entrypoint
- `apps/desktop/src/electron/services/api-client.cjs`: desktop-to-server API calls
- `apps/desktop/src/electron/services/sync-manager.cjs`: folder watching and sync loop
- `apps/desktop/src/renderer/App.vue`: desktop UI

### Client prerequisites

- Windows 10/11
- Node.js 24+ for development

### Client development

- Start one desktop client in dev mode:
  ```bash
  npm run dev:desktop
  ```
- Start only the shared Vite host for the desktop UI:
  ```bash
  npm run dev:desktop:host
  ```
- Start an additional desktop client that reuses the existing host:
  ```bash
  npm run dev:desktop:client -- --profile=alice
  ```
- Start two desktop clients on the same machine for local sync testing:
  ```bash
  npm run dev:desktop:dual
  ```

### Client packaging

- Build a portable unpacked Windows executable:
  ```bash
  npm run package:dir --workspace @syncall/desktop
  ```
- Build a Windows executable package:
  ```bash
  npm run package:win --workspace @syncall/desktop
  ```
- The unpacked executable is available at:
  ```text
  apps/desktop/release/win-unpacked/@syncalldesktop.exe
  ```
- Packaged client artifacts are written under:
  ```text
  apps/desktop/release/
  ```
- On some Windows machines, the NSIS installer step may fail because Electron Builder extracts a signing helper that needs symlink privileges. In that case, use the unpacked executable or the zipped portable build instead.

### Testing two clients on one Windows machine

- The desktop client supports separate local profiles through a command-line flag:
  ```text
  --profile=<name>
  ```
- Example:
  ```bash
  npm run dev:desktop:client -- --profile=alice
  npm run dev:desktop:client -- --profile=bob
  ```
- Or launch both at once:
  ```bash
  npm run dev:desktop:dual
  ```
- Each profile uses its own local session and binding file, so you can log in as two different users on the same machine and bind two different folders.
- For a local sync test, create two folders such as:
  ```text
  C:\syncall-test\alice
  C:\syncall-test\bob
  ```
- Then run two client windows with different profiles, sign in as different users, join the same room, and bind each client to a different folder.
- The `dev:desktop` command now reuses an already running desktop dev server on port `5173`, so opening another client no longer fails just because the first client already started the UI host.

## Website

### Responsibilities

- Show the project landing page
- Provide a lightweight signed-in status view for rooms, invites, and recent activity

### Development

- Start the website:
  ```bash
  npm run dev:web
  ```

## Validation

- Typecheck all workspaces:
  ```bash
  npm run typecheck
  ```
- Run server tests:
  ```bash
  npm run test --workspace @syncall/server
  ```


