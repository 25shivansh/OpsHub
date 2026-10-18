# Newtonite — Architectural & Engineering Decisions

This document records the five primary architectural and engineering decisions demonstrably reflected in the Newtonite codebase. Each decision describes the operational context, problem statement, plausible evaluated alternatives, chosen approach, rationale, trade-offs, and verifiable code evidence.

---

## Decision 1: Transactional Outbox Pattern with BullMQ Relay vs. Direct In-Memory/Redis Publishing

### Context and Problem
Newtonite manages high-pressure operations where state mutations—such as work-item transitions, incident status shifts, responder roster modifications, and SLA risk state escalations—must trigger secondary actions (e.g., in-app notifications, timeline audit events, external alerts).

A common failure mode in distributed architectures is the **dual-write problem**: if an HTTP handler writes to PostgreSQL and subsequently publishes a message directly to Redis or a message broker, a failure in the broker (or a process crash between the database commit and the network call) leaves the system in an inconsistent state. The business entity is saved, but the corresponding notification or event is permanently lost without trace. Conversely, publishing before committing risks emitting phantom notifications for transactions that roll back.

### Options Considered
1. **Direct Synchronous Publishing to Redis within Request Handler:**
   - Execute the database transaction, then call `redis.publish()` or BullMQ's `queue.add()` immediately before sending the HTTP response.
   - *Weakness:* Vulnerable to dual-write discrepancies upon Redis disconnections, network partitions, or server crashes.
2. **Database Triggers / PostgreSQL LISTEN/NOTIFY:**
   - Use PostgreSQL triggers on mutation tables to emit `NOTIFY` events over persistent client connections.
   - *Weakness:* Ephemeral delivery; messages are dropped if no listener is actively connected. Difficult to implement exponential backoff, dead-letter retries, or rate limiting.
3. **Transactional Outbox Pattern with Asynchronous Queue Relay (Chosen):**
   - Write an outbox record into the database within the *exact same transaction* as the operational entity change. A background relay daemon periodically sweeps pending outbox events and pushes them to a BullMQ Redis queue, falling back to autonomous direct processing if Redis is unavailable.

