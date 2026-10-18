"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  api,
  User,
  Incident,
  BlastRadiusSummary,
  BlastRadiusNode,
  BlastRadiusEdge,
  IncidentSeverity,
} from "../lib/api";

interface DependencyBlastRadiusMapProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
  onNavigateToIncidents?: () => void;
}

export function DependencyBlastRadiusMap({
  currentUser,
  userRole,
  teamId,
  showToast,
  onNavigateToIncidents,
}: DependencyBlastRadiusMapProps) {
  // Incident selection & list state
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [loadingIncidents, setLoadingIncidents] = useState(true);

  // Blast radius graph data
  const [blastRadius, setBlastRadius] = useState<BlastRadiusSummary | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inspector & View controls
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "table">("graph");
  const [filterPriority, setFilterPriority] = useState<string>("ALL");
  const [filterSla, setFilterSla] = useState<string>("ALL");
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // 1. Fetch available incidents for team
  const loadIncidents = useCallback(
    async (selectIncidentId?: string) => {
      if (!teamId) return;
      setLoadingIncidents(true);
      setError(null);
      try {
        const res = await api.listIncidents({
          teamId,
          limit: 50,
          sortBy: "declaredAt",
          sortOrder: "desc",
        });
        const list = res.data || [];
        setIncidents(list);

        if (list.length > 0) {
          if (selectIncidentId && list.some((i) => i.id === selectIncidentId)) {
            setSelectedIncidentId(selectIncidentId);
          } else if (!selectedIncidentId || !list.some((i) => i.id === selectedIncidentId)) {
            setSelectedIncidentId(list[0].id);
          }
        } else {
          setSelectedIncidentId(null);
          setBlastRadius(null);
        }
      } catch (err: any) {
        console.error("Failed to load incidents for blast radius:", err);
        setError(err.message || "Failed to load incidents");
        showToast(err.message || "Could not fetch incidents", "error");
      } finally {
        setLoadingIncidents(false);
      }
    },
    [teamId, selectedIncidentId, showToast]
  );

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  // 2. Fetch blast radius data for selected incident
  const loadBlastRadius = useCallback(
    async (incidentId: string, isManual = false) => {
      if (!incidentId) return;
      if (isManual) setRefreshing(true);
      else setLoadingGraph(true);
      setError(null);

      try {
        const res = await api.getIncidentBlastRadius(incidentId);
        setBlastRadius(res.data);
        // By default, select root node if nothing selected
        setSelectedNodeId(res.data.incidentId);

        if (isManual) {
          showToast("Blast radius data refreshed", "success");
        }
      } catch (err: any) {
        console.error("Failed to load blast radius:", err);
        setError(err.message || "Failed to load blast radius map");
        showToast(err.message || "Failed to load blast radius map", "error");
      } finally {
        setLoadingGraph(false);
        setRefreshing(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (selectedIncidentId) {
      loadBlastRadius(selectedIncidentId);
    }
  }, [selectedIncidentId, loadBlastRadius]);

  // Selected node object
  const selectedNode = useMemo(() => {
    if (!blastRadius || !selectedNodeId) return null;
    return blastRadius.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [blastRadius, selectedNodeId]);

  // Filtered linked work items (for table view or filtering highlights)
  const workItemNodes = useMemo(() => {
    if (!blastRadius) return [];
    return blastRadius.nodes.filter((n) => n.type === "LINKED_WORK_ITEM");
  }, [blastRadius]);

  const filteredWorkItems = useMemo(() => {
    return workItemNodes.filter((item) => {
      if (filterPriority !== "ALL" && item.priority !== filterPriority) return false;
      if (filterSla !== "ALL") {
        if (filterSla === "BREACHED" && item.sla?.riskState !== "BREACHED" && !item.sla?.isOverdue)
          return false;
        if (filterSla === "AT_RISK" && item.sla?.riskState !== "AT_RISK") return false;
        if (filterSla === "ON_TRACK" && item.sla?.riskState !== "ON_TRACK") return false;
      }
      return true;
    });
  }, [workItemNodes, filterPriority, filterSla]);

  // Helper styling for severity
  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case "SEV1":
        return "bg-rose-950/80 text-rose-300 border-rose-700/80 shadow-rose-950/50";
      case "SEV2":
        return "bg-orange-950/80 text-orange-300 border-orange-700/80 shadow-orange-950/50";
      case "SEV3":
        return "bg-amber-950/80 text-amber-300 border-amber-700/80";
      default:
        return "bg-zinc-800 text-zinc-300 border-zinc-700";
    }
  };

  // Helper styling for blast radius risk level
  const getBlastLevelBadge = (level: string) => {
    switch (level) {
      case "CRITICAL":
        return {
          bg: "bg-red-950/70 border-red-600/80 text-red-200",
          glow: "shadow-[0_0_20px_rgba(239,68,68,0.25)]",
          dot: "bg-red-500",
          label: "CRITICAL IMPACT",
        };
      case "HIGH":
        return {
          bg: "bg-orange-950/70 border-orange-600/80 text-orange-200",
          glow: "shadow-[0_0_20px_rgba(249,115,22,0.25)]",
          dot: "bg-orange-500",
          label: "HIGH IMPACT",
        };
      case "ELEVATED":
        return {
          bg: "bg-amber-950/70 border-amber-600/80 text-amber-200",
          glow: "shadow-[0_0_15px_rgba(245,158,11,0.2)]",
          dot: "bg-amber-400",
          label: "ELEVATED IMPACT",
        };
      case "CONTAINED":
        return {
          bg: "bg-emerald-950/70 border-emerald-600/80 text-emerald-200",
          glow: "shadow-[0_0_15px_rgba(16,185,129,0.2)]",
          dot: "bg-emerald-400",
          label: "CONTAINED",
        };
      default:
        return {
          bg: "bg-zinc-900 border-zinc-700 text-zinc-300",
          glow: "",
          dot: "bg-zinc-400",
          label: "MINIMAL / UNMAPPED",
        };
    }
  };

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case "URGENT":
        return "bg-red-950/90 text-red-300 border-red-700";
      case "HIGH":
        return "bg-orange-950/90 text-orange-300 border-orange-700";
      case "NORMAL":
        return "bg-blue-950/80 text-blue-300 border-blue-800";
      default:
        return "bg-zinc-800 text-zinc-400 border-zinc-700";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "RESOLVED":
      case "CLOSED":
        return "bg-emerald-950/80 text-emerald-300 border-emerald-800";
      case "IN_PROGRESS":
      case "MITIGATING":
        return "bg-blue-950/80 text-blue-300 border-blue-800";
      case "AWAITING_APPROVAL":
      case "INVESTIGATING":
        return "bg-amber-950/80 text-amber-300 border-amber-800";
      default:
        return "bg-zinc-800 text-zinc-300 border-zinc-700";
    }
  };

  const getSlaBadge = (sla?: BlastRadiusNode["sla"]) => {
    if (!sla || sla.riskState === "NO_SLA") {
      return { text: "NO SLA", cls: "bg-zinc-800/80 text-zinc-400 border-zinc-700" };
    }
    if (sla.riskState === "BREACHED" || sla.isOverdue) {
      return { text: "BREACHED", cls: "bg-rose-950 text-rose-300 border-rose-600 animate-pulse" };
    }
    if (sla.riskState === "AT_RISK") {
      return { text: "AT RISK", cls: "bg-amber-950 text-amber-300 border-amber-600" };
    }
    if (sla.riskState === "COMPLETED") {
      return { text: "MET", cls: "bg-teal-950 text-teal-300 border-teal-700" };
    }
    return { text: "ON TRACK", cls: "bg-emerald-950 text-emerald-300 border-emerald-700" };
  };

  // Node coordinate calculation for the SVG canvas
  // Center: (width / 2, height / 2 or 160)
  // Work items arranged radially or in horizontal tiers around root
  const graphDimensions = useMemo(() => {
    const itemCount = workItemNodes.length;
    if (itemCount <= 3) return { width: 900, height: 520 };
    if (itemCount <= 8) return { width: 1040, height: 640 };
    return { width: 1200, height: 760 };
  }, [workItemNodes.length]);

  const nodePositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
    if (!blastRadius) return positions;

    const centerX = graphDimensions.width / 2;
    const rootNode = blastRadius.nodes.find((n) => n.type === "INCIDENT_ROOT");

    if (rootNode) {
      positions[rootNode.id] = {
        x: centerX,
        y: 120,
        w: 240,
        h: 110,
      };
    }

    const items = blastRadius.nodes.filter((n) => n.type === "LINKED_WORK_ITEM");
    const count = items.length;

    if (count > 0) {
      if (count <= 4) {
        // Simple row beneath root
        const startX = centerX - ((count - 1) * 230) / 2;
        items.forEach((item, index) => {
          positions[item.id] = {
            x: startX + index * 230,
            y: 350,
            w: 200,
            h: 115,
          };
        });
      } else if (count <= 8) {
        // Radial / Fan distribution
        const radiusX = 380;
        const radiusY = 220;
        const rootY = 140;
        items.forEach((item, index) => {
          // Semi-circle spread from 15 deg to 165 deg downward
          const angleDeg = 15 + (index / (count - 1)) * 150;
          const angleRad = (angleDeg * Math.PI) / 180;
          positions[item.id] = {
            x: centerX - radiusX * Math.cos(angleRad),
            y: rootY + radiusY * Math.sin(angleRad) + 80,
            w: 200,
            h: 115,
          };
        });
      } else {
        // Multi-tier grid layout
        const perTier = Math.ceil(count / 2);
        items.forEach((item, index) => {
          const tier = index < perTier ? 1 : 2;
          const tierIndex = index < perTier ? index : index - perTier;
          const tierCount = tier === 1 ? perTier : count - perTier;
          const tierStartX = centerX - ((tierCount - 1) * 220) / 2;
          positions[item.id] = {
            x: tierStartX + tierIndex * 220,
            y: tier === 1 ? 290 : 470,
            w: 195,
            h: 110,
          };
        });
      }
    }

    return positions;
  }, [blastRadius, graphDimensions]);

  // Edges with coordinates
  const renderedEdges = useMemo(() => {
    if (!blastRadius) return [];
    return blastRadius.edges.map((edge) => {
      const src = nodePositions[edge.source];
      const tgt = nodePositions[edge.target];
      return {
        ...edge,
        src,
        tgt,
      };
    });
  }, [blastRadius, nodePositions]);

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-5">
      {/* 1. TOP HEADER & INCIDENT SELECTOR */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/20 to-cyan-500/20 border border-emerald-500/40 flex items-center justify-center text-xl shadow-inner">
            🌐
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-tight">
                Dependency & Blast-Radius Map
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-md bg-emerald-950 text-emerald-300 border border-emerald-700/60 font-semibold">
                Verified DB Links Only
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Live operational impact topology mapped strictly from active database linkages (<code className="text-emerald-400 font-mono text-[11px]">incident_linked_items</code>).
            </p>
          </div>
        </div>

        {/* Incident Selector & Refresh */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="incident-select" className="text-xs font-semibold text-zinc-400">
              Active Incident:
            </label>
            <select
              id="incident-select"
              value={selectedIncidentId || ""}
              onChange={(e) => setSelectedIncidentId(e.target.value)}
              disabled={loadingIncidents || incidents.length === 0}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 font-medium focus:outline-hidden focus:border-emerald-500 max-w-xs truncate cursor-pointer disabled:opacity-50"
            >
              {incidents.length === 0 ? (
                <option value="">No incidents found</option>
              ) : (
                incidents.map((inc) => (
                  <option key={inc.id} value={inc.id}>
                    [{inc.severity}] {inc.title} ({inc.status})
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={() => selectedIncidentId && loadBlastRadius(selectedIncidentId, true)}
            disabled={refreshing || loadingGraph || !selectedIncidentId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh blast radius map"
          >
            <span className={refreshing ? "animate-spin" : ""}>🔄</span>
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </header>

      {/* ERROR STATE */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-700/80 text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-bold text-sm">Failed to evaluate blast radius</p>
              <p className="text-xs text-red-300/80 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={() => selectedIncidentId && loadBlastRadius(selectedIncidentId, true)}
            className="px-3 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs font-semibold text-white border border-red-600 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* LOADING STATE */}
      {loadingGraph && !blastRadius && (
        <div className="p-12 rounded-2xl bg-zinc-900/40 border border-zinc-800 flex flex-col items-center justify-center gap-3 text-center">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-zinc-300">
            Constructing database dependency graph & blast radius...
          </p>
          <p className="text-xs text-zinc-500 max-w-sm">
            Evaluating linked work items, SLA deadlines, assigned engineers, and operational risks.
          </p>
        </div>
      )}

      {/* LOADED STATE */}
      {blastRadius && (
        <>
          {/* 2. SUMMARY METRIC CARDS (4 CARDS) */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {/* Direct Linked Items */}
            <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 hover:border-zinc-700 transition-all shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Direct Mitigation Items
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  DB Link
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-white">
                  {blastRadius.totalDirectlyLinkedItems}
                </span>
                <span className="text-xs text-zinc-400">linked items</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Via <code className="text-zinc-400 font-mono">incident_linked_items</code>
              </p>
            </div>

            {/* Unresolved Work */}
            <div
              className={`p-4 rounded-xl border transition-all shadow-sm ${
                blastRadius.unresolvedCount > 0
                  ? "bg-amber-950/20 border-amber-800/50"
                  : "bg-zinc-900/70 border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Unresolved Work
                </span>
                {blastRadius.unresolvedCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-amber-300">
                  {blastRadius.unresolvedCount}
                </span>
                <span className="text-xs text-zinc-400">
                  / {blastRadius.totalDirectlyLinkedItems} items
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                {blastRadius.resolvedCount} completed ({blastRadius.totalDirectlyLinkedItems > 0 ? Math.round((blastRadius.resolvedCount / blastRadius.totalDirectlyLinkedItems) * 100) : 0}% resolved)
              </p>
            </div>

            {/* Urgent / High Priority */}
            <div
              className={`p-4 rounded-xl border transition-all shadow-sm ${
                blastRadius.urgentOrHighCount > 0
                  ? "bg-orange-950/20 border-orange-800/50"
                  : "bg-zinc-900/70 border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">
                  High & Urgent Priority
                </span>
                {blastRadius.urgentOrHighCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-orange-900/80 text-orange-200">
                    ATTN
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-orange-300">
                  {blastRadius.urgentOrHighCount}
                </span>
                <span className="text-xs text-zinc-400">urgent items</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                High operational severity
              </p>
            </div>

            {/* SLA Breaches & Risks */}
            <div
              className={`p-4 rounded-xl border transition-all shadow-sm ${
                blastRadius.breachedSlaCount > 0
                  ? "bg-rose-950/30 border-rose-700/70"
                  : blastRadius.atRiskSlaCount > 0
                  ? "bg-amber-950/30 border-amber-700/60"
                  : "bg-zinc-900/70 border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
                  SLA Commitments
                </span>
                {blastRadius.breachedSlaCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-900/90 text-rose-200 animate-pulse">
                    BREACHED
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-black ${
                    blastRadius.breachedSlaCount > 0 ? "text-rose-400" : "text-emerald-400"
                  }`}
                >
                  {blastRadius.breachedSlaCount}
                </span>
                <span className="text-xs text-zinc-400">breaches</span>
                {blastRadius.atRiskSlaCount > 0 && (
                  <span className="text-xs text-amber-400 font-semibold ml-auto">
                    +{blastRadius.atRiskSlaCount} at risk
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                Target resolution deadlines
              </p>
            </div>
          </section>

          {/* 3. BLAST-RADIUS IMPACT ASSESSMENT BANNER */}
          {(() => {
            const badge = getBlastLevelBadge(blastRadius.blastRadiusLevel);
            return (
              <div
                className={`p-4 rounded-xl border ${badge.bg} ${badge.glow} flex flex-col md:flex-row md:items-center justify-between gap-3`}
              >
                <div className="flex items-start md:items-center gap-3">
                  <span className={`w-3 h-3 rounded-full ${badge.dot} animate-pulse mt-1 md:mt-0`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black tracking-wider uppercase">
                        Blast Radius Assessment: {badge.label}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 text-zinc-300 leading-relaxed font-medium">
                      {blastRadius.impactSummary}
                    </p>
                  </div>
                </div>

                {/* Risk Highlights pills */}
                {blastRadius.riskHighlights.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
                    {blastRadius.riskHighlights.map((hl, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-black/40 border border-white/10 text-zinc-200"
                      >
                        {hl}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 4. MAIN WORKSPACE: GRAPH / TABLE VIEW + INSPECTOR */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* GRAPH / TABLE VIEW CANVAS (8 COLS) */}
            <div className="lg:col-span-8 flex flex-col rounded-2xl bg-zinc-900/60 border border-zinc-800 overflow-hidden shadow-lg">
              {/* Canvas Toolbar */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-950/80 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 text-xs">
                    <button
                      onClick={() => setViewMode("graph")}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                        viewMode === "graph"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      🗺️ Graph Canvas
                    </button>
                    <button
                      onClick={() => setViewMode("table")}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                        viewMode === "table"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      📋 Table View ({workItemNodes.length})
                    </button>
                  </div>

                  {/* Zoom controls for graph */}
                  {viewMode === "graph" && (
                    <div className="hidden sm:flex items-center gap-1 pl-2 border-l border-zinc-800 text-xs text-zinc-400">
                      <button
                        onClick={() => setZoomLevel((z) => Math.max(0.7, z - 0.1))}
                        className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 cursor-pointer"
                        title="Zoom Out"
                      >
                        -
                      </button>
                      <span className="font-mono text-[11px] px-1">
                        {Math.round(zoomLevel * 100)}%
                      </span>
                      <button
                        onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.1))}
                        className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 cursor-pointer"
                        title="Zoom In"
                      >
                        +
                      </button>
                      <button
                        onClick={() => setZoomLevel(1)}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 cursor-pointer text-zinc-400"
                        title="Reset Zoom"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>

                {/* Filter controls */}
                <div className="flex items-center gap-2">
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                    className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 font-medium cursor-pointer"
                  >
                    <option value="ALL">All Priorities</option>
                    <option value="URGENT">Urgent Only</option>
                    <option value="HIGH">High Only</option>
                    <option value="NORMAL">Normal</option>
                    <option value="LOW">Low</option>
                  </select>

                  <select
                    value={filterSla}
                    onChange={(e) => setFilterSla(e.target.value)}
                    className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 font-medium cursor-pointer"
                  >
                    <option value="ALL">All SLA States</option>
                    <option value="BREACHED">Breached / Overdue</option>
                    <option value="AT_RISK">At Risk</option>
                    <option value="ON_TRACK">On Track</option>
                  </select>
                </div>
              </div>

              {/* GRAPH CANVAS VIEW */}
              {viewMode === "graph" ? (
                <div className="relative w-full overflow-auto bg-zinc-950/60 p-4 min-h-[480px] flex items-center justify-center select-none">
                  {/* Subtle Grid Background */}
                  <div
                    className="absolute inset-0 pointer-events-none opacity-20"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle, #38bdf8 1px, transparent 1px)",
                      backgroundSize: "24px 24px",
                    }}
                  />

                  {blastRadius.totalDirectlyLinkedItems === 0 ? (
                    <div className="z-10 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
                      <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-3xl mb-3 shadow-inner">
                        🛡️
                      </div>
                      <h3 className="text-base font-bold text-zinc-200">
                        Zero Linked Mitigation Items
                      </h3>
                      <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                        This incident has no work items linked via{" "}
                        <code className="text-emerald-400 font-mono text-[11px]">incident_linked_items</code>.
                        In accordance with Newtonite principles, no speculative or fake dependencies are shown.
                      </p>
                      {onNavigateToIncidents && (
                        <button
                          onClick={onNavigateToIncidents}
                          className="mt-4 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md transition-colors cursor-pointer"
                        >
                          Open Incident Command to Link Work Items
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      className="relative transition-transform duration-150 origin-center"
                      style={{
                        width: graphDimensions.width,
                        height: graphDimensions.height,
                        transform: `scale(${zoomLevel})`,
                      }}
                    >
                      {/* SVG Canvas for Edges */}
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        style={{ overflow: "visible" }}
                      >
                        <defs>
                          <marker
                            id="arrowhead-direct"
                            markerWidth="8"
                            markerHeight="6"
                            refX="7"
                            refY="3"
                            orient="auto"
                          >
                            <polygon points="0 0, 8 3, 0 6" fill="#0284c7" />
                          </marker>
                          <marker
                            id="arrowhead-breached"
                            markerWidth="8"
                            markerHeight="6"
                            refX="7"
                            refY="3"
                            orient="auto"
                          >
                            <polygon points="0 0, 8 3, 0 6" fill="#e11d48" />
                          </marker>
                        </defs>

                        {/* Render Edges */}
                        {renderedEdges.map((edge) => {
                          if (!edge.src || !edge.tgt) return null;
                          const isDirect = edge.relationshipType === "DIRECT_LINK";
                          const isShared = edge.relationshipType === "SHARED_ASSIGNEE";

                          // Calculate control points for smooth cubic bezier curves
                          const x1 = edge.src.x;
                          const y1 = edge.src.y + edge.src.h / 2;
                          const x2 = edge.tgt.x;
                          const y2 = edge.tgt.y - edge.tgt.h / 2;

                          let pathD = "";
                          if (isDirect) {
                            const deltaY = y2 - y1;
                            const cy1 = y1 + deltaY * 0.45;
                            const cy2 = y1 + deltaY * 0.55;
                            pathD = `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
                          } else {
                            // Curved arc for shared assignee
                            const mx = (x1 + x2) / 2;
                            const my = Math.min(y1, y2) - 40;
                            pathD = `M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`;
                          }

                          return (
                            <g key={edge.id} className="transition-opacity duration-200">
                              <path
                                d={pathD}
                                fill="none"
                                stroke={
                                  isDirect
                                    ? "#0284c7"
                                    : "#a855f7"
                                }
                                strokeWidth={isDirect ? "2" : "1.75"}
                                strokeDasharray={isDirect ? "none" : "5,4"}
                                markerEnd={isDirect ? "url(#arrowhead-direct)" : undefined}
                                className="opacity-75 hover:opacity-100"
                              />
                            </g>
                          );
                        })}
                      </svg>

                      {/* HTML Interactive Nodes */}
                      {blastRadius.nodes.map((node) => {
                        const pos = nodePositions[node.id];
                        if (!pos) return null;
                        const isRoot = node.type === "INCIDENT_ROOT";
                        const isSelected = selectedNodeId === node.id;
                        const sla = getSlaBadge(node.sla);

                        return (
                          <div
                            key={node.id}
                            onClick={() => setSelectedNodeId(node.id)}
                            style={{
                              position: "absolute",
                              left: pos.x - pos.w / 2,
                              top: pos.y - pos.h / 2,
                              width: pos.w,
                              minHeight: pos.h,
                            }}
                            className={`p-3 rounded-xl transition-all cursor-pointer backdrop-blur-md shadow-xl select-none ${
                              isRoot
                                ? `bg-zinc-900/95 border-2 ${
                                    isSelected
                                      ? "border-emerald-400 ring-2 ring-emerald-400/40 shadow-emerald-950/80"
                                      : "border-red-600/80 hover:border-red-500 shadow-red-950/40"
                                  }`
                                : `bg-zinc-900/90 border ${
                                    isSelected
                                      ? "border-cyan-400 ring-2 ring-cyan-400/40"
                                      : node.sla?.riskState === "BREACHED" || node.sla?.isOverdue
                                      ? "border-rose-600 hover:border-rose-500 shadow-rose-950/40"
                                      : "border-zinc-800 hover:border-zinc-700"
                                  }`
                            }`}
                          >
                            {/* Card Header */}
                            <div className="flex items-center justify-between gap-1.5 mb-1.5">
                              <div className="flex items-center gap-1.5">
                                {isRoot ? (
                                  <span className="text-xs">🚨</span>
                                ) : (
                                  <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded bg-zinc-800 text-zinc-300">
                                    {node.itemType || "ITEM"}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                    isRoot
                                      ? getSeverityBadge(node.severity || "SEV3")
                                      : getPriorityBadge(node.priority)
                                  }`}
                                >
                                  {isRoot ? node.severity : node.priority}
                                </span>
                              </div>

                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${getStatusBadge(
                                  node.status
                                )}`}
                              >
                                {node.status}
                              </span>
                            </div>

                            {/* Title */}
                            <p className="text-xs font-bold text-white line-clamp-2 leading-tight">
                              {node.title}
                            </p>

                            {/* Card Footer: Assignee & SLA */}
                            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-800/80 text-[10px]">
                              <div className="flex items-center gap-1 text-zinc-400 truncate max-w-[100px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                                <span className="truncate">
                                  {node.assignee?.name || (isRoot ? "Commander" : "Unassigned")}
                                </span>
                              </div>

                              {!isRoot && (
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${sla.cls}`}
                                >
                                  {sla.text}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* TABLE ACCESSIBILITY VIEW */
                <div className="overflow-x-auto min-h-[480px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 uppercase font-semibold border-b border-zinc-800 text-[10px]">
                      <tr>
                        <th className="px-4 py-3">Work Item</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Priority</th>
                        <th className="px-3 py-3">SLA Status</th>
                        <th className="px-3 py-3">Assignee</th>
                        <th className="px-3 py-3">Relationship</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      {filteredWorkItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                            No work items match current filter criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredWorkItems.map((item) => {
                          const sla = getSlaBadge(item.sla);
                          const isSelected = selectedNodeId === item.id;
                          return (
                            <tr
                              key={item.id}
                              onClick={() => setSelectedNodeId(item.id)}
                              className={`hover:bg-zinc-800/40 transition-colors cursor-pointer ${
                                isSelected ? "bg-cyan-950/30" : ""
                              }`}
                            >
                              <td className="px-4 py-3 font-semibold text-white max-w-xs truncate">
                                {item.title}
                              </td>
                              <td className="px-3 py-3 font-mono text-[11px] text-zinc-400">
                                {item.itemType}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getStatusBadge(
                                    item.status
                                  )}`}
                                >
                                  {item.status}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getPriorityBadge(
                                    item.priority
                                  )}`}
                                >
                                  {item.priority}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${sla.cls}`}
                                >
                                  {sla.text}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-zinc-300">
                                {item.assignee?.name || (
                                  <span className="text-amber-400/90 italic">Unassigned</span>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <span className="px-2 py-0.5 rounded bg-blue-950/60 border border-blue-800/80 text-blue-300 text-[10px] font-medium">
                                  Direct Link
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Legend Ribbon */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-zinc-950 border-t border-zinc-800 text-[11px] text-zinc-400">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-sky-500" />
                    <span>Direct Mitigation Item (DB link)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-purple-500 border-t border-dashed border-purple-400" />
                    <span>Shared Assignee (workload correlation)</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Breached SLA</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>At Risk</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>On Track / Resolved</span>
                  </span>
                </div>
              </div>
            </div>

            {/* NODE DETAILS INSPECTOR PANEL (4 COLS) */}
            <div className="lg:col-span-4 flex flex-col rounded-2xl bg-zinc-900/80 border border-zinc-800 overflow-hidden shadow-lg">
              <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-zinc-300">
                  Node Inspector
                </span>
                {selectedNode && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {selectedNode.type === "INCIDENT_ROOT" ? "ROOT INCIDENT" : "LINKED WORK ITEM"}
                  </span>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col gap-4 overflow-y-auto max-h-[600px]">
                {!selectedNode ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 my-auto">
                    <span className="text-2xl mb-2">🔍</span>
                    <p className="text-xs font-medium">Select any node on the graph to inspect details.</p>
                  </div>
                ) : selectedNode.type === "INCIDENT_ROOT" ? (
                  /* INCIDENT ROOT DETAILS */
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getSeverityBadge(
                            selectedNode.severity || "SEV3"
                          )}`}
                        >
                          {selectedNode.severity}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getStatusBadge(
                            selectedNode.status
                          )}`}
                        >
                          {selectedNode.status}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-white leading-snug">
                        {selectedNode.title}
                      </h3>
                      <p className="text-[11px] text-zinc-500 font-mono mt-1">ID: {selectedNode.id}</p>
                    </div>

                    <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col gap-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Impact Assessment:</span>
                        <span className="font-semibold text-zinc-200">
                          {selectedNode.impact || "Degradation"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Incident Commander:</span>
                        <span className="font-semibold text-white">
                          {selectedNode.assignee?.name || "Unassigned"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Declared At:</span>
                        <span className="font-mono text-zinc-300">
                          {new Date(blastRadius.declaredAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {blastRadius.resolvedAt && (
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-400">Resolved At:</span>
                          <span className="font-mono text-emerald-300">
                            {new Date(blastRadius.resolvedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                        Blast Radius Topology
                      </span>
                      <p className="text-zinc-300 text-xs leading-relaxed">
                        Incident is connected to{" "}
                        <strong className="text-white">{blastRadius.totalDirectlyLinkedItems}</strong>{" "}
                        linked work items via foreign keys in{" "}
                        <code className="text-emerald-400 font-mono text-[11px]">incident_linked_items</code>.
                      </p>
                    </div>

                    {onNavigateToIncidents && (
                      <button
                        onClick={onNavigateToIncidents}
                        className="w-full mt-2 py-2 rounded-xl bg-rose-900/60 hover:bg-rose-800 border border-rose-700/80 text-xs font-bold text-white transition-colors cursor-pointer"
                      >
                        Open in Incident Command Center
                      </button>
                    )}
                  </div>
                ) : (
                  /* LINKED WORK ITEM DETAILS */
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {selectedNode.itemType}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getPriorityBadge(
                            selectedNode.priority
                          )}`}
                        >
                          {selectedNode.priority}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getStatusBadge(
                            selectedNode.status
                          )}`}
                        >
                          {selectedNode.status}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white leading-snug">
                        {selectedNode.title}
                      </h3>
                      <p className="text-[11px] text-zinc-500 font-mono mt-1">ID: {selectedNode.id}</p>
                    </div>

                    {/* Operational Owner / Assignee */}
                    <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Assigned Engineer
                      </span>
                      {selectedNode.assignee ? (
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center font-bold text-white text-xs">
                            {selectedNode.assignee.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{selectedNode.assignee.name}</p>
                            <p className="text-[11px] text-zinc-400">{selectedNode.assignee.email}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-amber-400 font-medium">⚠️ No engineer assigned to this item</p>
                      )}
                    </div>

                    {/* SLA Details */}
                    <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                          SLA Performance
                        </span>
                        {(() => {
                          const sla = getSlaBadge(selectedNode.sla);
                          return (
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${sla.cls}`}>
                              {sla.text}
                            </span>
                          );
                        })()}
                      </div>

                      {selectedNode.sla ? (
                        <>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-400">Target Resolution:</span>
                            <span className="font-mono text-zinc-200">
                              {selectedNode.sla.resolutionDeadline
                                ? new Date(selectedNode.sla.resolutionDeadline).toLocaleString()
                                : "None configured"}
                            </span>
                          </div>
                          {selectedNode.sla.breachedAt && (
                            <div className="flex items-center justify-between text-[11px] text-rose-400">
                              <span>Breached At:</span>
                              <span className="font-mono">
                                {new Date(selectedNode.sla.breachedAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-zinc-500 text-xs">No active SLA rule mapped for this item.</p>
                      )}
                    </div>

                    {/* Database Relationship Provenance */}
                    <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Relationship Provenance
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-sky-400" />
                        <span className="text-zinc-200 font-medium">
                          Direct Mitigation Link
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Linked on{" "}
                        <span className="text-zinc-300">
                          {selectedNode.linkedAt
                            ? new Date(selectedNode.linkedAt).toLocaleString()
                            : "record declaration"}
                        </span>
                        {selectedNode.linkedByName && (
                          <> by <span className="text-zinc-300">{selectedNode.linkedByName}</span></>
                        )}.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
