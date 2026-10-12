# TypeSync

A collaborative rich-text editor with live cursors, document sharing, and an AI co-editor. Write together in real time and review AI suggestions before they change the document.

[Try the live demo](https://typesync.hetjethva.tech)

## What you can do

- Edit together with live cursors and collaborator presence.
- Write rich text with tables, task lists, images, code blocks, and slash commands.
- Share documents by email with owner, editor, and viewer permissions.
- Ask AI to rewrite, shorten, fix grammar, or follow a custom instruction. Suggestions stream to collaborators for review and remain in shared history.
- Search and sort your documents, and export them as HTML, plain text, or JSON.

## How it works

TipTap handles the editor, while Yjs merges concurrent edits using a conflict-free replicated data type, or CRDT. Socket.IO carries document updates and presence between clients and the Express server. REST endpoints handle document management and sharing. PostgreSQL stores document state and AI suggestion history.

The implementation accounts for changes that happen while people work together:

- The client queues pending edits and retries delivery after reconnecting. It marks a document as synced only after the server confirms PostgreSQL persistence.
- The server enforces document permissions when collaborators join and submit edits.
- AI suggestions use Yjs relative positions to follow a selected passage as surrounding text moves. Acceptance checks the original text, formatting, and character identity so a suggestion cannot overwrite a changed passage.

## Built with

| Layer | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TipTap |
| Collaboration | Yjs, Socket.IO |
| Backend | Node.js, Express, PostgreSQL, Drizzle ORM |
| Auth and AI | Better Auth, Resend, OpenRouter |

The npm workspace separates the frontend in `client/`, backend in `server/`, and shared schemas and socket contracts in `shared/`.

## Run locally

Use Node.js 24 or later, npm, and Docker.

1. Install dependencies, start PostgreSQL, and copy the environment template.

   ```sh
   npm install
   docker compose up -d
   cp server/.env.example server/.env
   ```

2. Edit `server/.env`. Set `BETTER_AUTH_SECRET` to a random secret of at least 32 characters. Set `RESEND_API_KEY` and `EMAIL_FROM` to credentials and a sender for your verified Resend domain. Signup requires email verification, including in development. The template's database and localhost URLs match the local setup.

   To enable AI suggestions, also set `OPENROUTER_API_KEY`. Without it, document editing still works.

3. Apply migrations and start the app.

   ```sh
   npm run db:migrate
   npm run dev
   ```

Open [localhost:5173](http://localhost:5173), create an account, and verify your email before signing in. The backend runs on port 3000.

Run `npm run check` for lint, type checks, regression tests, and a production build.