### Chosen Approach
We implemented the **Transactional Outbox Pattern**:
- An append-only `outbox_events` table ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L311-L338)) records event payloads in status `PENDING` within the primary database transaction.
- A periodic relay loop ([outbox.relay.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/outbox.relay.ts#L13-L77)) sweeps batches of pending events every 3 seconds (`startOutboxRelay(3000)`).
- When Redis is connected, events are enqueued into the BullMQ queue `newtonite-outbox-events` ([outbox.queue.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/outbox.queue.ts#L8-L59)), marked as `PUBLISHED`, and consumed by a dedicated BullMQ worker ([outbox.queue.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/outbox.queue.ts#L102-L181)).
- If Redis is offline or unreachable, the relay detects the failure and autonomously invokes `processOutboxEvent` directly, guaranteeing zero event loss even during queue infrastructure outages.

### Why This Approach
- **Atomicity:** Primary mutations and event generation share the same ACID transaction. If the transaction aborts, no orphan event exists. If it commits, the event is guaranteed to persist on disk.
- **Reliability:** Background retry logic with exponential backoff (`attempts: 5`, exponential backoff delay starting at 1000ms) handles transient consumer failures.
- **Environment Agnostic:** In local development or CI test environments where Docker Redis might not be running, the autonomous fallback ensures notification creation and test suites execute cleanly without external dependencies.

### Trade-offs and Limitations
- **Eventual Consistency:** Notifications and asynchronous side-effects are not delivered within the millisecond of HTTP response completion (typical lag: 100ms–3000ms depending on relay interval).
- **Outbox Table Bloat:** Processed events accumulate in `outbox_events` unless a maintenance sweep or partition retention job is scheduled.
- **At-Least-Once Delivery:** Network timeouts between BullMQ job completion and database status updates may trigger duplicate worker invocations. This is mitigated by an explicit unique database constraint `(recipient_id, activity_event_id)` on `notifications` ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L291-L294)).

### Evidence in the Codebase
- [apps/api/src/db/schema.ts:L311-L338](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L311-L338) — `outboxEvents` table schema with status lifecycle `PENDING` &rarr; `PUBLISHED` &rarr; `PROCESSED`/`FAILED`.
- [apps/api/src/jobs/outbox.relay.ts:L13-L77](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/outbox.relay.ts#L13-L77) — `relayPendingEventsOnce` implementation with BullMQ enqueuing and direct processing fallback.
- [apps/api/src/jobs/outbox.queue.ts:L102-L181](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/outbox.queue.ts#L102-L181) — `startOutboxWorker` consuming from Redis with retry tracking.
- [apps/api/src/server.ts:L15-L22](file:///e:/NewTonite%20assignment/opshub/apps/api/src/server.ts#L15-L22) — Relay lifecycle initialization in Express server boot.

---

## Decision 2: Optimistic Concurrency Control with Monotonic Integer Versioning vs. Pessimistic Locking

### Context and Problem
In fast-moving operational scenarios, multiple responders often inspect and modify the same incident or work item simultaneously. For example, two triage operators might simultaneously click "Claim" on an unassigned urgent work item, or an incident commander and an operations lead might update the incident summary and mitigation notes concurrently.

Without concurrency protection, the "last write wins" phenomenon silently overwrites earlier updates, causing loss of critical audit information, conflicting assignments, or invalid lifecycle state jumps.

### Options Considered
1. **Pessimistic Row-Level Locking (`SELECT FOR UPDATE`):**
   - Acquire exclusive database locks on work items or incidents during updates.
   - *Weakness:* Contention under concurrent read/write spikes; risk of deadlocks across complex join queries; locks held during application processing can degrade connection pool availability on Supabase/PostgreSQL poolers.
2. **Last-Write-Wins (Unchecked Overwrite):**
   - Blindly execute `UPDATE work_items SET ... WHERE id = :id`.
   - *Weakness:* Silent loss of concurrent operator edits; impossible to guarantee role workflow state machine invariants.
3. **Optimistic Concurrency Control (OCC) with Integer `version` (Chosen):**
   - Each mutable operational entity includes an integer `version` initialized at 1 and incremented on every mutation. Mutation endpoints require the client to supply the current version, and SQL updates conditionally match on `id = :id AND version = :version`.

### Chosen Approach
We implemented **Optimistic Concurrency Control**:
- Both `work_items` ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L176-L186)) and `incidents` ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L479-L489)) declare an integer `version` column backed by PostgreSQL check constraints (`CHECK ("version" >= 1)`).
- Dedicated atomic endpoints, such as `POST /api/v1/items/:id/claim`, execute single-query conditional updates:
  ```sql
  UPDATE work_items
  SET status = 'IN_PROGRESS', assignee_id = :userId, version = version + 1, updated_at = NOW()
  WHERE id = :id AND status = 'OPEN' AND assignee_id IS NULL AND version = :version
  RETURNING *;
  ```
- If another operator mutated the record in the interim, zero rows are affected. The service layer immediately detects the zero-row return and throws a typed `ConflictError` (`409 Conflict`), alerting the caller that the record has been modified by another operator.

### Why This Approach
- **Non-blocking Scalability:** Reads never take row locks, allowing high-throughput read operations and dashboard metric polling without thread starvation.
- **Deterministic Race Prevention:** For atomic claims, exact conditional SQL guarantees that only one operator successfully claims an unassigned item, completely eliminating double-claiming races.
- **Frontend Feedback:** The frontend receives a clean `409 Conflict` status code and surfaces an actionable conflict banner prompting the operator to refresh and review changes before re-applying edits.

### Trade-offs and Limitations
- **Client Responsibility:** The frontend must maintain the current entity version in local state and pass it in mutation payloads (`version: item.version`).
- **Retry Overhead:** On high contention on a single item, rejected requests require client-side re-fetching rather than queuing behind a lock. (Acceptable for human operational workflows where simultaneous edits to the exact same ticket are exceptional events).

### Evidence in the Codebase
- [apps/api/src/db/schema.ts:L176-L186](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L176-L186) — `work_items.version` declaration and check constraint.
- [apps/api/src/db/schema.ts:L479-L489](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L479-L489) — `incidents.version` declaration and check constraint.
- [apps/api/src/modules/work-items/work-items.service.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/modules/work-items/work-items.service.ts) — `claimWorkItem` and `updateWorkItem` enforcing version check and throwing `ConflictError`.
- [apps/api/src/modules/incidents/incidents.service.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/modules/incidents/incidents.service.ts) — `updateIncident` verifying incident version before executing mutations.

---

## Decision 3: SLA Commitment Snapshotting & 4-Tier Specificity Matching vs. Dynamic Lookup

### Context and Problem
Service Level Agreements (SLAs) define contractual response and resolution time targets for operational work items. In production environments, management frequently revises SLA policies (e.g., shortening response times from 30 minutes to 15 minutes for critical incidents).

If work-item deadlines are computed on-the-fly by joining against current policy configuration, historical items immediately show retroactively altered deadlines and synthetic breaches. Conversely, if policies are entirely ad-hoc per item, policy governance and centralized team SLA metrics become unmanageable.

### Options Considered
1. **Dynamic Policy Join on Every Read:**
   - Store only a `policy_id` foreign key on work items. Dynamically join `sla_policies` at query time to compute deadlines based on `created_at + response_target_minutes`.
   - *Weakness:* Editing a policy retroactively rewrites the target deadlines of all completed or in-flight tickets.
2. **Hardcoded Global Thresholds:**
   - Fixed constants in application code (e.g., 2 hours for high priority, 24 hours for normal).
   - *Weakness:* No multi-tenant team customization; cannot distinguish incident workflows from routine tasks.
3. **4-Tier Specificity Matching with Assignment-Time Snapshotting (Chosen):**
   - Provide a 4-tier specificity matching engine to select the best active team policy, then snapshot targets and precompute deadlines directly into a 1:1 `work_item_slas` record upon assignment.

### Chosen Approach
We implemented **4-Tier Specificity Matching with Commitment Snapshotting**:
- Policies are matched in strict precedence order ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L599-L604)):
  1. *Tier 1:* Exact Type + Exact Priority (`work_item_type = :t AND priority = :p`)
  2. *Tier 2:* Exact Type + Wildcard Priority (`work_item_type = :t AND priority IS NULL`)
  3. *Tier 3:* Wildcard Type + Exact Priority (`work_item_type IS NULL AND priority = :p`)
  4. *Tier 4:* Team Default Catch-All (`work_item_type IS NULL AND priority IS NULL`)
