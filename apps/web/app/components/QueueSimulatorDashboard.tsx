"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  QueueHealth,
  QueueJob,
  QueueSimulationScenario,
} from "../lib/api";

interface QueueSimulatorDashboardProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
}

export function QueueSimulatorDashboard({
  currentUser,
  userRole,
  teamId,
  showToast,
}: QueueSimulatorDashboardProps) {
  // State
  const [health, setHealth] = useState<QueueHealth | null>(null);
  const [failedJobs, setFailedJobs] = useState<QueueJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<QueueJob | null>(null);
  const [activeTab, setActiveTab] = useState<"failed" | "completed">("failed");

  // Simulation form state
  const [scenario, setScenario] = useState<QueueSimulationScenario>(
    "TRANSIENT_TIMEOUT"
  );
  const [scenarioName, setScenarioName] = useState("");
  const [customError, setCustomError] = useState("");
  const [simulateRecovery, setSimulateRecovery] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(2);

  // Role permissions: LEAD and ADMIN have simulator write/replay access
  const canOperate = userRole === "LEAD" || userRole === "ADMIN";

  // Data loader
  const loadData = useCallback(
    async (isBackground = false) => {
      try {
        if (!isBackground) setLoading(true);
        else setRefreshing(true);

        const [healthRes, failedRes, completedRes] = await Promise.all([
          api.getQueueHealth().catch((err) => {
            console.warn("Queue health fetch error:", err);
            return {
              data: {
                isAvailable: false,
                status: "DISCONNECTED" as const,
                queueName: "newtonite-outbox-events",
                redisEndpoint: "redis://127.0.0.1:6379",
                latencyMs: null,
                counts: {
                  waiting: 0,
                  active: 0,
                  completed: 0,
                  failed: 0,
                  delayed: 0,
                  paused: 0,
                },
                outboxDbStats: {
                  pending: 0,
                  published: 0,
                  processed: 0,
                  failed: 0,
                },
                error: err.message || "Failed to reach queue service",
              },
            };
          }),
          api.getFailedQueueJobs(50).catch(() => ({ data: [] })),
          api.getCompletedQueueJobs(30).catch(() => ({ data: [] })),
        ]);

        setHealth(healthRes.data);
        setFailedJobs(failedRes.data);
        setCompletedJobs(completedRes.data);
      } catch (err: any) {
        console.error("Queue simulator load error:", err);
        showToast(err.message || "Failed to load queue data", "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle Trigger Failure Simulation
  const handleSimulateFailure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canOperate) {
      showToast("Simulation controls require LEAD or ADMIN role", "error");
      return;
    }

    try {
      setActionLoading(true);
      const res = await api.simulateQueueFailure({
        scenario,
        scenarioName: scenarioName.trim() || undefined,
        errorMessage: customError.trim() || undefined,
        simulateTransientRecovery: simulateRecovery,
        maxAttempts,
        teamId: teamId || undefined,
      });

      showToast(
        `Simulation job enqueued (ID: ${res.data.id}). Check failure table.`,
        "success"
      );

      // Refresh immediately and again after 1.5s to capture execution
      await loadData(true);
      setTimeout(() => loadData(true), 1500);
    } catch (err: any) {
      showToast(err.message || "Failed to trigger simulation", "error");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Retry / Replay
  const handleRetryJob = async (jobId: string) => {
    if (!canOperate) {
      showToast("Replay controls require LEAD or ADMIN role", "error");
      return;
    }

    try {
      setActionLoading(true);
      await api.retryQueueJob(jobId);
      showToast(`Job ${jobId} re-enqueued for recovery`, "success");
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
      await loadData(true);
      setTimeout(() => loadData(true), 1200);
    } catch (err: any) {
      showToast(err.message || "Failed to replay job", "error");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Clean
  const handleCleanCompleted = async () => {
    if (userRole !== "ADMIN") {
      showToast("Cleaning completed jobs requires ADMIN role", "error");
      return;
    }

    try {
      setActionLoading(true);
      const res = await api.cleanCompletedQueueJobs();
      showToast(`Cleaned ${res.data.cleanedCount} completed jobs`, "success");
      await loadData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to clean completed jobs", "error");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6 animate-fadeIn">
      {/* 1. HEADER & CONTROLS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Queue Failure & Recovery Simulator
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-indigo-950/80 border border-indigo-700/80 text-indigo-300">
              Feature 3
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time BullMQ & Outbox telemetry, controlled transient fault injection, and operator recovery console.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {refreshing && (
            <span className="text-xs text-zinc-500 font-mono animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              Syncing...
            </span>
          )}

          <button
            onClick={() => loadData(false)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <span>🔄</span> Refresh
          </button>

          {userRole === "ADMIN" && (
            <button
              onClick={handleCleanCompleted}
              disabled={actionLoading || !health?.isAvailable}
              className="px-3 py-1.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
              title="Clean completed demo jobs from queue"
            >
              🧹 Clean
            </button>
          )}
        </div>
      </div>

      {/* 2. REDIS DISCONNECTED WARNING BANNER (When Redis is offline) */}
      {health && !health.isAvailable && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-600/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg shadow-amber-950/10">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                <span>Redis Queue Unavailable</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-900/80 text-amber-300 border border-amber-700">
                  DISCONNECTED
                </span>
              </h3>
              <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
                The BullMQ worker requires a local Redis instance to process asynchronous queue jobs.
                Transactional outbox events in PostgreSQL remain fully operational via autonomous fallback.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-zinc-950/90 px-3 py-2 rounded-lg border border-amber-800/60">
            <span className="text-[11px] font-mono text-zinc-400">Start Redis:</span>
            <code className="text-xs font-mono font-bold text-amber-300 select-all">
              docker compose up -d
            </code>
          </div>
        </div>
      )}

      {/* 3. HEALTH & TELEMETRY KPI RIBBON */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Status card */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
            Queue Health
          </span>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                health?.isAvailable
                  ? health.status === "HEALTHY"
                    ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                    : "bg-amber-400 shadow-[0_0_8px_#fbbf24]"
                  : "bg-rose-500 shadow-[0_0_8px_#f43f5e]"
              }`}
            />
            <span
              className={`text-lg font-black tracking-tight ${
                health?.isAvailable
                  ? health.status === "HEALTHY"
                    ? "text-emerald-300"
                    : "text-amber-300"
                  : "text-rose-400"
              }`}
            >
              {health?.status || "CHECKING"}
            </span>
          </div>
          <span className="text-[10px] font-mono text-zinc-500 mt-1">
            {health?.latencyMs !== null && health?.latencyMs !== undefined
              ? `${health.latencyMs}ms latency`
              : "No connection"}
          </span>
        </div>

        {/* Failed Jobs count */}
        <div
          className={`p-3.5 rounded-xl border flex flex-col justify-between ${
            (health?.counts?.failed || 0) > 0
              ? "bg-rose-950/30 border-rose-800/70 shadow-lg shadow-rose-950/20"
              : "bg-zinc-900/60 border-zinc-800/80"
          }`}
        >
          <span className="text-[11px] font-medium text-rose-400 uppercase tracking-wider flex items-center justify-between">
            <span>Failed Jobs</span>
            {(health?.counts?.failed || 0) > 0 && <span>🚨</span>}
          </span>
          <span className="text-2xl font-black text-rose-300 mt-2">
            {health?.counts?.failed ?? 0}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 mt-1">
            Requires replay or auto-retry
          </span>
        </div>

        {/* Waiting Jobs */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
            Waiting in Queue
          </span>
          <span className="text-2xl font-black text-white mt-2">
            {health?.counts?.waiting ?? 0}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 mt-1">
            Ready for execution
          </span>
        </div>

        {/* Active Jobs */}
        <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-900/40 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-blue-400 uppercase tracking-wider">
            Active Processing
          </span>
          <span className="text-2xl font-black text-blue-300 mt-2">
            {health?.counts?.active ?? 0}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 mt-1">
            Under worker lock
          </span>
        </div>

        {/* Completed Jobs */}
        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider">
            Completed Jobs
          </span>
          <span className="text-2xl font-black text-emerald-300 mt-2">
            {health?.counts?.completed ?? 0}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 mt-1">
            Recovered & verified
          </span>
        </div>

        {/* Outbox DB Sync */}
        <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-900/40 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-purple-400 uppercase tracking-wider">
            Outbox DB Events
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-purple-300">
              {health?.outboxDbStats?.processed ?? 0}
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              / {(health?.outboxDbStats?.processed ?? 0) + (health?.outboxDbStats?.pending ?? 0) + (health?.outboxDbStats?.failed ?? 0)}
            </span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400 mt-1">
            {health?.outboxDbStats?.pending ?? 0} pending outbox
          </span>
        </div>
      </div>

      {/* 4. MAIN WORKSPACE: SIMULATOR CONTROLS + JOB INSPECTOR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: SIMULATOR ACTION PANEL */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧪</span>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Inject Failure Scenario
                </h2>
              </div>
              <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700">
                Safe Demo Job
              </span>
            </div>

            <form onSubmit={handleSimulateFailure} className="flex flex-col gap-4">
              {/* Scenario selector */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Failure Scenario:
                </label>
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      scenario === "TRANSIENT_TIMEOUT"
                        ? "bg-indigo-950/40 border-indigo-500/80 text-white"
                        : "bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value="TRANSIENT_TIMEOUT"
                      checked={scenario === "TRANSIENT_TIMEOUT"}
                      onChange={() => {
                        setScenario("TRANSIENT_TIMEOUT");
                        setSimulateRecovery(true);
                        setMaxAttempts(2);
                      }}
                      className="mt-0.5 text-indigo-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-indigo-300 block">
                        ⚡ Transient 504 Gateway Timeout
                      </span>
                      <span className="text-[11px] text-zinc-400 block mt-0.5">
                        Simulates downstream timeout on 1st attempt; auto-heals on BullMQ exponential backoff retry.
                      </span>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      scenario === "RATE_LIMIT_EXCEEDED"
                        ? "bg-amber-950/40 border-amber-500/80 text-white"
                        : "bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value="RATE_LIMIT_EXCEEDED"
                      checked={scenario === "RATE_LIMIT_EXCEEDED"}
                      onChange={() => {
                        setScenario("RATE_LIMIT_EXCEEDED");
                        setSimulateRecovery(false);
                        setMaxAttempts(1);
                      }}
                      className="mt-0.5 text-amber-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-amber-300 block">
                        🛑 429 Too Many Requests (Rate Limit)
                      </span>
                      <span className="text-[11px] text-zinc-400 block mt-0.5">
                        Downstream quota exceeded. Enters failed state and waits for manual operator replay.
                      </span>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      scenario === "DOWNSTREAM_500"
                        ? "bg-rose-950/40 border-rose-500/80 text-white"
                        : "bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value="DOWNSTREAM_500"
                      checked={scenario === "DOWNSTREAM_500"}
                      onChange={() => {
                        setScenario("DOWNSTREAM_500");
                        setSimulateRecovery(false);
                        setMaxAttempts(1);
                      }}
                      className="mt-0.5 text-rose-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-rose-300 block">
                        💥 500 Downstream Webhook Crash
                      </span>
                      <span className="text-[11px] text-zinc-400 block mt-0.5">
                        Dependency internal crash. Requires operator diagnosis and manual recovery dispatch.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Scenario Name / Label */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Custom Job Label (optional):
                </label>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="e.g. Stripe Webhook Timeout"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Custom Error Message */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Custom Error Message (optional):
                </label>
                <input
                  type="text"
                  value={customError}
                  onChange={(e) => setCustomError(e.target.value)}
                  placeholder="Defaults to standard HTTP fault code"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Safety notice */}
              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 text-[11px] text-zinc-400 leading-relaxed">
                🛡️ <strong className="text-zinc-200">Isolation Guarantee:</strong> Simulations are strictly tagged as demo jobs. Real user outbox tasks and production queue pipelines are never disrupted.
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={actionLoading || !health?.isAvailable || !canOperate}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white shadow-lg shadow-indigo-950/50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <span>Injecting Fault...</span>
                ) : !canOperate ? (
                  <span>🔒 Operator Controls (Requires LEAD/ADMIN)</span>
                ) : (
                  <span>⚡ Enqueue Simulated Failure</span>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: FAILED & COMPLETED JOBS INSPECTOR */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl flex flex-col gap-4 min-h-[460px]">
            {/* Tab navigation */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("failed")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === "failed"
                      ? "bg-rose-950/60 text-rose-300 border border-rose-800/80 shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>🚨</span> Failed Jobs ({failedJobs.length})
                </button>
                <button
                  onClick={() => setActiveTab("completed")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === "completed"
                      ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>✓</span> Completed / Recovered ({completedJobs.length})
                </button>
              </div>

              <span className="text-[11px] font-mono text-zinc-500">
                Auto-syncing every 6s
              </span>
            </div>

            {/* FAILED JOBS TAB */}
            {activeTab === "failed" && (
              <div className="space-y-3">
                {failedJobs.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl mb-2">🟢</span>
                    <h3 className="text-sm font-bold text-zinc-300">
                      No Failed Jobs in Dead-Letter Set
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                      All background jobs have completed or are progressing normally. Trigger a simulated failure on the left to test incident recovery.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[10px] tracking-wider font-semibold">
                          <th className="py-2.5 px-3">Job ID</th>
                          <th className="py-2.5 px-3">Scenario / Type</th>
                          <th className="py-2.5 px-3">Attempts</th>
                          <th className="py-2.5 px-3">Failure Reason</th>
                          <th className="py-2.5 px-3">Timestamp</th>
                          <th className="py-2.5 px-3 text-right">Recovery Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-mono">
                        {failedJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="hover:bg-zinc-800/40 transition-colors group"
                          >
                            <td className="py-3 px-3 text-zinc-300 font-bold">
                              #{job.id}
                            </td>
                            <td className="py-3 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-rose-950 text-rose-300 border border-rose-800">
                                {job.scenarioName || job.scenario}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-zinc-400">
                              <span className="text-rose-400 font-bold">
                                {job.attemptsMade}
                              </span>
                              /{job.maxAttempts}
                            </td>
                            <td className="py-3 px-3 max-w-xs">
                              <span
                                className="block text-zinc-300 text-[11px] font-sans truncate"
                                title={job.failedReason || "Unknown failure"}
                              >
                                {job.failedReason || "Downstream failure"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-zinc-500 text-[11px]">
                              {new Date(job.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </td>
                            <td className="py-3 px-3 text-right">
                              {job.isDemoJob ? (
                                <button
                                  onClick={() => handleRetryJob(job.id)}
                                  disabled={actionLoading || !canOperate}
                                  className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] font-sans transition-all cursor-pointer shadow disabled:opacity-50"
                                >
                                  ⚡ Replay
                                </button>
                              ) : (
                                <span
                                  className="text-[10px] text-zinc-500 italic"
                                  title="Real user jobs cannot be replayed from the demo simulator"
                                >
                                  User Job
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* COMPLETED JOBS TAB */}
            {activeTab === "completed" && (
              <div className="space-y-3">
                {completedJobs.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl mb-2">⏳</span>
                    <h3 className="text-sm font-bold text-zinc-300">
                      No Completed Jobs Cached
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                      Completed demo jobs will appear here upon successful worker execution or manual recovery replay.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[10px] tracking-wider font-semibold">
                          <th className="py-2.5 px-3">Job ID</th>
                          <th className="py-2.5 px-3">Scenario / Type</th>
                          <th className="py-2.5 px-3">State</th>
                          <th className="py-2.5 px-3">Attempts</th>
                          <th className="py-2.5 px-3">Outcome</th>
                          <th className="py-2.5 px-3 text-right">Completed At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-mono">
                        {completedJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="hover:bg-zinc-800/40 transition-colors"
                          >
                            <td className="py-3 px-3 text-zinc-300 font-bold">
                              #{job.id}
                            </td>
                            <td className="py-3 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
                                {job.scenarioName || job.scenario}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-emerald-400 font-bold text-[11px] flex items-center gap-1 font-sans">
                                <span>✓</span> Completed
                              </span>
                            </td>
                            <td className="py-3 px-3 text-zinc-400">
                              {job.attemptsMade}/{job.maxAttempts}
                            </td>
                            <td className="py-3 px-3 text-zinc-300 font-sans text-[11px]">
                              {job.recovered ? (
                                <span className="text-cyan-400 font-semibold">
                                  Operator Replay Healed
                                </span>
                              ) : job.attemptsMade > 1 ? (
                                <span className="text-amber-300">
                                  Transient Self-Healed on Retry
                                </span>
                              ) : (
                                <span className="text-emerald-400">
                                  Processed Cleanly
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right text-zinc-500 text-[11px]">
                              {job.finishedOn
                                ? new Date(job.finishedOn).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })
                                : "Just now"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
