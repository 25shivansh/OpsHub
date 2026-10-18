/**
 * Newtonite API Client
 * Connects the Next.js frontend to the Express backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

export interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface CurrentUserResponse {
  user: User;
  teams: Array<{
    teamId: string;
    teamName: string;
    teamSlug: string;
    role: string;
    joinedAt: string;
  }>;
}

export type SlaRiskState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED";

export interface WorkItemSla {
  id: string;
  workItemId: string;
  policyId: string | null;
  riskState: SlaRiskState;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  warningThresholdPercent: number;
  responseDeadline: string;
  resolutionDeadline: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  breachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlaPolicy {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  workItemType: "TASK" | "INCIDENT" | "REQUEST" | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" | null;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  warningThresholdPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSlaPolicyInput {
  name: string;
  description?: string;
  workItemType?: "TASK" | "INCIDENT" | "REQUEST" | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" | null;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  warningThresholdPercent?: number;
  isActive?: boolean;
}

export interface UpdateSlaPolicyInput {
  name?: string;
  description?: string;
  responseTargetMinutes?: number;
  resolutionTargetMinutes?: number;
  warningThresholdPercent?: number;
}

export interface SlaMetrics {
  totalPolicies: number;
  activePolicies: number;
  totalSlas: number;
  activeSlas: number;
  onTrackCount: number;
  atRiskCount: number;
  breachedCount: number;
  completedCount: number;
  responseCompliance: {
    eligible: number;
    compliant: number;
    rate: number | null;
  };
  resolutionCompliance: {
    eligible: number;
    compliant: number;
    rate: number | null;
  };
}

// Queue Simulator Types
export type QueueSimulationScenario =
  | "TRANSIENT_TIMEOUT"
  | "RATE_LIMIT_EXCEEDED"
  | "DOWNSTREAM_500";

export interface QueueJob {
  id: string;
  name: string;
  isDemoJob: boolean;
  scenario: string;
  scenarioName: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  teamId?: string | null;
  triggeredByUserId?: string | null;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown";
  recovered?: boolean;
}

export interface QueueHealth {
  isAvailable: boolean;
  status: "HEALTHY" | "DEGRADED" | "DISCONNECTED";
  queueName: string;
  redisEndpoint: string;
  latencyMs: number | null;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  outboxDbStats: {
    pending: number;
    published: number;
    processed: number;
    failed: number;
  };
  error: string | null;
}

export interface TriggerDemoJobInput {
  scenario: QueueSimulationScenario;
  scenarioName?: string;
  errorMessage?: string;
  simulateTransientRecovery?: boolean;
  maxAttempts?: number;
  teamId?: string;
}

export interface WorkItem {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  type: "TASK" | "INCIDENT" | "REQUEST";
  status: "OPEN" | "IN_PROGRESS" | "AWAITING_APPROVAL" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assigneeId: string | null;
  createdById: string;
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  sla?: WorkItemSla | null;
}

export interface PaginatedWorkItems {
  data: WorkItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardMetrics {
  totalWorkItems: number;
  unassignedCount: number;
  assignedToMeCount: number;
  awaitingApprovalCount: number;
  byStatus: {
    OPEN: number;
    IN_PROGRESS: number;
    AWAITING_APPROVAL: number;
    RESOLVED: number;
    CLOSED: number;
  };
  byPriority: {
    LOW: number;
    NORMAL: number;
    HIGH: number;
    URGENT: number;
  };
}

export interface DashboardData {
  team: {
    id: string;
    name: string;
    slug: string;
    role: "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
  };
  metrics: DashboardMetrics;
  recentActivity: Array<{
    id: string;
    itemId: string;
    itemTitle: string | null;
    actorId: string | null;
    actorName: string | null;
    eventType: string;
    oldValue: any;
    newValue: any;
    createdAt: string;
  }>;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  activityEventId: string;
  readAt: string | null;
  createdAt: string;
  event: {
    id: string;
    itemId: string | null;
    actorId: string | null;
    actorName: string | null;
    eventType: string | null;
    itemTitle: string | null;
    itemStatus: string | null;
    oldValue: any;
    newValue: any;
    createdAt: string | null;
  } | null;
}

export interface PaginatedNotifications {
  data: NotificationItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type IncidentImpact =
  | "TOTAL_OUTAGE"
  | "MAJOR_DEGRADATION"
  | "MINOR_DEGRADATION"
  | "NO_IMPACT";
export type IncidentStatus =
  | "DECLARED"
  | "INVESTIGATING"
  | "IDENTIFIED"
  | "MITIGATING"
  | "MONITORING"
  | "RESOLVED"
  | "POSTMORTEM"
  | "CLOSED";
export type IncidentResponderRole =
  | "COMMANDER"
  | "COMMUNICATIONS"
  | "OPERATIONS"
  | "SUBJECT_MATTER_EXPERT"
  | "OBSERVER";

export interface IncidentResponder {
  userId: string;
  userName: string;
  userEmail: string;
  role: IncidentResponderRole;
  assignedAt: string;
}

export interface Incident {
  id: string;
  teamId: string;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  impact: IncidentImpact;
  status: IncidentStatus;
  commanderId: string | null;
  declaredById: string;
  declaredAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  mitigationNotes: string | null;
  postmortemUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  responders?: IncidentResponder[];
  linkedItemCount?: number;
}

export interface PaginatedIncidents {
  data: Incident[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IncidentTimelineEvent {
  id: string;
  eventType: string;
  message: string | null;
  actorId: string | null;
  actorName: string | null;
  oldValue: any;
  newValue: any;
  createdAt: string;
}

export interface IncidentLinkedItem {
  workItemId: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  assigneeId: string | null;
  linkedAt: string;
  linkedByName: string | null;
}

// =============================================================================
// Feature 4: Explainable Incident Intelligence Types
// =============================================================================

export interface IntelligenceFinding {
  id: string;
  category:
    | "SEVERITY_IMPACT"
    | "SLA_BREACH"
    | "COMMAND_RESPONSE"
    | "WORK_ITEMS"
    | "ACTIVITY_STALENESS";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  finding: string;
  evidence: string;
  whyItMatters: string;
  recommendedAction: string;
}

export interface RecommendedActionItem {
  priority: "IMMEDIATE" | "HIGH" | "MEDIUM" | "ROUTINE";
  action: string;
  rationale: string;
}

export interface IncidentIntelligence {
  incidentId: string;
  incidentTitle: string;
  severity: IncidentSeverity;
  impact: IncidentImpact;
  status: IncidentStatus;
  isResolved: boolean;
  ageMinutes: number;
  ageFormatted: string;
  declaredAt: string;
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  riskScore: number;
  riskSummary: string;
  riskFactors: string[];
  slaStatus: {
    hasSla: boolean;
    overallRiskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA";
    breachedCount: number;
    atRiskCount: number;
    earliestDeadline: string | null;
    isOverdue: boolean;
  };
  commandStatus: {
    hasCommander: boolean;
    commanderId: string | null;
    commanderName: string | null;
    responderCount: number;
    rolesPresent: string[];
    missingKeyRoles: string[];
  };
  linkedItemsSummary: {
    total: number;
    open: number;
    inProgress: number;
    awaitingApproval: number;
    resolved: number;
    closed: number;
    unresolvedCount: number;
  };
  activityStatus: {
    timelineEventsCount: number;
    lastActivityAt: string;
    minutesSinceLastActivity: number;
    isStale: boolean;
    stalenessThresholdMinutes: number;
  };
  findings: IntelligenceFinding[];
  recommendedActions: RecommendedActionItem[];
  assessedAt: string;
}

export interface IncidentIntelligenceListItem {
  incidentId: string;
  title: string;
  severity: IncidentSeverity;
  impact: IncidentImpact;
  status: IncidentStatus;
  declaredAt: string;
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  riskScore: number;
  riskSummary: string;
  hasCommander: boolean;
  commanderName: string | null;
  unresolvedItemsCount: number;
  slaRiskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA";
  findingsCount: number;
}

export interface TeamIncidentsIntelligenceOverview {
  teamId: string;
  totalIncidents: number;
  activeIncidents: number;
  criticalRiskCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  slaBreachedCount: number;
  unassignedCommanderCount: number;
  staleIncidentsCount: number;
  incidents: IncidentIntelligenceListItem[];
}

// =============================================================================
// Feature 5: Dependency & Blast-Radius Map Types
// =============================================================================

export interface BlastRadiusNode {
  id: string;
  type: "INCIDENT_ROOT" | "LINKED_WORK_ITEM";
  title: string;
  itemType?: "TASK" | "INCIDENT" | "REQUEST";
  status: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  severity?: string;
  impact?: string;
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  sla?: {
    riskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA";
    resolutionDeadline: string | null;
    responseDeadline: string | null;
    isOverdue: boolean;
    breachedAt: string | null;
  } | null;
  linkedAt?: string;
  linkedByName?: string | null;
  isUnresolved: boolean;
  isUrgentOrHigh: boolean;
}

export interface BlastRadiusEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: "DIRECT_LINK" | "SHARED_ASSIGNEE";
  label: string;
  isDirect: boolean;
  description: string;
}

export interface BlastRadiusSummary {
  incidentId: string;
  incidentTitle: string;
  teamId: string;
  severity: string;
  impact: string;
  status: string;
  declaredAt: string;
  resolvedAt: string | null;
  commander: {
    id: string;
    name: string;
    email: string;
  } | null;

  totalDirectlyLinkedItems: number;
  unresolvedCount: number;
  resolvedCount: number;
  urgentOrHighCount: number;
  breachedSlaCount: number;
  atRiskSlaCount: number;
  uniqueAssigneesCount: number;
  unassignedItemsCount: number;

  blastRadiusLevel: "CRITICAL" | "HIGH" | "ELEVATED" | "CONTAINED" | "MINIMAL";
  impactSummary: string;
  riskHighlights: string[];

  nodes: BlastRadiusNode[];
  edges: BlastRadiusEdge[];

  generatedAt: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;

  constructor(message: string, status: number, code?: string, details?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Generates an idempotent random UUID v4 string for mutation requests.
 */
