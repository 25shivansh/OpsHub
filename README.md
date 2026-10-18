# Newtonite — Operations Under Pressure

Newtonite is a production-minded team work-management platform built as an **npm workspaces monorepo** with Next.js 16 (Turbopack, TailwindCSS 4), Express + TypeScript, Supabase PostgreSQL, Drizzle ORM, BullMQ + Redis, and Vitest.

---

## 1. Repository Structure

```text
opshub/
├── apps/
│   ├── web/                     # Next.js 16 frontend application
│   │   ├── app/                 # App Router (page.tsx, layout.tsx, globals.css)
│   │   │   └── lib/api.ts       # Typed API client with idempotency & error handling
│   │   ├── public/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── next.config.ts       # API proxy rewrites
│   │
│   └── api/                     # Express backend & worker engine
│       ├── src/
│       │   ├── app.ts           # Express application setup
│       │   ├── server.ts        # Server entry with graceful shutdown & relay loop
│       │   ├── config/          # Zod-validated environment configuration
│       │   ├── db/              # Drizzle ORM schema, client, seed & verify
│       │   │   ├── schema.ts    # Database schema with strict constraints & indices
│       │   │   ├── index.ts     # Connection pool configured for Supabase pooler
│       │   │   ├── seed.ts      # Deterministic demo seed script
│       │   │   └── verify.ts    # Schema integrity verification suite
│       │   ├── middleware/      # Auth, authorization, validation & idempotency
│       │   ├── modules/
│       │   │   ├── auth/        # JWT authentication & session endpoints
│       │   │   ├── work-items/  # Work-item CRUD, atomic claim & workflow engine
│       │   │   ├── notifications/# Notifications inbox, counts & mark-read APIs
│       │   │   └── dashboard/   # Aggregated operational metrics & activity feed
│       │   └── jobs/            # Transactional outbox relay, processor & BullMQ worker
│       ├── drizzle/             # Versioned SQL migrations & snapshots
│       ├── test/                # Comprehensive Vitest integration test suite
│       ├── drizzle.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── .env.example
│
├── docker-compose.yml           # Redis service for local background queue processing
├── package.json                 # Root workspace manifest
├── package-lock.json
├── .gitignore
├── .env.example
└── README.md
```

---

## 2. Core Architecture & Implemented Features

### Phase 4 — Workflow Engine & Atomic Work-Item Claiming
- **Dedicated Endpoints:**
  - `POST /api/v1/items/:id/claim`: Atomically claims an unassigned `OPEN` work item for the caller. Uses conditional SQL updates (`WHERE id = :id AND status = 'OPEN' AND assignee_id IS NULL AND version = :v`) to serialize concurrent attempts and eliminate race conditions.
  - `POST /api/v1/items/:id/transition`: Enforces a deterministic role-governed state machine (`OPEN` &rarr; `IN_PROGRESS` &rarr; `AWAITING_APPROVAL` &rarr; `RESOLVED` &rarr; `CLOSED`). Approval decisions and reopening closed items are strictly gated to `LEAD` and `ADMIN`. Direct `PATCH` bypasses are blocked.
  - `POST /api/v1/items/:id/assign`: Validates target user is an active team member; eliminates no-op updates and duplicate audit events.
- **Activity Events:** Emits `CREATED`, `CLAIMED`, `ASSIGNED`, and `STATUS_CHANGED` events in the exact same database transaction as the mutation.

### Phase 5 — Mutation Idempotency
- **Header-Based Protection:** Mutation endpoints accept `Idempotency-Key` (or `X-Idempotency-Key`).
- **Actor Scoping:** Idempotency records are scoped strictly to `(actor_id, key)` via PostgreSQL unique indices.
- **Payload Hash Validation:** Computes canonical SHA-256 hash of the request method, path, and sorted payload. Reusing a key with a different payload returns `422 Unprocessable Entity`.
- **Safe Replay:** Valid retries replay the original status and response body with `Idempotent-Replay: true` header without re-executing business logic or writing duplicate activity logs.
- **Concurrent Lock Safety:** Concurrent requests using the same key are caught via row-level unique constraints and return `409 Conflict`. In-flight keys on failed requests are cleanly deleted to allow retries.

