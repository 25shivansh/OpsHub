"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  WorkItem,
  DashboardData,
  QueueHealth,
  SlaMetrics,
  Incident,
  TeamIncidentsIntelligenceOverview,
  ApiError,
} from "../lib/api";

// ─── Prop types ──────────────────────────────────────────────────────────────

interface OperationsOverviewProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  teamName: string;
  workItems: WorkItem[];
  dashboard: DashboardData | null;
  loading: boolean;
  dataError: string | null;
  onRefresh: () => void;
  onNavigate: (
    tab:
      | "overview"
      | "workbench"
      | "sla"
      | "incidents"
      | "queue"
      | "intelligence"
      | "blast-radius"
  ) => void;
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
}

// ─── Local state types ────────────────────────────────────────────────────────

type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

// ─── Small helpers ────────────────────────────────────────────────────────────

const ACTIVE_INCIDENT_STATUSES = new Set([
  "DECLARED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "MONITORING",
]);

function isActiveIncident(i: Incident) {
  return ACTIVE_INCIDENT_STATUSES.has(i.status);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SEV_COLOR: Record<string, string> = {
  SEV1: "bg-red-900/60 text-red-300 border-red-700/60",
  SEV2: "bg-orange-900/60 text-orange-300 border-orange-700/60",
  SEV3: "bg-amber-900/60 text-amber-300 border-amber-700/60",
  SEV4: "bg-yellow-900/60 text-yellow-300 border-yellow-700/60",
};

const STATUS_STYLES: Record<
  string,
  { dot: string; badge: string; bar: string }
> = {
  OPEN: {
    dot: "bg-slate-400",
    badge: "text-slate-300 bg-slate-800/60 border-slate-700/60",
    bar: "bg-slate-500",
  },
  IN_PROGRESS: {
    dot: "bg-blue-400",
    badge: "text-blue-300 bg-blue-900/40 border-blue-700/60",
    bar: "bg-blue-500",
  },
  AWAITING_APPROVAL: {
    dot: "bg-amber-400",
    badge: "text-amber-300 bg-amber-900/40 border-amber-700/60",
    bar: "bg-amber-500",
  },
  RESOLVED: {
    dot: "bg-emerald-400",
    badge: "text-emerald-300 bg-emerald-900/40 border-emerald-700/60",
    bar: "bg-emerald-500",
  },
  CLOSED: {
    dot: "bg-zinc-500",
    badge: "text-zinc-400 bg-zinc-800/60 border-zinc-700/60",
    bar: "bg-zinc-600",
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonBlock({
  h = "h-5",
  w = "w-full",
}: {
  h?: string;
  w?: string;
}) {
  return (
    <div
      className={`${h} ${w} animate-pulse rounded bg-zinc-800/80`}
      aria-hidden="true"
    />
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-5 py-3.5">
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-100">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon,
  accent,
  onClick,
  loading,
  error,
}: {
  label: string;
  value: number | string | null;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
  loading?: boolean;
  error?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`group flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 transition-colors ${
        onClick
          ? "cursor-pointer hover:border-zinc-700 hover:bg-zinc-800/60"
          : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${accent}`}
        >
          {icon}
        </span>
        {onClick && (
          <span className="text-[10px] text-zinc-600 transition-colors group-hover:text-zinc-400">
            →
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <SkeletonBlock h="h-7" w="w-16" />
          <SkeletonBlock h="h-3" w="w-24" />
        </div>
      ) : error ? (
        <div>
          <p className="text-xl font-bold text-zinc-600">—</p>
          <p className="mt-0.5 text-[11px] text-zinc-600">Unavailable</p>
        </div>
      ) : (
        <div>
          <p className="text-2xl font-bold tracking-tight text-white">
            {value ?? "—"}
          </p>
          {sub && (
            <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>
          )}
        </div>
      )}
      <p className="text-[11px] font-medium text-zinc-400">{label}</p>
    </Tag>
  );
}

function EmptyState({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="text-2xl text-zinc-600">{icon}</span>
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      {sub && <p className="text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OperationsOverview({
  currentUser,
  userRole,
  teamId,
  teamName,
  workItems,
  dashboard,
  loading,
  dataError,
  onRefresh,
  onNavigate,
}: OperationsOverviewProps) {
  // SLA metrics
  const [slaState, setSlaState] = useState<FetchState<SlaMetrics>>({
    status: "idle",
  });
  // Queue health
  const [queueState, setQueueState] = useState<FetchState<QueueHealth>>({
    status: "idle",
  });
  // Active incidents
  const [incidentState, setIncidentState] = useState<
    FetchState<Incident[]>
  >({ status: "idle" });
  // Intelligence overview (for risk counts)
  const [intelState, setIntelState] = useState<
    FetchState<TeamIncidentsIntelligenceOverview>
  >({ status: "idle" });

  const loadOverviewData = useCallback(async () => {
    if (!teamId) return;

    // SLA metrics
    setSlaState({ status: "loading" });
    api
      .getSlaMetrics(teamId)
      .then((r) => setSlaState({ status: "ok", data: r.data }))
      .catch((e) =>
        setSlaState({
          status: "error",
          message: e instanceof ApiError ? e.message : "Failed to load",
        })
      );

    // Queue health
    setQueueState({ status: "loading" });
    api
      .getQueueHealth()
      .then((r) => setQueueState({ status: "ok", data: r.data }))
      .catch((e) =>
        setQueueState({
          status: "error",
          message: e instanceof ApiError ? e.message : "Failed to load",
        })
      );

    // Active incidents
    setIncidentState({ status: "loading" });
    api
      .listIncidents({ teamId, limit: 20, sortBy: "declaredAt", sortOrder: "desc" })
      .then((r) =>
        setIncidentState({
          status: "ok",
          data: r.data.filter(isActiveIncident),
        })
      )
      .catch((e) =>
        setIncidentState({
          status: "error",
          message: e instanceof ApiError ? e.message : "Failed to load",
        })
      );

    // Intelligence overview
    setIntelState({ status: "loading" });
    api
      .getTeamIncidentsIntelligence(teamId)
      .then((r) => setIntelState({ status: "ok", data: r.data }))
      .catch((e) =>
        setIntelState({
          status: "error",
          message: e instanceof ApiError ? e.message : "Failed to load",
        })
      );
  }, [teamId]);

  useEffect(() => {
    loadOverviewData();
  }, [loadOverviewData]);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const activeIncidents =
    incidentState.status === "ok" ? incidentState.data : [];

  const slaAtRisk =
    slaState.status === "ok"
      ? slaState.data.atRiskCount + slaState.data.breachedCount
      : null;

  const queueFailed =
    queueState.status === "ok"
      ? queueState.data.counts.failed
      : null;

  const inProgress = dashboard?.metrics.byStatus.IN_PROGRESS ?? null;
  const awaitingApproval = dashboard?.metrics.awaitingApprovalCount ?? null;

  const statusOrder: Array<WorkItem["status"]> = [
    "OPEN",
    "IN_PROGRESS",
    "AWAITING_APPROVAL",
    "RESOLVED",
    "CLOSED",
  ];
  const totalItems = dashboard?.metrics.totalWorkItems ?? 0;
  const statusLabels: Record<string, string> = {
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    AWAITING_APPROVAL: "Awaiting Approval",
    RESOLVED: "Resolved",
    CLOSED: "Closed",
  };

  // Priority actions — built from real data only
  type PriorityAction = {
    key: string;
    category: string;
    title: string;
    badge: string;
    badgeStyle: string;
    sub: string;
    nav: () => void;
  };
  const priorityActions: PriorityAction[] = [];

  // High-severity active incidents
  if (incidentState.status === "ok") {
    for (const inc of activeIncidents) {
      if (inc.severity === "SEV1" || inc.severity === "SEV2") {
        priorityActions.push({
          key: `inc-${inc.id}`,
          category: "Incident",
          title: inc.title,
          badge: inc.severity,
          badgeStyle: SEV_COLOR[inc.severity] ?? "bg-zinc-800 text-zinc-300 border-zinc-700",
          sub: `${inc.status.replace(/_/g, " ")} · declared ${relativeTime(inc.declaredAt)}`,
          nav: () => onNavigate("incidents"),
        });
      }
    }
  }

  // Breached SLAs
  if (slaState.status === "ok" && slaState.data.breachedCount > 0) {
    priorityActions.push({
      key: "sla-breach",
      category: "SLA",
      title: `${slaState.data.breachedCount} SLA${slaState.data.breachedCount !== 1 ? "s" : ""} breached`,
      badge: "BREACHED",
      badgeStyle: "bg-red-900/60 text-red-300 border-red-700/60",
      sub: `${slaState.data.atRiskCount} more at risk`,
      nav: () => onNavigate("sla"),
    });
  } else if (slaState.status === "ok" && slaState.data.atRiskCount > 0) {
    priorityActions.push({
      key: "sla-risk",
      category: "SLA",
      title: `${slaState.data.atRiskCount} SLA target${slaState.data.atRiskCount !== 1 ? "s" : ""} at risk`,
      badge: "AT RISK",
      badgeStyle: "bg-amber-900/60 text-amber-300 border-amber-700/60",
      sub: "Review SLA engine for details",
      nav: () => onNavigate("sla"),
    });
  }

  // Awaiting approval items
  if ((awaitingApproval ?? 0) > 0) {
    priorityActions.push({
      key: "approval",
      category: "Work",
      title: `${awaitingApproval} item${awaitingApproval !== 1 ? "s" : ""} awaiting approval`,
      badge: "PENDING",
      badgeStyle: "bg-amber-900/60 text-amber-300 border-amber-700/60",
      sub: "Requires a Lead or Admin to approve",
      nav: () => onNavigate("workbench"),
    });
  }

  // Failed queue jobs
  if (queueState.status === "ok" && (queueState.data.counts.failed ?? 0) > 0) {
    priorityActions.push({
      key: "queue-fail",
      category: "Queue",
      title: `${queueState.data.counts.failed} failed job${queueState.data.counts.failed !== 1 ? "s" : ""} in queue`,
      badge: "FAILED",
      badgeStyle: "bg-rose-900/60 text-rose-300 border-rose-700/60",
      sub: "Open Queue Simulator to inspect and retry",
      nav: () => onNavigate("queue"),
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-indigo-400">
            {teamName} · {userRole}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Operations Overview
          </h1>
          <p className="mt-1 text-[13px] text-zinc-400">
            A unified view of operational health, active incidents, and work
            requiring attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse bg-indigo-400" : "bg-emerald-400"}`}
            />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Partial data warning */}
      {dataError && (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-[12px] text-amber-300"
        >
          <span>
            <strong>Warning:</strong> {dataError}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="font-semibold underline underline-offset-2 disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Key Metric Cards ── */}
      <section
        aria-label="Key operational metrics"
        className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <MetricCard
          label="Active Incidents"
          value={
            incidentState.status === "ok" ? activeIncidents.length : null
          }
          sub={
            incidentState.status === "ok"
              ? activeIncidents.length === 0
                ? "No active incidents"
                : `${activeIncidents.filter((i) => i.severity === "SEV1" || i.severity === "SEV2").length} high-severity`
              : undefined
          }
          icon="⚡"
          accent={
            incidentState.status === "ok" && activeIncidents.length > 0
              ? "bg-rose-900/50 text-rose-300"
              : "bg-zinc-800 text-zinc-400"
          }
          onClick={() => onNavigate("incidents")}
          loading={incidentState.status === "loading"}
          error={incidentState.status === "error"}
        />
        <MetricCard
          label="At-Risk SLA Targets"
          value={slaAtRisk}
          sub={
            slaState.status === "ok"
              ? `${slaState.data.breachedCount} breached, ${slaState.data.atRiskCount} at risk`
              : undefined
          }
          icon="🎯"
          accent={
            (slaAtRisk ?? 0) > 0
              ? "bg-amber-900/50 text-amber-300"
              : "bg-zinc-800 text-zinc-400"
          }
          onClick={() => onNavigate("sla")}
          loading={slaState.status === "loading"}
          error={slaState.status === "error"}
        />
        <MetricCard
          label="Work In Progress"
          value={inProgress}
          sub={
            dashboard
              ? `${awaitingApproval} awaiting approval`
              : undefined
          }
          icon="⚙️"
          accent={
            (inProgress ?? 0) > 0
              ? "bg-blue-900/50 text-blue-300"
              : "bg-zinc-800 text-zinc-400"
          }
          onClick={() => onNavigate("workbench")}
          loading={loading && !dashboard}
          error={!loading && !dashboard && !!dataError}
        />
        <MetricCard
          label="Failed Queue Jobs"
          value={
            queueState.status === "ok"
              ? queueFailed
              : queueState.status === "error"
              ? null
              : null
          }
          sub={
            queueState.status === "ok"
              ? `Queue: ${queueState.data.status}`
              : queueState.status === "error"
              ? "Queue unavailable"
              : undefined
          }
          icon="📦"
          accent={
            queueState.status === "ok" && (queueFailed ?? 0) > 0
              ? "bg-rose-900/50 text-rose-300"
              : queueState.status === "error"
              ? "bg-rose-900/30 text-rose-500"
              : "bg-zinc-800 text-zinc-400"
          }
          onClick={() => onNavigate("queue")}
          loading={queueState.status === "loading"}
          error={queueState.status === "error"}
        />
      </section>

      {/* ── Main grid ── */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
        {/* ── Incident Activity ── */}
        <SectionCard
          title="Active Incidents"
          subtitle={
            incidentState.status === "ok"
              ? `${activeIncidents.length} currently active`
              : undefined
          }
          action={
            <button
              onClick={() => onNavigate("incidents")}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Command Center →
            </button>
          }
        >
          {incidentState.status === "loading" && (
            <div className="space-y-px divide-y divide-zinc-800/60">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 px-5 py-3.5">
                  <SkeletonBlock h="h-5" w="w-12" />
                  <div className="flex-1 space-y-1.5">
                    <SkeletonBlock h="h-4" />
                    <SkeletonBlock h="h-3" w="w-40" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {incidentState.status === "error" && (
            <div className="flex items-center gap-2 px-5 py-4 text-[12px] text-rose-400">
              <span>⚠</span>
              <span>Could not load incidents: {incidentState.message}</span>
            </div>
          )}
          {incidentState.status === "ok" && activeIncidents.length === 0 && (
            <EmptyState
              icon="✓"
              title="No active incidents"
              sub="All incidents are resolved or closed"
            />
          )}
          {incidentState.status === "ok" && activeIncidents.length > 0 && (
            <div className="divide-y divide-zinc-800/60">
              {activeIncidents.slice(0, 6).map((inc) => (
                <button
                  key={inc.id}
                  onClick={() => onNavigate("incidents")}
                  className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-zinc-800/40"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${SEV_COLOR[inc.severity] ?? "bg-zinc-800 text-zinc-300 border-zinc-700"}`}
                  >
                    {inc.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-200">
                      {inc.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {inc.status.replace(/_/g, " ")} ·{" "}
                      {relativeTime(inc.declaredAt)}
                      {inc.responders && inc.responders.length > 0
                        ? ` · ${inc.responders.length} responder${inc.responders.length !== 1 ? "s" : ""}`
                        : " · No responders"}
                    </p>
                  </div>
                  <span className="text-[10px] text-zinc-600">→</span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── SLA Health ── */}
        <SectionCard
          title="SLA Health"
          subtitle={
            slaState.status === "ok"
              ? `${slaState.data.totalSlas} tracked · ${slaState.data.activePolicies} active policies`
              : undefined
          }
          action={
            <button
              onClick={() => onNavigate("sla")}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
            >
              SLA Engine →
            </button>
          }
        >
          {slaState.status === "loading" && (
            <div className="space-y-3 px-5 py-4">
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} h="h-5" />
              ))}
            </div>
          )}
          {slaState.status === "error" && (
            <div className="flex items-center gap-2 px-5 py-4 text-[12px] text-rose-400">
              <span>⚠</span>
              <span>Could not load SLA data: {slaState.message}</span>
            </div>
          )}
          {slaState.status === "ok" && (
            <div className="divide-y divide-zinc-800/60">
              {/* Compliance row */}
              {[
                {
                  label: "Response compliance",
                  rate: slaState.data.responseCompliance.rate,
                  eligible: slaState.data.responseCompliance.eligible,
                },
                {
                  label: "Resolution compliance",
                  rate: slaState.data.resolutionCompliance.rate,
                  eligible: slaState.data.resolutionCompliance.eligible,
                },
              ].map(({ label, rate, eligible }) => (
                <div key={label} className="px-5 py-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-zinc-400">{label}</p>
                    <p className="text-[12px] font-semibold text-zinc-200">
                      {eligible === 0
                        ? "—"
                        : rate !== null
                        ? `${rate.toFixed(0)}%`
                        : "—"}
                    </p>
                  </div>
                  {eligible > 0 && rate !== null && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          rate >= 90
                            ? "bg-emerald-500"
                            : rate >= 70
                            ? "bg-amber-500"
                            : "bg-rose-500"
                        }`}
                        style={{ width: `${Math.min(rate, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}

              {/* State breakdown */}
              <div className="grid grid-cols-3 divide-x divide-zinc-800/60 px-0">
                {[
                  {
                    label: "On Track",
                    count: slaState.data.onTrackCount,
                    color: "text-emerald-400",
                  },
                  {
                    label: "At Risk",
                    count: slaState.data.atRiskCount,
                    color: "text-amber-400",
                  },
                  {
                    label: "Breached",
                    count: slaState.data.breachedCount,
                    color: "text-rose-400",
                  },
                ].map(({ label, count, color }) => (
                  <div key={label} className="px-5 py-3.5 text-center">
                    <p className={`text-lg font-bold ${color}`}>{count}</p>
                    <p className="text-[10px] text-zinc-500">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Second row ── */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        {/* ── Work Item Status Breakdown ── */}
        <SectionCard
          title="Work Item Status"
          subtitle={
            dashboard ? `${totalItems} total items in team` : undefined
          }
          action={
            <button
              onClick={() => onNavigate("workbench")}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Work Management →
            </button>
          }
        >
          {loading && !dashboard && (
            <div className="space-y-3 px-5 py-4">
              {statusOrder.map((s) => (
                <SkeletonBlock key={s} h="h-6" />
              ))}
            </div>
          )}
          {!loading && !dashboard && (
            <EmptyState
              icon="📋"
              title="Work items unavailable"
              sub="Could not load team data"
            />
          )}
          {dashboard && (
            <div className="divide-y divide-zinc-800/60">
              {statusOrder.map((status) => {
                const count =
                  dashboard.metrics.byStatus[
                    status as keyof typeof dashboard.metrics.byStatus
                  ] ?? 0;
                const pct = totalItems > 0 ? (count / totalItems) * 100 : 0;
                const style = STATUS_STYLES[status];
                return (
                  <div key={status} className="flex items-center gap-3 px-5 py-3">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${style?.dot ?? "bg-zinc-500"}`}
                    />
                    <span className="w-36 shrink-0 text-[12px] text-zinc-400">
                      {statusLabels[status] ?? status}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-zinc-800 h-1.5">
                      <div
                        className={`h-full rounded-full ${style?.bar ?? "bg-zinc-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12px] font-semibold text-zinc-300">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Queue Health ── */}
        <SectionCard
          title="Queue Health"
          subtitle={
            queueState.status === "ok"
              ? queueState.data.queueName
              : undefined
          }
          action={
            <button
              onClick={() => onNavigate("queue")}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
            >
              Queue Simulator →
            </button>
          }
        >
          {queueState.status === "loading" && (
            <div className="space-y-3 px-5 py-4">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonBlock key={i} h="h-5" />
              ))}
            </div>
          )}
          {queueState.status === "error" && (
            <div className="px-5 py-5">
              <div className="flex items-center gap-2 rounded-lg border border-rose-800/50 bg-rose-950/30 px-4 py-3 text-[12px] text-rose-300">
                <span>⚠</span>
                <span>
                  Queue service could not be reached. This does not mean the
                  queue is healthy.
                </span>
              </div>
            </div>
          )}
          {queueState.status === "ok" && (
            <div>
              {/* Status badge */}
              <div className="flex items-center gap-3 border-b border-zinc-800/60 px-5 py-3.5">
                <span
                  className={`flex h-2.5 w-2.5 rounded-full ${
                    queueState.data.status === "HEALTHY"
                      ? "bg-emerald-400"
                      : queueState.data.status === "DEGRADED"
                      ? "bg-amber-400"
                      : "bg-rose-400"
                  }`}
                />
                <span className="text-[12px] font-semibold text-zinc-200">
                  {queueState.data.status}
                </span>
                {queueState.data.latencyMs !== null && (
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {queueState.data.latencyMs}ms latency
                  </span>
                )}
              </div>
              {/* Job counts */}
              <div className="grid grid-cols-3 divide-x divide-zinc-800/60">
                {[
                  {
                    label: "Waiting",
                    count: queueState.data.counts.waiting,
                    color: "text-blue-400",
                  },
                  {
                    label: "Active",
                    count: queueState.data.counts.active,
                    color: "text-indigo-400",
                  },
                  {
                    label: "Failed",
                    count: queueState.data.counts.failed,
                    color:
                      queueState.data.counts.failed > 0
                        ? "text-rose-400"
                        : "text-zinc-400",
                  },
                ].map(({ label, count, color }) => (
                  <div key={label} className="px-5 py-3.5 text-center">
                    <p className={`text-lg font-bold ${color}`}>{count}</p>
                    <p className="text-[10px] text-zinc-500">{label}</p>
                  </div>
                ))}
              </div>
              {/* Outbox stats */}
              <div className="border-t border-zinc-800/60 px-5 py-3.5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  Outbox
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    {
                      label: "Pending",
                      val: queueState.data.outboxDbStats.pending,
                    },
                    {
                      label: "Published",
                      val: queueState.data.outboxDbStats.published,
                    },
                    {
                      label: "Processed",
                      val: queueState.data.outboxDbStats.processed,
                    },
                    {
                      label: "Failed",
                      val: queueState.data.outboxDbStats.failed,
                      highlight: queueState.data.outboxDbStats.failed > 0,
                    },
                  ].map(({ label, val, highlight }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">{label}</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          highlight ? "text-rose-400" : "text-zinc-300"
                        }`}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Priority Actions ── */}
      <SectionCard
        className="mt-4"
        title="Needs Attention"
        subtitle="Items derived from live operational data that may require action"
      >
        {/* Still loading some data sources */}
        {(incidentState.status === "loading" ||
          slaState.status === "loading" ||
          (loading && !dashboard)) &&
          priorityActions.length === 0 && (
            <div className="space-y-px divide-y divide-zinc-800/60">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 px-5 py-3.5">
                  <SkeletonBlock h="h-5" w="w-16" />
                  <div className="flex-1 space-y-1.5">
                    <SkeletonBlock h="h-4" />
                    <SkeletonBlock h="h-3" w="w-48" />
                  </div>
                </div>
              ))}
            </div>
          )}

        {/* All loaded, nothing to do */}
        {incidentState.status !== "loading" &&
          slaState.status !== "loading" &&
          !loading &&
          priorityActions.length === 0 && (
            <EmptyState
              icon="✓"
              title="All clear"
              sub="No active incidents, SLA breaches, approval blockers, or queue failures detected."
            />
          )}

        {/* Actions list */}
        {priorityActions.length > 0 && (
          <div className="divide-y divide-zinc-800/60">
            {priorityActions.map((action) => (
              <button
                key={action.key}
                onClick={action.nav}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-zinc-800/40"
              >
                <span className="mt-0.5 text-[10px] font-semibold text-zinc-600 w-12 shrink-0">
                  {action.category}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-medium text-zinc-200">
                      {action.title}
                    </p>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${action.badgeStyle}`}
                    >
                      {action.badge}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {action.sub}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-zinc-600">→</span>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Recent Activity ── */}
      <SectionCard
        className="mt-4"
        title="Recent Activity"
        subtitle="Latest team events from the activity log"
      >
        {loading && !dashboard && (
          <div className="space-y-px divide-y divide-zinc-800/60">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="px-5 py-3.5 space-y-1.5">
                <SkeletonBlock h="h-4" w="w-3/4" />
                <SkeletonBlock h="h-3" w="w-40" />
              </div>
            ))}
          </div>
        )}
        {!loading &&
          dashboard &&
          dashboard.recentActivity.length === 0 && (
            <EmptyState
              icon="📋"
              title="No recent activity"
              sub="Team events will appear here as work progresses"
            />
          )}
        {dashboard && dashboard.recentActivity.length > 0 && (
          <div className="divide-y divide-zinc-800/60">
            {dashboard.recentActivity.slice(0, 8).map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <div>
                  <p className="text-[13px] text-zinc-300">
                    {ev.eventType.replace(/_/g, " ")}
                    {ev.itemTitle ? (
                      <span className="text-zinc-500"> · {ev.itemTitle}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-600">
                    {ev.actorName ?? "System"} ·{" "}
                    {relativeTime(ev.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
