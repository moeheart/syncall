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

- Front-end: Electron + Vue.js for the desktop client, plus Vue.js for the project website and optional admin dashboard
- Back-end: Node.js + Fastify + Socket.IO for authentication, room management, event broadcasting, and sync coordination
- Database: PostgreSQL for users, rooms, file metadata, and version records; shared files stored on the server filesystem in the initial version

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