- Partial unique indexes in PostgreSQL enforce that no team can configure conflicting active policies within any tier ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L647-L670)).
- When a work item is created or assigned, the matching policy's `response_target_minutes`, `resolution_target_minutes`, and `warning_threshold_percent` are copied into `work_item_slas` ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L679-L752)), and exact UTC timestamps for `response_deadline` and `resolution_deadline` are precomputed and indexed.

### Why This Approach
- **Historical Integrity:** A work item accepted under a 4-hour SLA retains that 4-hour commitment forever, regardless of future policy revisions.
- **Fast Index Scans:** The SLA Evaluation scheduler can query `WHERE risk_state != 'COMPLETED' AND resolution_deadline < :now` using standard b-tree indexes ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L731-L738)) without computing date math across joined tables.
- **Fine-Grained Governance:** Teams can define generic fallback targets while overriding critical subsets (e.g., specific rules for `INCIDENT` + `URGENT`).

### Trade-offs and Limitations
- **Storage Redundancy:** Storing deadline timestamps and target minutes per work item duplicates small integer values across the database.
- **Explicit Recalculation Required:** If an operator intentionally wants to apply a new policy to an existing open ticket, an explicit update action is required rather than an automatic cascade.

### Evidence in the Codebase
- [apps/api/src/db/schema.ts:L645-L670](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L645-L670) — Four partial unique indexes enforcing tier specificity collision prevention on active policies.
- [apps/api/src/db/schema.ts:L679-L752](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L679-L752) — `work_item_slas` table definition with snapshotted minutes and precomputed deadlines.
- [apps/api/src/modules/sla/sla-risk.engine.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/modules/sla/sla-risk.engine.ts) — `findMatchingPolicy` implementing the 4-tier priority cascade and deadline precomputation.
- [apps/api/src/jobs/sla.evaluator.ts:L13-L50](file:///e:/NewTonite%20assignment/opshub/apps/api/src/jobs/sla.evaluator.ts#L13-L50) — Background sweep querying precomputed deadlines every 60 seconds.

---

## Decision 4: Team-Scoped Hierarchical Role-Based Access Control (RBAC)

### Context and Problem
In an operations command center, different personas have different operational responsibilities. An auditor or read-only observer must not be able to transition an active incident or claim work. Conversely, an operations member should be empowered to claim open tasks, but final sign-off (approvals) and destructive operations (deleting SLA policies, cleaning queues) must be gated to leads and administrators.

Furthermore, access must be scoped to the user's specific team membership rather than a global role, preventing cross-team data leaks.

### Options Considered
1. **Global User Roles:**
   - Store a single `role` column on the `users` table (`users.role = 'ADMIN'`).
   - *Weakness:* Fails in multi-tenant environments where a user might be a `LEAD` in DevOps but a `VIEWER` in Compliance.
2. **Attribute-Based Access Control (ABAC) / Policy Rules Engine:**
   - Dynamic JSON rule evaluation on every request.
   - *Weakness:* Excessive operational complexity for the verified application scope; difficult to query and test deterministically.
3. **Team-Scoped Hierarchical RBAC (Chosen):**
   - Store roles on the `team_memberships` join table with a strict hierarchy: `ADMIN` (4) > `LEAD` (3) > `MEMBER` (2) > `VIEWER` (1). Enforce access via reusable Express middleware before request handlers execute.

### Chosen Approach
We implemented **Team-Scoped Hierarchical RBAC**:
- `teamMemberships` ([schema.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L125-L146)) maps `(userId, teamId)` to a `role` enum (`VIEWER`, `MEMBER`, `LEAD`, `ADMIN`).
- Middleware `requireTeamRole(teamIdExtractor, minimumRole)` ([authorize.ts](file:///e:/NewTonite%20assignment/opshub/apps/api/src/middleware/authorize.ts)) extracts the team context, queries membership, and verifies the user meets or exceeds the required threshold using integer weight comparisons:
  ```typescript
  const ROLE_HIERARCHY: Record<TeamMembershipRole, number> = {
    VIEWER: 1,
    MEMBER: 2,
    LEAD: 3,
    ADMIN: 4,
  };
  ```
- Specific high-privilege operations enforce explicit boundaries:
  - `POST /api/v1/queue/simulate-failure` and `POST /api/v1/queue/jobs/:id/retry` require `LEAD` or `ADMIN`.
  - `POST /api/v1/queue/clean` and `DELETE /api/v1/teams/:teamId/sla/policies/:policyId` strictly require `ADMIN`.
  - Workflow transitions from `AWAITING_APPROVAL` to `RESOLVED` or reopening `CLOSED` items require `LEAD` or `ADMIN`.

### Why This Approach
- **Security In Depth:** Authorization is enforced in Express middleware before controller logic executes, preventing unauthorized data modification even if client-side validation is bypassed.
- **Granular Multi-Tenancy:** Users hold distinct roles in distinct teams without permission bleed.
- **Fast Authorization Checks:** The composite primary key `(user_id, team_id)` ensures index-backed $O(1)$ permission resolution on every authenticated request.

### Trade-offs and Limitations
- **Database Lookup on Route Access:** Middleware queries `team_memberships` per request. (Cached or mitigated via composite primary key index lookup).
- **Hierarchy Inflexibility:** A linear hierarchy means an `ADMIN` inherently possesses all `MEMBER` permissions. If an organization requires non-hierarchical role separation (e.g., an admin who cannot view operational tickets), custom policy claims would be needed.

### Evidence in the Codebase
- [apps/api/src/db/schema.ts:L22-L27](file:///e:/NewTonite%20assignment/opshub/apps/api/src/db/schema.ts#L22-L27) — Enum definition for `team_membership_role`.
- [apps/api/src/middleware/authorize.ts:L15-L35](file:///e:/NewTonite%20assignment/opshub/apps/api/src/middleware/authorize.ts#L15-L35) — `ROLE_HIERARCHY` map and `hasMinimumRole` comparator.
- [apps/api/src/modules/sla/sla.routes.ts:L63-L68](file:///e:/NewTonite%20assignment/opshub/apps/api/src/modules/sla/sla.routes.ts#L63-L68) — Gating policy creation to `LEAD` and policy deletion to `ADMIN`.
- [apps/api/src/modules/queue-simulator/queue-simulator.routes.ts:L25-L60](file:///e:/NewTonite%20assignment/opshub/apps/api/src/modules/queue-simulator/queue-simulator.routes.ts#L25-L60) — `requireQueueOperatorRole` enforcing role boundaries on queue mutation endpoints.

---

## Decision 5: Single-Route State-Driven Navigation vs. Deep Multi-Route App Router Pages

### Context and Problem
Modern Next.js 16 applications typically use file-system routing where each page lives in a separate subdirectory (e.g., `/dashboard/overview`, `/dashboard/incidents`, `/dashboard/sla`).

However, Newtonite is an operational command console designed for active crisis response. Responders monitor live countdowns, background queue health metrics, unread notification counters, and active drawer states while triaging tickets or managing an incident. 

Transitioning between deep browser routes in standard frameworks triggers route tree reconciliation, resets component state, tears down polling intervals, and causes screen re-rendering flashes during critical response moments.

### Options Considered
1. **Multi-Route Next.js App Router (`/dashboard/*` subpaths):**
   - Place each feature in a distinct file: `app/dashboard/overview/page.tsx`, `app/dashboard/incidents/page.tsx`, etc.
   - *Weakness:* Causes route transition latency; requires complex cross-page global state or URL param serialization to preserve filter states, selected drawer tickets, and live simulation telemetry.
2. **Single-Route State-Driven Console Architecture (Chosen):**
   - The entire authenticated console renders on `http://localhost:3000/` within `apps/web/app/page.tsx`. Navigation tabs (`overview`, `workbench`, `incidents`, `sla`, `queue`, `intelligence`, `blast-radius`) toggle client-side state (`activeNavTab`).
   - Any external navigation or bookmark attempt to `/dashboard` or `/dashboard/*` is permanently intercepted and redirected to `/` via Next.js server configuration.

### Chosen Approach
We implemented the **Single-Route State-Driven Navigation Architecture**:
- In `apps/web/app/page.tsx` ([page.tsx](file:///e:/NewTonite%20assignment/opshub/apps/web/app/page.tsx#L110-L120)), navigation is orchestrated through an enum-typed React state variable:
  ```typescript
  const [activeNavTab, setActiveNavTab] = useState<
    "overview" | "workbench" | "sla" | "incidents" | "queue" | "intelligence" | "blast-radius"
  >("overview");
  ```
- Sub-dashboards (`OperationsOverview`, `IncidentCommandCenter`, `SlaDashboard`, `QueueSimulatorDashboard`, `IncidentIntelligenceDashboard`, `DependencyBlastRadiusMap`) are modular components mounted conditionally within the main layout.
- In `apps/web/next.config.ts` ([next.config.ts](file:///e:/NewTonite%20assignment/opshub/apps/web/next.config.ts#L4-L17)), server-level redirects are explicitly configured:
  ```typescript
  async redirects() {
    return [
      { source: "/dashboard/:path*", destination: "/", permanent: false },
      { source: "/dashboard", destination: "/", permanent: false },
    ];
  }
  ```
- When unauthenticated or when the "Platform Overview" toggle is clicked, the public `LandingPage` component renders within the same route tree.

### Why This Approach
- **Zero-Latency Tab Switching:** Switching between the Incident Command Center and the SLA Risk Engine is instant ($0\text{ ms}$ network round-trip), enabling rapid context-switching during incident triage.
- **State Preservation:** Notification popovers, drawer selection states, filter inputs, and active queue simulation telemetry remain completely undisturbed when navigating across tools.
- **Unified Persona Testing:** The 1-click demo persona switcher re-authenticates and refetches data seamlessly in-place without triggering page reloads.

### Trade-offs and Limitations
- **No Deep URL Bookmarking:** Users cannot bookmark a specific tab directly (e.g., sharing a URL pointing specifically to the Queue Simulator requires future query-string synchronization such as `/?tab=queue`).
- **Initial Bundle Size:** All primary console component trees are included in the main page bundle rather than automatically code-split into distinct HTML pages.

### Evidence in the Codebase
- [apps/web/app/page.tsx:L110-L120](file:///e:/NewTonite%20assignment/opshub/apps/web/app/page.tsx#L110-L120) — `activeNavTab` state orchestrating all major feature views.
- [apps/web/next.config.ts:L4-L17](file:///e:/NewTonite%20assignment/opshub/apps/web/next.config.ts#L4-L17) — Server-side redirect rules rerouting `/dashboard` paths to root `/`.
- [apps/web/app/components/](file:///e:/NewTonite%20assignment/opshub/apps/web/app/components/) — Cohesive suite of modular view components mounted directly by `page.tsx`.