function generateIdempotencyKey(): string {
  return "idem-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("newtonite_token");
}

export function setToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("newtonite_token", token);
  }
}

export function clearToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("newtonite_token");
    localStorage.removeItem("newtonite_user");
  }
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("newtonite_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("newtonite_user", JSON.stringify(user));
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type");
  let data: any = null;
  if (contentType && contentType.includes("application/json")) {
    data = await res.json();
  }

  if (!res.ok) {
    const errorMsg = data?.error?.message || res.statusText || "Request failed";
    const errorCode = data?.error?.code;
    throw new ApiError(errorMsg, res.status, errorCode, data?.error?.details);
  }

  return data as T;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setStoredUser(data.user);
    return data;
  },

  async loginDemo(email: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>("/auth/demo-login", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setToken(data.token);
    setStoredUser(data.user);
    return data;
  },

  async getCurrentUser(): Promise<CurrentUserResponse> {
    return request<CurrentUserResponse>("/auth/me");
  },

  async logout(): Promise<void> {
    clearToken();
  },

  // Dashboard
  async getDashboardSummary(teamId?: string): Promise<DashboardData> {
    const query = teamId && teamId.trim() ? `?teamId=${encodeURIComponent(teamId.trim())}` : "";
    return request<DashboardData>(`/dashboard/summary${query}`);
  },

  // Work Items
  async listWorkItems(params: {
    teamId?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedWorkItems> {
    const query = new URLSearchParams();
    if (params.teamId && params.teamId.trim()) {
      query.set("teamId", params.teamId.trim());
    }
    if (params.status) query.set("status", params.status);
    if (params.priority) query.set("priority", params.priority);
    if (params.assigneeId) query.set("assigneeId", params.assigneeId);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const qs = query.toString();
    return request<PaginatedWorkItems>(`/items${qs ? `?${qs}` : ""}`);
  },

  async getWorkItem(id: string): Promise<WorkItem> {
    return request<WorkItem>(`/items/${id}`);
  },

  async createWorkItem(data: {
    teamId: string;
    title: string;
    description?: string;
    type?: "TASK" | "INCIDENT" | "REQUEST";
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    assigneeId?: string | null;
  }): Promise<WorkItem> {
    return request<WorkItem>("/items", {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify(data),
    });
  },

  async claimWorkItem(id: string, expectedVersion?: number): Promise<WorkItem> {
    return request<WorkItem>(`/items/${id}/claim`, {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify({ expectedVersion }),
    });
  },

  async transitionWorkItem(
    id: string,
    status: WorkItem["status"],
    expectedVersion?: number
  ): Promise<WorkItem> {
    return request<WorkItem>(`/items/${id}/transition`, {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify({ status, expectedVersion }),
    });
  },

  async assignWorkItem(
    id: string,
    assigneeId: string | null,
    expectedVersion?: number
  ): Promise<WorkItem> {
    return request<WorkItem>(`/items/${id}/assign`, {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify({ assigneeId, expectedVersion }),
    });
  },

  // Notifications
  async listNotifications(params: {
    unreadOnly?: boolean;
    page?: number;
    limit?: number;
  } = {}): Promise<PaginatedNotifications> {
    const query = new URLSearchParams();
    if (params.unreadOnly !== undefined) query.set("unreadOnly", String(params.unreadOnly));
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    return request<PaginatedNotifications>(`/notifications?${query.toString()}`);
  },

  async getUnreadCount(): Promise<{ count: number }> {
    return request<{ count: number }>("/notifications/unread-count");
  },

  async markNotificationRead(id: string): Promise<void> {
    return request<void>(`/notifications/${id}/read`, {
      method: "PATCH",
    });
  },

  async markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return request<{ updatedCount: number }>("/notifications/read-all", {
      method: "POST",
    });
  },

  // Incidents
  async listIncidents(params: {
    teamId?: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  } = {}): Promise<PaginatedIncidents> {
    const query = new URLSearchParams();
    if (params.teamId) query.set("teamId", params.teamId);
    if (params.status) query.set("status", params.status);
    if (params.severity) query.set("severity", params.severity);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.sortBy) query.set("sortBy", params.sortBy);
    if (params.sortOrder) query.set("sortOrder", params.sortOrder);

    return request<PaginatedIncidents>(`/incidents?${query.toString()}`);
  },

  async getIncident(id: string): Promise<Incident> {
    return request<Incident>(`/incidents/${id}`);
  },

  async declareIncident(data: {
    teamId: string;
    title: string;
    summary?: string;
    severity?: IncidentSeverity;
    impact?: IncidentImpact;
    commanderId?: string | null;
  }): Promise<Incident> {
    return request<Incident>("/incidents", {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify(data),
    });
  },

  async updateIncident(
    id: string,
    data: {
      title?: string;
      summary?: string;
      severity?: IncidentSeverity;
      impact?: IncidentImpact;
      mitigationNotes?: string;
      postmortemUrl?: string;
      expectedVersion?: number;
    }
  ): Promise<Incident> {
    return request<Incident>(`/incidents/${id}`, {
      method: "PATCH",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify(data),
    });
  },

  async transitionIncident(
    id: string,
    data: {
      status: IncidentStatus;
      message?: string;
      expectedVersion?: number;
    }
  ): Promise<Incident> {
    return request<Incident>(`/incidents/${id}/transition`, {
      method: "POST",
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify(data),
    });
  },

  async getIncidentTimeline(id: string): Promise<{ data: IncidentTimelineEvent[] }> {
    return request<{ data: IncidentTimelineEvent[] }>(`/incidents/${id}/timeline`);
  },

  async addIncidentTimelineNote(
    id: string,
    message: string
  ): Promise<{ id: string; message: string; createdAt: string }> {
    return request<{ id: string; message: string; createdAt: string }>(
      `/incidents/${id}/timeline/notes`,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      }
    );
  },

  async addIncidentResponder(
    id: string,
    userId: string,
    role: IncidentResponderRole
  ): Promise<Incident> {
    return request<Incident>(`/incidents/${id}/responders`, {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    });
  },

  async removeIncidentResponder(id: string, userId: string): Promise<Incident> {
    return request<Incident>(`/incidents/${id}/responders/${userId}`, {
      method: "DELETE",
    });
  },

  async getIncidentLinkedItems(id: string): Promise<{ data: IncidentLinkedItem[] }> {
    return request<{ data: IncidentLinkedItem[] }>(`/incidents/${id}/items`);
  },

  async linkIncidentWorkItem(id: string, workItemId: string): Promise<Incident> {
    return request<Incident>(`/incidents/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ workItemId }),
    });
  },

  async unlinkIncidentWorkItem(id: string, itemId: string): Promise<Incident> {
    return request<Incident>(`/incidents/${id}/items/${itemId}`, {
      method: "DELETE",
    });
  },

  // SLA Engine & Policies
  async getSlaMetrics(teamId: string): Promise<{ data: SlaMetrics }> {
    return request<{ data: SlaMetrics }>(`/teams/${teamId}/sla/metrics`);
  },

  async listSlaPolicies(teamId: string): Promise<{ data: SlaPolicy[] }> {
    return request<{ data: SlaPolicy[] }>(`/teams/${teamId}/sla/policies`);
  },

  async createSlaPolicy(
    teamId: string,
    data: CreateSlaPolicyInput
  ): Promise<{ data: SlaPolicy }> {
    return request<{ data: SlaPolicy }>(`/teams/${teamId}/sla/policies`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateSlaPolicy(
    teamId: string,
    policyId: string,
    data: UpdateSlaPolicyInput
  ): Promise<{ data: SlaPolicy }> {
    return request<{ data: SlaPolicy }>(
      `/teams/${teamId}/sla/policies/${policyId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
  },

  async toggleSlaPolicyActive(
    teamId: string,
    policyId: string,
    isActive: boolean
  ): Promise<{ data: SlaPolicy }> {
    return request<{ data: SlaPolicy }>(
      `/teams/${teamId}/sla/policies/${policyId}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }
    );
  },

  async deleteSlaPolicy(
    teamId: string,
    policyId: string
  ): Promise<{ data: { success: boolean; message: string } }> {
    return request<{ data: { success: boolean; message: string } }>(
      `/teams/${teamId}/sla/policies/${policyId}`,
      {
        method: "DELETE",
      }
    );
  },

  // Feature 3: Queue Failure & Recovery Simulator
  async getQueueHealth(): Promise<{ data: QueueHealth }> {
    return request<{ data: QueueHealth }>("/queue/health");
  },

  async getFailedQueueJobs(limit = 25): Promise<{ data: QueueJob[] }> {
    return request<{ data: QueueJob[] }>(`/queue/jobs/failed?limit=${limit}`);
  },

  async getCompletedQueueJobs(limit = 25): Promise<{ data: QueueJob[] }> {
    return request<{ data: QueueJob[] }>(`/queue/jobs/completed?limit=${limit}`);
  },

  async simulateQueueFailure(
    data: TriggerDemoJobInput
  ): Promise<{ data: QueueJob }> {
    return request<{ data: QueueJob }>("/queue/simulate-failure", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async retryQueueJob(jobId: string): Promise<{ data: QueueJob }> {
    return request<{ data: QueueJob }>(`/queue/jobs/${jobId}/retry`, {
      method: "POST",
    });
  },

  async cleanCompletedQueueJobs(): Promise<{ data: { cleanedCount: number } }> {
    return request<{ data: { cleanedCount: number } }>("/queue/clean", {
      method: "POST",
    });
  },

  // Feature 4: Explainable Incident Intelligence
  async getTeamIncidentsIntelligence(
    teamId: string
  ): Promise<{ data: TeamIncidentsIntelligenceOverview }> {
    return request<{ data: TeamIncidentsIntelligenceOverview }>(
      `/incidents/intelligence?teamId=${teamId}`
    );
  },

  async getIncidentIntelligence(
    incidentId: string
  ): Promise<{ data: IncidentIntelligence }> {
    return request<{ data: IncidentIntelligence }>(
      `/incidents/${incidentId}/intelligence`
    );
  },

  // Feature 5: Dependency & Blast-Radius Map
  async getIncidentBlastRadius(
    incidentId: string
  ): Promise<{ data: BlastRadiusSummary }> {
    return request<{ data: BlastRadiusSummary }>(
      `/incidents/${incidentId}/blast-radius`
    );
  },
};
