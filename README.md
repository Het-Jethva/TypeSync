# TypeSync

[![CI](https://github.com/Het-Jethva/TypeSync/actions/workflows/ci.yml/badge.svg)](https://github.com/Het-Jethva/TypeSync/actions/workflows/ci.yml)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-brightgreen)

TypeSync is a real-time collaborative rich-text editor built with React, TipTap,
Yjs, and Socket.IO. It supports shared documents, live collaborator presence,
role-based access, and offline edit recovery.

**[Try the live demo](https://typesync.hetjethva.tech)**

## Features

- Real-time, conflict-free collaborative editing
- Rich-text formatting with TipTap
- Live collaborator cursors and selections
- Owner, editor, and viewer access roles
- Document sharing and access management
- Offline edit buffering and automatic reconnection
- Session-based authentication
- Persistent document storage in PostgreSQL

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, TipTap, Tailwind CSS, Vite |
| Backend | Node.js, Express 5, Socket.IO |
| Collaboration | Yjs CRDTs and Yjs awareness |
| Data and auth | PostgreSQL, Drizzle ORM, Better Auth |
| Validation | Zod and shared TypeScript types |

## How It Works

TipTap converts editor changes into Yjs updates, which are sent to the server
over Socket.IO. The server validates and applies each update to its
authoritative Yjs document, broadcasts accepted changes to collaborators, and
periodically persists the document state to PostgreSQL.

When a client goes offline, TypeSync buffers unsent edits and synchronizes the
missing changes after reconnecting. Presence data, such as cursors and
selections, uses a separate ephemeral channel.

For a deeper look at the collaboration model and its main components, see
[CONTEXT.md](CONTEXT.md).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Docker](https://www.docker.com/)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/Het-Jethva/TypeSync.git
   cd TypeSync
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

4. Create the server environment file:

   ```bash
   cp .env.example server/.env
   ```

   Replace the placeholder `BETTER_AUTH_SECRET` in `server/.env` with a secure
   random value.

5. Apply the database migrations:

   ```bash
   npm run db:migrate
   ```

6. Start the development servers:

   ```bash
   npm run dev
   ```

The client runs at <http://localhost:5173> and the API runs at
<http://localhost:3000>.
