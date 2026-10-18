"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  IncidentIntelligence,
  TeamIncidentsIntelligenceOverview,
  IncidentIntelligenceListItem,
  IntelligenceFinding,
  RecommendedActionItem,
} from "../lib/api";

interface IncidentIntelligenceDashboardProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
  onNavigateToIncidents?: () => void;
  onNavigateToSla?: () => void;
}

export function IncidentIntelligenceDashboard({
  currentUser,
  userRole,
  teamId,
  showToast,
  onNavigateToIncidents,
  onNavigateToSla,
}: IncidentIntelligenceDashboardProps) {
  // State
  const [overview, setOverview] = useState<TeamIncidentsIntelligenceOverview | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [incidentDetail, setIncidentDetail] = useState<IncidentIntelligence | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE">("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [findingCategoryFilter, setFindingCategoryFilter] = useState<string>("ALL");

  // Load team intelligence overview
  const loadOverview = useCallback(
    async (isManualRefresh = false) => {
      if (!teamId) return;
      if (isManualRefresh) setRefreshing(true);
      else setLoadingOverview(true);
      setError(null);

      try {
        const res = await api.getTeamIncidentsIntelligence(teamId);
        setOverview(res.data);

        // Auto-select the first incident if none selected or current is not in list
        if (res.data.incidents.length > 0) {
          const currentExists = res.data.incidents.some(
            (i) => i.incidentId === selectedIncidentId
          );
          if (!selectedIncidentId || !currentExists) {
            setSelectedIncidentId(res.data.incidents[0].incidentId);
          }
        } else {
          setSelectedIncidentId(null);
          setIncidentDetail(null);
        }

        if (isManualRefresh) {
          showToast("Incident intelligence refreshed", "success");
        }
      } catch (err: any) {
        console.error("Failed to load incident intelligence:", err);
        setError(err.message || "Failed to load incident intelligence");
        if (isManualRefresh) {
          showToast(err.message || "Refresh failed", "error");
        }
      } finally {
        setLoadingOverview(false);
        setRefreshing(false);
      }
    },
    [teamId, selectedIncidentId, showToast]
  );

  // Load individual incident detail when selected
  const loadIncidentDetail = useCallback(
    async (incidentId: string) => {
      setLoadingDetail(true);
      try {
        const res = await api.getIncidentIntelligence(incidentId);
        setIncidentDetail(res.data);
      } catch (err: any) {
        console.error("Failed to load incident detail:", err);
        showToast(err.message || "Failed to load incident details", "error");
      } finally {
        setLoadingDetail(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadOverview();
  }, [teamId]);

  useEffect(() => {
    if (selectedIncidentId) {
      loadIncidentDetail(selectedIncidentId);
    }
  }, [selectedIncidentId]);

  // Filtering incidents
  const filteredIncidents = (overview?.incidents || []).filter((item) => {
    if (riskFilter !== "ALL" && item.riskLevel !== riskFilter) return false;
    if (statusFilter === "ACTIVE" && ["RESOLVED", "POSTMORTEM", "CLOSED"].includes(item.status)) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSummary = item.riskSummary.toLowerCase().includes(q);
      const matchId = item.incidentId.toLowerCase().includes(q);
      if (!matchTitle && !matchSummary && !matchId) return false;
    }
    return true;
  });

  // Filter findings in detail
  const filteredFindings = (incidentDetail?.findings || []).filter((f) => {
    if (findingCategoryFilter !== "ALL" && f.category !== findingCategoryFilter) {
      return false;
    }
    return true;
  });

  // Helpers
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "CRITICAL":
        return "text-rose-400 bg-rose-950/40 border-rose-800/80";
      case "HIGH":
        return "text-orange-400 bg-orange-950/40 border-orange-800/80";
      case "MEDIUM":
        return "text-amber-400 bg-amber-950/40 border-amber-800/80";
      case "LOW":
        return "text-emerald-400 bg-emerald-950/40 border-emerald-800/80";
      default:
        return "text-zinc-400 bg-zinc-900 border-zinc-800";
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case "SEV1":
        return "bg-rose-950/80 text-rose-300 border-rose-700/80 font-bold";
      case "SEV2":
        return "bg-orange-950/80 text-orange-300 border-orange-700/80 font-bold";
      case "SEV3":
        return "bg-amber-950/80 text-amber-300 border-amber-700/80";
      case "SEV4":
        return "bg-zinc-900 text-zinc-300 border-zinc-700";
      default:
        return "bg-zinc-900 text-zinc-400 border-zinc-800";
    }
  };

  const getSlaBadge = (state: string) => {
    switch (state) {
      case "BREACHED":
        return "bg-rose-950/50 text-rose-300 border-rose-800";
      case "AT_RISK":
        return "bg-amber-950/50 text-amber-300 border-amber-800";
      case "ON_TRACK":
        return "bg-emerald-950/50 text-emerald-300 border-emerald-800";
      case "COMPLETED":
        return "bg-blue-950/50 text-blue-300 border-blue-800";
      case "NO_SLA":
      default:
        return "bg-zinc-900 text-zinc-500 border-zinc-800";
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "SEVERITY_IMPACT":
        return { label: "Severity & Impact", color: "text-rose-400 bg-rose-950/40 border-rose-800/60" };
      case "SLA_BREACH":
        return { label: "SLA Commitment", color: "text-amber-400 bg-amber-950/40 border-amber-800/60" };
      case "COMMAND_RESPONSE":
        return { label: "Command & Roster", color: "text-cyan-400 bg-cyan-950/40 border-cyan-800/60" };
      case "WORK_ITEMS":
        return { label: "Work Item Backlog", color: "text-indigo-400 bg-indigo-950/40 border-indigo-800/60" };
      case "ACTIVITY_STALENESS":
        return { label: "Activity Freshness", color: "text-orange-400 bg-orange-950/40 border-orange-800/60" };
      default:
        return { label: category, color: "text-zinc-400 bg-zinc-900 border-zinc-800" };
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "IMMEDIATE":
        return "bg-rose-900/60 text-rose-200 border-rose-700 font-bold";
      case "HIGH":
        return "bg-orange-900/60 text-orange-200 border-orange-700";
      case "MEDIUM":
        return "bg-amber-900/60 text-amber-200 border-amber-700";
      case "ROUTINE":
      default:
        return "bg-zinc-900 text-zinc-400 border-zinc-800";
    }
  };

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
      {/* 1. Header & Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-2 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-gradient-to-tr from-cyan-600/30 to-blue-600/30 border border-cyan-500/40 text-cyan-400 text-lg">
              🧠
            </span>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Explainable Incident Intelligence
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 font-semibold">
              DETERMINISTIC
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
            Rule-based, evidence-backed operations intelligence. Every finding links
            observed database records to explainable risk scores and recommended actions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-stretch md:self-auto">
          <button
            onClick={() => loadOverview(true)}
            disabled={refreshing || loadingOverview}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            title="Refresh intelligence data"
          >
            <span className={refreshing ? "animate-spin" : ""}>🔄</span>
            <span>{refreshing ? "Evaluating..." : "Refresh"}</span>
          </button>

          {onNavigateToIncidents && (
            <button
              onClick={onNavigateToIncidents}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/60 text-xs font-semibold text-rose-300 transition-colors cursor-pointer"
            >
              <span>🚨</span>
              <span>Command Center</span>
            </button>
          )}

          {onNavigateToSla && (
            <button
              onClick={onNavigateToSla}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/60 text-xs font-semibold text-amber-300 transition-colors cursor-pointer"
            >
              <span>⏱️</span>
              <span>SLA Policies</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. KPI Summary Ribbon */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
          <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
            Active Incidents
          </span>
          <span className="text-2xl font-black text-white">
            {overview ? overview.activeIncidents : "—"}
          </span>
          <span className="block text-[10px] text-zinc-500 mt-1">
            {overview ? `${overview.totalIncidents} total tracked` : "Loading..."}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-900/40">
          <span className="block text-[10px] font-semibold text-rose-400 uppercase tracking-wider mb-1">
            Critical Risk
          </span>
          <span className="text-2xl font-black text-rose-300">
            {overview ? overview.criticalRiskCount : "—"}
          </span>
          <span className="block text-[10px] text-rose-400/80 mt-1">
            Requires immediate focus
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-orange-950/20 border border-orange-900/40">
          <span className="block text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-1">
            High Risk
          </span>
          <span className="text-2xl font-black text-orange-300">
            {overview ? overview.highRiskCount : "—"}
          </span>
          <span className="block text-[10px] text-orange-400/80 mt-1">
            Elevated operational threat
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40">
          <span className="block text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1">
            SLA Breached
          </span>
          <span className="text-2xl font-black text-amber-300">
            {overview ? overview.slaBreachedCount : "—"}
          </span>
          <span className="block text-[10px] text-amber-400/80 mt-1">
            Linked items overdue
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-900/40">
          <span className="block text-[10px] font-semibold text-cyan-400 uppercase tracking-wider mb-1">
            Missing Commander
          </span>
          <span className="text-2xl font-black text-cyan-300">
            {overview ? overview.unassignedCommanderCount : "—"}
          </span>
          <span className="block text-[10px] text-cyan-400/80 mt-1">
            Needs owner assignment
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-900/40">
          <span className="block text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1">
            Stale (&gt;60m)
          </span>
          <span className="text-2xl font-black text-purple-300">
            {overview ? overview.staleIncidentsCount : "—"}
          </span>
          <span className="block text-[10px] text-purple-400/80 mt-1">
            Needs operator check-in
          </span>
        </div>
      </section>

      {/* 3. Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-zinc-500 pl-1 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search by title, risk reason, or incident ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-none text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-xs text-zinc-500 hover:text-zinc-300 pr-1 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Filter */}
          <div className="flex rounded-lg bg-zinc-950 border border-zinc-800 p-0.5 text-xs">
            <button
              onClick={() => setStatusFilter("ACTIVE")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                statusFilter === "ACTIVE"
                  ? "bg-zinc-800 text-white font-bold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Active Only
            </button>
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                statusFilter === "ALL"
                  ? "bg-zinc-800 text-white font-bold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All Incidents
            </button>
          </div>

          {/* Risk Level Filter */}
          <div className="flex items-center gap-1">
            {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((risk) => (
              <button
                key={risk}
                onClick={() => setRiskFilter(risk)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  riskFilter === risk
                    ? risk === "CRITICAL"
                      ? "bg-rose-950/80 text-rose-300 border-rose-700"
                      : risk === "HIGH"
                      ? "bg-orange-950/80 text-orange-300 border-orange-700"
                      : risk === "MEDIUM"
                      ? "bg-amber-950/80 text-amber-300 border-amber-700"
                      : risk === "LOW"
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-700"
                      : "bg-zinc-800 text-white border-zinc-700"
                    : "bg-zinc-950/60 text-zinc-400 border-zinc-800/80 hover:text-zinc-200"
                }`}
              >
                {risk}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadOverview(true)}
            className="px-2.5 py-1 rounded bg-rose-900/50 hover:bg-rose-800/60 font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* 5. Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Incidents Intelligence List */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 px-1">
            <span>Evaluated Incidents ({filteredIncidents.length})</span>
            <span className="text-[10px] text-zinc-500">Sorted by Rule Risk Score</span>
          </div>

          {loadingOverview ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/60 animate-pulse h-28"
                />
              ))}
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="p-8 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-center flex flex-col items-center gap-2">
              <span className="text-3xl">🛡️</span>
              <span className="text-sm font-semibold text-zinc-300">
                No incidents match criteria
              </span>
              <span className="text-xs text-zinc-500 max-w-sm">
                No incidents match the active filters or team scope. Declare an incident or
                adjust your filter criteria.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 max-h-[800px] overflow-y-auto pr-1">
              {filteredIncidents.map((item) => {
                const isSelected = item.incidentId === selectedIncidentId;
                const isItemResolved = ["RESOLVED", "POSTMORTEM", "CLOSED"].includes(
                  item.status
                );

                return (
                  <div
                    key={item.incidentId}
                    onClick={() => setSelectedIncidentId(item.incidentId)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-zinc-900 border-cyan-500/80 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/50"
                        : "bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-900/90 hover:border-zinc-700"
                    }`}
                  >
                    {/* Top Row: Severity, Risk Badge & Score */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border ${getSeverityBadge(
                            item.severity
                          )}`}
                        >
                          {item.severity}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                          {item.status}
                        </span>
                        {isItemResolved && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                            ✓ Resolved
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRiskColor(
                            item.riskLevel
                          )}`}
                        >
                          {item.riskLevel} RISK
                        </span>
                        <span className="text-xs font-mono font-bold text-zinc-200">
                          {item.riskScore}
                          <span className="text-[10px] text-zinc-500">/100</span>
                        </span>
                      </div>
                    </div>

                    {/* Incident Title */}
                    <h3 className="text-xs font-bold text-white mb-1.5 line-clamp-1">
                      {item.title}
                    </h3>

                    {/* Risk Summary Reason */}
                    <p className="text-[11px] text-zinc-400 line-clamp-2 mb-2.5">
                      {item.riskSummary}
                    </p>

                    {/* Metadata Footer */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-2 border-t border-zinc-800/60">
                      <div className="flex items-center gap-2">
                        <span>
                          {item.hasCommander ? (
                            <span className="text-zinc-300">
                              👤 {item.commanderName || "Commander assigned"}
                            </span>
                          ) : (
                            <span className="text-amber-400 font-semibold">
                              ⚠️ No Commander
                            </span>
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          {item.unresolvedItemsCount > 0 ? (
                            <span className="text-orange-300">
                              {item.unresolvedItemsCount} open tasks
                            </span>
                          ) : (
                            <span className="text-zinc-400">0 open tasks</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.2 rounded border text-[9px] ${getSlaBadge(
                            item.slaRiskState
                          )}`}
                        >
                          {item.slaRiskState}
                        </span>
                        <span className="font-mono text-[9px] bg-zinc-800 text-zinc-300 px-1 py-0.2 rounded">
                          {item.findingsCount} findings
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Detailed Incident Intelligence */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {loadingDetail ? (
            <div className="p-8 rounded-xl bg-zinc-900/60 border border-zinc-800 animate-pulse h-96 flex items-center justify-center text-zinc-500 text-xs">
              Evaluating intelligence parameters...
            </div>
          ) : !incidentDetail ? (
            <div className="p-12 rounded-xl bg-zinc-900/40 border border-zinc-800/80 text-center flex flex-col items-center justify-center gap-2">
              <span className="text-4xl">🔍</span>
              <span className="text-sm font-semibold text-zinc-300">
                Select an Incident
              </span>
              <span className="text-xs text-zinc-500 max-w-sm">
                Choose an incident from the list to view full explainable evidence, SLA status,
                contributing factors, and recommended next actions.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Card 1: Executive Risk Assessment & Score */}
              <div className="p-5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded border ${getSeverityBadge(
                          incidentDetail.severity
                        )}`}
                      >
                        {incidentDetail.severity}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800 font-mono">
                        {incidentDetail.impact.replace("_", " ")}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
                        {incidentDetail.status}
                      </span>
                      <span className="text-xs text-zinc-400 font-mono">
                        Age: {incidentDetail.ageFormatted}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white">
                      {incidentDetail.incidentTitle}
                    </h2>
                    <span className="text-[10px] font-mono text-zinc-500">
                      ID: {incidentDetail.incidentId}
                    </span>
                  </div>

                  {/* Risk Score Pill */}
                  <div className="flex flex-col items-end">
                    <span
                      className={`text-xs font-black px-3 py-1 rounded-full border ${getRiskColor(
                        incidentDetail.riskLevel
                      )}`}
                    >
                      {incidentDetail.riskLevel} RISK ({incidentDetail.riskScore}/100)
                    </span>
                    <span className="text-[9px] text-zinc-500 mt-1">
                      Deterministic Rule Score
                    </span>
                  </div>
                </div>

                {/* Score Progress Bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-300 mb-1.5">
                    <span>Computed Heuristic Risk Meter</span>
                    <span className="font-mono">{incidentDetail.riskScore} / 100</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-zinc-950 overflow-hidden border border-zinc-800">
                    <div
                      className={`h-full transition-all duration-500 ${
                        incidentDetail.riskScore >= 75
                          ? "bg-gradient-to-r from-rose-600 to-red-500"
                          : incidentDetail.riskScore >= 50
                          ? "bg-gradient-to-r from-orange-500 to-amber-500"
                          : incidentDetail.riskScore >= 25
                          ? "bg-gradient-to-r from-amber-400 to-yellow-400"
                          : "bg-gradient-to-r from-emerald-500 to-teal-400"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, incidentDetail.riskScore))}%` }}
                    />
                  </div>
                </div>

                {/* Heuristic Disclaimer Alert */}
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 text-[11px] text-zinc-400 flex items-start gap-2">
                  <span className="text-cyan-400 mt-0.5">ℹ️</span>
                  <div>
                    <span className="font-semibold text-zinc-200">
                      Explainable Rule-Based Assessment:{" "}
                    </span>
                    <span>{incidentDetail.riskSummary} </span>
                    <span className="text-zinc-500">
                      (This score is a deterministic calculation over observed schema fields,
                      not a statistical or AI prediction).
                    </span>
                  </div>
                </div>

                {/* Contributing Risk Factors */}
                {incidentDetail.riskFactors.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                      Contributing Risk Factors
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {incidentDetail.riskFactors.map((factor, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300 flex items-center gap-1.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                          <span>{factor}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: Recommended Next Actions */}
              <div className="p-5 rounded-xl bg-gradient-to-b from-zinc-900 to-zinc-900/80 border border-zinc-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">⚡</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Recommended Next Actions
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {incidentDetail.recommendedActions.length} prioritized tasks
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {incidentDetail.recommendedActions.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`text-[9px] font-mono px-2 py-0.5 rounded border mt-0.5 ${getPriorityBadge(
                            item.priority
                          )}`}
                        >
                          {item.priority}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-zinc-200">{item.action}</p>
                          <p className="text-[11px] text-zinc-400 mt-0.5">{item.rationale}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 3: 4-Part Explainable Findings */}
              <div className="p-5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400">🔍</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Explainable Findings &amp; Evidence ({filteredFindings.length})
                    </h3>
                  </div>

                  {/* Finding Category filter */}
                  <div className="flex items-center gap-1">
                    {["ALL", "SEVERITY_IMPACT", "SLA_BREACH", "COMMAND_RESPONSE", "WORK_ITEMS", "ACTIVITY_STALENESS"].map(
                      (cat) => (
                        <button
                          key={cat}
                          onClick={() => setFindingCategoryFilter(cat)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            findingCategoryFilter === cat
                              ? "bg-zinc-800 text-white border-zinc-600 font-semibold"
                              : "bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                          }`}
                        >
                          {cat === "ALL" ? "All" : cat.split("_")[0]}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {filteredFindings.map((f) => {
                    const catMeta = getCategoryLabel(f.category);
                    return (
                      <div
                        key={f.id}
                        className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col gap-2.5"
                      >
                        {/* Finding Header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${catMeta.color}`}
                            >
                              {catMeta.label}
                            </span>
                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${getRiskColor(
                                f.severity
                              )}`}
                            >
                              {f.severity}
                            </span>
                          </div>
                        </div>

                        {/* 1. The Finding */}
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-0.5">
                            1. Finding
                          </span>
                          <p className="text-xs font-semibold text-zinc-100">{f.finding}</p>
                        </div>

                        {/* 2. The Evidence Used */}
                        <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-cyan-400 mb-0.5">
                            2. Evidence Used
                          </span>
                          <p className="text-xs font-mono text-zinc-300">{f.evidence}</p>
                        </div>

                        {/* 3. Why It Matters */}
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-0.5">
                            3. Why It Matters
                          </span>
                          <p className="text-xs text-zinc-300">{f.whyItMatters}</p>
                        </div>

                        {/* 4. Practical Recommended Action */}
                        <div className="pt-2 border-t border-zinc-900 flex items-start gap-2">
                          <span className="text-emerald-400 text-xs mt-0.5">➔</span>
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-0.5">
                              4. Practical Recommended Action
                            </span>
                            <p className="text-xs font-medium text-emerald-200">
                              {f.recommendedAction}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 4: Multi-dimensional Operational State Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Column A: SLA Status */}
                <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      SLA Engine State
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${getSlaBadge(
                        incidentDetail.slaStatus.overallRiskState
                      )}`}
                    >
                      {incidentDetail.slaStatus.overallRiskState}
                    </span>
                  </div>

                  {incidentDetail.slaStatus.hasSla ? (
                    <div className="flex flex-col gap-1 text-xs mt-1">
                      <div className="flex justify-between text-zinc-300">
                        <span>Breached SLA items:</span>
                        <span className="font-mono font-bold text-rose-400">
                          {incidentDetail.slaStatus.breachedCount}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-300">
                        <span>At-risk SLA items:</span>
                        <span className="font-mono font-bold text-amber-400">
                          {incidentDetail.slaStatus.atRiskCount}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-300">
                        <span>Earliest deadline:</span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {incidentDetail.slaStatus.earliestDeadline
                            ? new Date(
                                incidentDetail.slaStatus.earliestDeadline
                              ).toLocaleTimeString()
                            : "None"}
                        </span>
                      </div>
                      {incidentDetail.slaStatus.isOverdue && (
                        <span className="text-[10px] font-semibold text-rose-400 mt-1">
                          ⚠️ Deadline overdue
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500 mt-2">
                      No linked SLA records active.
                    </div>
                  )}
                </div>

                {/* Column B: Command & Responders */}
                <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Command &amp; Roster
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
                      {incidentDetail.commandStatus.responderCount} Responders
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 text-xs mt-1">
                    <div className="flex justify-between text-zinc-300">
                      <span>Commander:</span>
                      <span className="font-medium text-zinc-200">
                        {incidentDetail.commandStatus.commanderName || (
                          <span className="text-rose-400 font-bold">Unassigned</span>
                        )}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 mt-1">
                      <span className="text-[10px] text-zinc-500">Active Roles:</span>
                      <div className="flex flex-wrap gap-1">
                        {incidentDetail.commandStatus.rolesPresent.length > 0 ? (
                          incidentDetail.commandStatus.rolesPresent.map((r, i) => (
                            <span
                              key={i}
                              className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-950 text-cyan-300 border border-zinc-800"
                            >
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-zinc-500">None assigned</span>
                        )}
                      </div>
                    </div>

                    {incidentDetail.commandStatus.missingKeyRoles.length > 0 && (
                      <div className="mt-1">
                        <span className="text-[10px] text-amber-400 font-semibold">
                          Missing Roles:
                        </span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {incidentDetail.commandStatus.missingKeyRoles.map((r, i) => (
                            <span
                              key={i}
                              className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/80"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Column C: Work Items & Freshness */}
                <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Remediation Items
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
                      {incidentDetail.linkedItemsSummary.total} Items
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 text-xs mt-1">
                    <div className="flex justify-between text-zinc-300">
                      <span>Unresolved tasks:</span>
                      <span className="font-mono font-bold text-orange-400">
                        {incidentDetail.linkedItemsSummary.unresolvedCount}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-400 text-[11px]">
                      <span>Open / In-Progress:</span>
                      <span className="font-mono">
                        {incidentDetail.linkedItemsSummary.open} /{" "}
                        {incidentDetail.linkedItemsSummary.inProgress}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-400 text-[11px]">
                      <span>Resolved / Closed:</span>
                      <span className="font-mono">
                        {incidentDetail.linkedItemsSummary.resolved} /{" "}
                        {incidentDetail.linkedItemsSummary.closed}
                      </span>
                    </div>

                    <div className="pt-1.5 border-t border-zinc-800/80 mt-1 flex justify-between items-center text-[10px]">
                      <span className="text-zinc-500">Last activity:</span>
                      <span
                        className={
                          incidentDetail.activityStatus.isStale
                            ? "text-orange-400 font-bold"
                            : "text-zinc-400 font-mono"
                        }
                      >
                        {incidentDetail.activityStatus.minutesSinceLastActivity}m ago
                        {incidentDetail.activityStatus.isStale && " (Stale)"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