### Phase 6 — Transactional Outbox & Background Processing
- **Transactional Outbox:** Every work-item mutation writes an `outbox_events` record in status `PENDING` within the exact same database transaction as the business update.
- **BullMQ + Redis Worker:** An asynchronous queue worker consumes events from Redis (`newtonite-outbox-events`) with exponential backoff and retry tracking.
- **Autonomous Fallback:** The outbox relay includes autonomous processing capability so background jobs run reliably even in test/local environments without Redis.
- **Idempotent Delivery:** Relies on the unique constraint `(recipient_id, activity_event_id)` to guarantee notification dispatch is never duplicated.

### Phase 7 — Notifications & Dashboard APIs
- **Notifications Inbox:**
  - `GET /api/v1/notifications`: Paginated notifications with joined activity event and actor metadata.
  - `GET /api/v1/notifications/unread-count`: Fast unread count.
  - `PATCH /api/v1/notifications/:id/read`: Marks a single notification as read.
  - `POST /api/v1/notifications/read-all`: Marks all unread notifications as read.
- **Dashboard Summary:**
  - `GET /api/v1/dashboard/summary?teamId=<uuid>`: Team-scoped operational metrics including total items, status distribution (`byStatus`), priority distribution (`byPriority`), unassigned count, items assigned to me, awaiting approval count, and recent activity feed.

### Phase 8 — Next.js 16 Frontend Console
- **Rich Dark Console:** Operations-under-pressure aesthetic with dark glassmorphism, glowing status badges, and real-time micro-interactions.
- **Kanban Board & Table Views:** Dragless interactive columns for `Open Backlog`, `In Progress`, `Awaiting Approval`, `Resolved`, and `Closed`.
- **Atomic ⚡ Claim Controls:** One-click instant claim on unassigned open cards.
- **Role-Governed Workflow Bar:** Work item drawer dynamically surfaces only valid transitions permitted for the user's role.
- **Real-Time Notification Drawer:** Live notification popover with unread counter and read-state controls.
- **Account Switcher:** Instant 1-click authentication as Admin, Lead, Member, or Viewer to test role governance live.

---

## 3. Local Development Setup

### Prerequisites
- Node.js >= 20
- npm >= 10
- (Optional) Docker for Redis queue processing

### 1. Environment Configuration
Copy `.env.example` to `.env` in both repository root and `apps/api/`:
```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```
Ensure `DATABASE_URL` is configured to point to your Supabase PostgreSQL instance.

### 2. (Optional) Start Redis for Background Queue
```bash
docker compose up -d
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Seed Development Database
Populates demo team, users, and initial work items:
```bash
npm run db:seed
```

### 5. Run the Application
Open two terminals:
```bash
# Terminal 1: Backend API (Port 4000)
npm run dev:api

# Terminal 2: Next.js Frontend (Port 3000)
npm run dev:web
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Demo Accounts

All demo accounts share the development password: `Newtonite@123!`

| Name | Email | Role | Capabilities |
| :--- | :--- | :--- | :--- |
| **Admin User** | `admin@newtonite.dev` | `ADMIN` | Full control, approvals, discards, and reopening closed items |
| **Operations Lead** | `lead@newtonite.dev` | `LEAD` | Approvals, change requests, reopens, and team assignments |
| **Operations Member** | `member@newtonite.dev` | `MEMBER` | Claims work, starts tasks, submits for approval, closes resolved |
| **Auditor Viewer** | `viewer@newtonite.dev` | `VIEWER` | Read-only inspection; all mutation endpoints blocked (403 Forbidden) |

---

## 5. Verification Commands

Run from the repository root:

```bash
# Execute full API test suite (44 integration tests)
npm run test:api

# Run TypeScript checks across frontend and backend
npm run typecheck:api
npm run typecheck:web

# Run production builds
npm run build:api
npm run build:web
```
