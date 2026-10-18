"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  WorkItem,
  SlaPolicy,
  SlaMetrics,
  CreateSlaPolicyInput,
  UpdateSlaPolicyInput,
  ApiError,
} from "../lib/api";

interface SlaDashboardProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  workItems: WorkItem[];
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
  onRefreshWorkItems?: () => void;
}

export function SlaDashboard({
  currentUser,
  userRole,
  teamId,
  workItems,
  showToast,
  onRefreshWorkItems,
}: SlaDashboardProps) {
  // Data state
  const [metrics, setMetrics] = useState<SlaMetrics | null>(null);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SlaPolicy | null>(null);
  const [deletingPolicy, setDeletingPolicy] = useState<SlaPolicy | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    workItemType: "" as "" | "TASK" | "INCIDENT" | "REQUEST",
    priority: "" as "" | "LOW" | "NORMAL" | "HIGH" | "URGENT",
    responseTargetMinutes: 30,
    resolutionTargetMinutes: 120,
    warningThresholdPercent: 75,
    isActive: true,
  });

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    responseTargetMinutes: 30,
    resolutionTargetMinutes: 120,
    warningThresholdPercent: 75,
  });

  // Role permissions
  const canManage = userRole === "LEAD" || userRole === "ADMIN";
  const canDelete = userRole === "ADMIN";

  // Load data for team
  const loadSlaData = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const [metricsRes, policiesRes] = await Promise.all([
        api.getSlaMetrics(teamId).catch((err) => {
          console.warn("SLA metrics fetch error:", err);
          return { data: null };
        }),
        api.listSlaPolicies(teamId).catch((err) => {
          console.warn("SLA policies fetch error:", err);
          return { data: [] };
        }),
      ]);

      if (metricsRes.data) {
        setMetrics(metricsRes.data);
      }
      if (policiesRes.data) {
        setPolicies(policiesRes.data);
      }
    } catch (err: any) {
      console.error("Error loading SLA data:", err);
      showToast(err.message || "Failed to load SLA data", "error");
    } finally {
      setLoading(false);
    }
  }, [teamId, showToast]);

  useEffect(() => {
    loadSlaData();
  }, [loadSlaData, refreshKey]);

  // Format minutes helper
  const formatMinutes = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  };

  // Determine policy tier
  const getPolicyTier = (p: SlaPolicy): { tier: number; label: string; badge: string } => {
    if (p.workItemType && p.priority) {
      return {
        tier: 1,
        label: "Tier 1: Type + Priority Specific",
        badge: "bg-purple-950/70 border-purple-800 text-purple-300",
      };
    }
    if (!p.workItemType && p.priority) {
      return {
        tier: 2,
        label: "Tier 2: Priority Specific",
        badge: "bg-indigo-950/70 border-indigo-800 text-indigo-300",
      };
    }
    if (p.workItemType && !p.priority) {
      return {
        tier: 3,
        label: "Tier 3: Type Specific",
        badge: "bg-cyan-950/70 border-cyan-800 text-cyan-300",
      };
    }
    return {
      tier: 4,
      label: "Tier 4: Catch-All Team Default",
      badge: "bg-zinc-800 border-zinc-700 text-zinc-300",
    };
  };

  // Handle Policy Activation Toggle
  const handleToggleActive = async (policy: SlaPolicy) => {
    if (!canManage) {
      showToast("Requires LEAD or ADMIN role to modify policy activation", "error");
      return;
    }

    try {
      setActionLoading(true);
      const nextActive = !policy.isActive;
      const res = await api.toggleSlaPolicyActive(teamId, policy.id, nextActive);
      showToast(
        `Policy "${policy.name}" ${nextActive ? "activated" : "deactivated"} successfully`,
        "success"
      );
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? res.data : p)));
      setRefreshKey((k) => k + 1);
      if (onRefreshWorkItems) onRefreshWorkItems();
    } catch (err: any) {
      console.error("Toggle active error:", err);
      if (err instanceof ApiError && err.status === 409) {
        showToast(err.message, "conflict");
      } else {
        showToast(err.message || "Failed to toggle policy status", "error");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Open Edit Modal
  const handleOpenEdit = (policy: SlaPolicy) => {
    if (!canManage) {
      showToast("Requires LEAD or ADMIN role to edit SLA policies", "error");
      return;
    }
    setEditingPolicy(policy);
    setEditForm({
      name: policy.name,
      description: policy.description || "",
      responseTargetMinutes: policy.responseTargetMinutes,
      resolutionTargetMinutes: policy.resolutionTargetMinutes,
      warningThresholdPercent: policy.warningThresholdPercent,
    });
    setModalError(null);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPolicy) return;

    if (!editForm.name.trim()) {
      setModalError("Policy name cannot be blank");
      return;
    }
    if (editForm.responseTargetMinutes <= 0) {
      setModalError("Response target must be greater than 0 minutes");
      return;
    }
    if (editForm.resolutionTargetMinutes < editForm.responseTargetMinutes) {
      setModalError("Resolution target must be greater than or equal to response target");
      return;
    }
    if (editForm.warningThresholdPercent < 1 || editForm.warningThresholdPercent > 99) {
      setModalError("Warning threshold must be between 1% and 99%");
      return;
    }

    try {
      setActionLoading(true);
      setModalError(null);
      const res = await api.updateSlaPolicy(teamId, editingPolicy.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        responseTargetMinutes: editForm.responseTargetMinutes,
        resolutionTargetMinutes: editForm.resolutionTargetMinutes,
        warningThresholdPercent: editForm.warningThresholdPercent,
      });

      showToast(`Policy "${res.data.name}" updated successfully`, "success");
      setPolicies((prev) => prev.map((p) => (p.id === editingPolicy.id ? res.data : p)));
      setEditingPolicy(null);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      console.error("Update policy error:", err);
      setModalError(err.message || "Failed to update policy");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Create Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      showToast("Requires LEAD or ADMIN role to create SLA policies", "error");
      return;
    }

    if (!createForm.name.trim()) {
      setModalError("Policy name cannot be blank");
      return;
    }
    if (createForm.responseTargetMinutes <= 0) {
      setModalError("Response target must be greater than 0 minutes");
      return;
    }
    if (createForm.resolutionTargetMinutes < createForm.responseTargetMinutes) {
      setModalError("Resolution target must be greater than or equal to response target");
      return;
    }
    if (createForm.warningThresholdPercent < 1 || createForm.warningThresholdPercent > 99) {
      setModalError("Warning threshold must be between 1% and 99%");
      return;
    }

    try {
      setActionLoading(true);
      setModalError(null);
      const payload: CreateSlaPolicyInput = {
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        workItemType: createForm.workItemType ? createForm.workItemType : null,
        priority: createForm.priority ? createForm.priority : null,
        responseTargetMinutes: Number(createForm.responseTargetMinutes),
        resolutionTargetMinutes: Number(createForm.resolutionTargetMinutes),
        warningThresholdPercent: Number(createForm.warningThresholdPercent),
        isActive: createForm.isActive,
      };

      const res = await api.createSlaPolicy(teamId, payload);
      showToast(`SLA Policy "${res.data.name}" created successfully`, "success");
      setShowCreateModal(false);
      setCreateForm({
        name: "",
        description: "",
        workItemType: "",
        priority: "",
        responseTargetMinutes: 30,
        resolutionTargetMinutes: 120,
        warningThresholdPercent: 75,
        isActive: true,
      });
      setPolicies((prev) => [res.data, ...prev]);
      setRefreshKey((k) => k + 1);
      if (onRefreshWorkItems) onRefreshWorkItems();
    } catch (err: any) {
      console.error("Create policy error:", err);
      if (err instanceof ApiError && err.status === 409) {
        setModalError(
          "Conflict: An active policy with this exact specificity already exists for this team. Deactivate the existing policy or create this one as inactive."
        );
      } else {
        setModalError(err.message || "Failed to create policy");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Delete Policy
  const handleDeletePolicy = async () => {
    if (!deletingPolicy) return;
    if (!canDelete) {
      showToast("Only ADMIN users can delete policies", "error");
      return;
    }

    try {
      setActionLoading(true);
      setModalError(null);
      await api.deleteSlaPolicy(teamId, deletingPolicy.id);
      showToast(`Policy "${deletingPolicy.name}" deleted successfully`, "success");
      setPolicies((prev) => prev.filter((p) => p.id !== deletingPolicy.id));
      setDeletingPolicy(null);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      console.error("Delete policy error:", err);
      if (err instanceof ApiError && err.status === 409) {
        setModalError(err.message);
      } else {
        setModalError(err.message || "Failed to delete policy");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered policies list
  const filteredPolicies = policies.filter((p) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchDesc = p.description?.toLowerCase().includes(q);
      if (!matchName && !matchDesc) return false;
    }
    if (typeFilter !== "ALL") {
      if (typeFilter === "NONE" && p.workItemType !== null) return false;
      if (typeFilter !== "NONE" && p.workItemType !== typeFilter) return false;
    }
    if (statusFilter !== "ALL") {
      if (statusFilter === "ACTIVE" && !p.isActive) return false;
      if (statusFilter === "INACTIVE" && p.isActive) return false;
    }
    return true;
  });

  return (
    <div className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6 animate-in fade-in duration-200">
      {/* 1. METRICS OVERVIEW CARDS */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>⏱️</span> SLA Risk Engine & Dashboard
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Real-time commitment tracking, breach prevention, and deterministic policy resolution.
            </p>
          </div>
          <button
            onClick={() => {
              setRefreshKey((k) => k + 1);
              if (onRefreshWorkItems) onRefreshWorkItems();
            }}
            disabled={loading}
            className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 text-xs font-semibold"
            title="Refresh SLA Metrics"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>

        {/* 5-Card Real-Data Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          {/* Card 1: Active SLAs & Status Breakdown */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 border border-zinc-800/80 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Active SLAs
              </span>
              <span className="text-xs">🎯</span>
            </div>
            <div className="text-2xl font-black text-white mb-2">
              {metrics ? metrics.activeSlas : "--"}
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
              <span className="text-emerald-400 font-bold" title="On Track">
                ● {metrics ? metrics.onTrackCount : 0} track
              </span>
              <span className="text-amber-400 font-bold" title="At Risk">
                ▲ {metrics ? metrics.atRiskCount : 0} risk
              </span>
              <span className="text-rose-400 font-bold" title="Breached">
                ✖ {metrics ? metrics.breachedCount : 0} breach
              </span>
            </div>
          </div>

          {/* Card 2: Breached / Critical Items */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-rose-950/20 to-zinc-950/90 border border-rose-900/40 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-rose-300 uppercase tracking-wider">
                Breached Items
              </span>
              <span className="text-xs">🚨</span>
            </div>
            <div className="text-2xl font-black text-rose-400 mb-1">
              {metrics ? metrics.breachedCount : "--"}
            </div>
            <span className="text-[10px] text-zinc-400">
              {metrics && metrics.breachedCount > 0
                ? "Immediate escalation required"
                : "No active breaches"}
            </span>
          </div>

          {/* Card 3: Response Compliance Rate */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-indigo-950/20 to-zinc-950/90 border border-indigo-900/40 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider">
                First Response
              </span>
              <span className="text-xs">⚡</span>
            </div>
            <div className="text-2xl font-black text-indigo-200 mb-1">
              {metrics?.responseCompliance.rate !== null &&
              metrics?.responseCompliance.rate !== undefined
                ? `${metrics.responseCompliance.rate}%`
                : "N/A"}
            </div>
            <span className="text-[10px] text-zinc-400">
              {metrics
                ? `${metrics.responseCompliance.compliant} / ${metrics.responseCompliance.eligible} responded on time`
                : "Calculating..."}
            </span>
          </div>

          {/* Card 4: Resolution Compliance Rate */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-emerald-950/20 to-zinc-950/90 border border-emerald-900/40 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">
                Resolution SLA
              </span>
              <span className="text-xs">✅</span>
            </div>
            <div className="text-2xl font-black text-emerald-300 mb-1">
              {metrics?.resolutionCompliance.rate !== null &&
              metrics?.resolutionCompliance.rate !== undefined
                ? `${metrics.resolutionCompliance.rate}%`
                : "N/A"}
            </div>
            <span className="text-[10px] text-zinc-400">
              {metrics
                ? `${metrics.resolutionCompliance.compliant} / ${metrics.resolutionCompliance.eligible} resolved on time`
                : "Calculating..."}
            </span>
          </div>

          {/* Card 5: Team SLA Policies */}
          <div className="p-4 rounded-xl bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 border border-zinc-800/80 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                SLA Policies
              </span>
              <span className="text-xs">📜</span>
            </div>
            <div className="text-2xl font-black text-white mb-1">
              {metrics ? metrics.activePolicies : policies.filter((p) => p.isActive).length}
            </div>
            <span className="text-[10px] text-zinc-400">
              {metrics
                ? `${metrics.totalPolicies} total policies configured`
                : `${policies.length} total policies`}
            </span>
          </div>
        </div>
      </section>

      {/* 2. POLICIES MANAGEMENT SECTION */}
      <section className="flex flex-col gap-4 bg-zinc-950/60 rounded-2xl border border-zinc-800/80 p-5 shadow-lg">
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">SLA Policy Rules</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                {filteredPolicies.length} policies
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Hierarchical 4-tier specificity matching prevents collisions and eliminates ambiguity.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Search */}
            <input
              type="text"
              placeholder="Search policy name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-44"
            />

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Item Types</option>
              <option value="INCIDENT">INCIDENT Only</option>
              <option value="TASK">TASK Only</option>
              <option value="REQUEST">REQUEST Only</option>
              <option value="NONE">Wildcard (Any Type)</option>
            </select>

            {/* Active Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All States</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>

            {/* Create Policy Button */}
            {canManage ? (
              <button
                onClick={() => {
                  setModalError(null);
                  setShowCreateModal(true);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow-md shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer"
              >
                <span>+</span> New SLA Policy
              </button>
            ) : (
              <div
                className="text-[11px] text-zinc-500 italic px-2 py-1 bg-zinc-900/60 rounded border border-zinc-800"
                title="Only LEAD or ADMIN roles can create and manage SLA policies"
              >
                Read-only ({userRole})
              </div>
            )}
          </div>
        </div>

        {/* Policies Table */}
        {loading && policies.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-zinc-500">
            <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs">Loading SLA policies...</p>
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
            <span className="text-3xl mb-2">📜</span>
            <p className="text-sm font-semibold text-zinc-300">No SLA Policies Found</p>
            <p className="text-xs text-zinc-500 max-w-sm mt-1 mb-4">
              {searchQuery || typeFilter !== "ALL" || statusFilter !== "ALL"
                ? "No policies match the selected search criteria or filter."
                : "Create an SLA policy to start automatically tracking response and resolution commitments."}
            </p>
            {canManage && (
              <button
                onClick={() => {
                  setModalError(null);
                  setShowCreateModal(true);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs cursor-pointer"
              >
                + Create First Policy
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 font-semibold border-b border-zinc-800">
                <tr>
                  <th className="p-3.5">Policy Details</th>
                  <th className="p-3.5">Specificity & Tier</th>
                  <th className="p-3.5">Response Target</th>
                  <th className="p-3.5">Resolution Target</th>
                  <th className="p-3.5">Warning Threshold</th>
                  <th className="p-3.5">State</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredPolicies.map((policy) => {
                  const tier = getPolicyTier(policy);
                  return (
                    <tr
                      key={policy.id}
                      className="hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Name & description */}
                      <td className="p-3.5 max-w-xs">
                        <div className="font-semibold text-white">{policy.name}</div>
                        {policy.description ? (
                          <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                            {policy.description}
                          </div>
                        ) : (
                          <div className="text-[11px] text-zinc-600 italic mt-0.5">
                            No description
                          </div>
                        )}
                      </td>

                      {/* Specificity badges */}
                      <td className="p-3.5">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${tier.badge}`}
                          >
                            {tier.label}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                            <span className="px-1.5 py-0.2 rounded bg-zinc-800 border border-zinc-700/60">
                              Type: {policy.workItemType ?? "*"}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-zinc-800 border border-zinc-700/60">
                              Pri: {policy.priority ?? "*"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Response target */}
                      <td className="p-3.5 font-mono text-zinc-200">
                        <span className="px-2 py-0.5 rounded bg-zinc-800/80 font-bold text-indigo-300">
                          {formatMinutes(policy.responseTargetMinutes)}
                        </span>
                      </td>

                      {/* Resolution target */}
                      <td className="p-3.5 font-mono text-zinc-200">
                        <span className="px-2 py-0.5 rounded bg-zinc-800/80 font-bold text-emerald-300">
                          {formatMinutes(policy.resolutionTargetMinutes)}
                        </span>
                      </td>

                      {/* Warning threshold */}
                      <td className="p-3.5 font-mono text-zinc-300">
                        <span className="px-2 py-0.5 rounded bg-zinc-800/80 text-amber-300 font-semibold">
                          {policy.warningThresholdPercent}%
                        </span>
                      </td>

                      {/* Active Toggle Switch */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(policy)}
                            disabled={!canManage || actionLoading}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              policy.isActive ? "bg-emerald-600" : "bg-zinc-700"
                            } ${!canManage ? "opacity-50 cursor-not-allowed" : ""}`}
                            title={
                              canManage
                                ? policy.isActive
                                  ? "Click to deactivate"
                                  : "Click to activate"
                                : "Requires LEAD or ADMIN role"
                            }
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                policy.isActive ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider ${
                              policy.isActive ? "text-emerald-400" : "text-zinc-500"
                            }`}
                          >
                            {policy.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </td>

                      {/* Action buttons */}
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && (
                            <button
                              onClick={() => handleOpenEdit(policy)}
                              disabled={actionLoading}
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                              title="Edit policy parameters"
                            >
                              Edit
                            </button>
                          )}

                          {canDelete ? (
                            <button
                              onClick={() => {
                                setModalError(null);
                                setDeletingPolicy(policy);
                              }}
                              disabled={actionLoading}
                              className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 hover:text-rose-100 text-[11px] font-semibold transition-colors cursor-pointer"
                              title="Delete policy (Admin only)"
                            >
                              Delete
                            </button>
                          ) : (
                            <span
                              className="text-[10px] text-zinc-600 font-mono"
                              title="Delete requires ADMIN role"
                            >
                              Locked
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. CREATE POLICY MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <span>➕</span> Create Team SLA Policy
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Establish deterministic response & resolution commitments.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-white cursor-pointer text-base"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2">
                <span>⚠️</span>
                <span className="flex-1">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              {/* Name */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Policy Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical Incident 1-Hour SLA"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Operational context and escalation guidelines..."
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, description: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Specificity: Work Item Type & Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Work Item Type Specificity
                  </label>
                  <select
                    value={createForm.workItemType}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        workItemType: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Wildcard (Applies to all types)</option>
                    <option value="INCIDENT">INCIDENT Only</option>
                    <option value="TASK">TASK Only</option>
                    <option value="REQUEST">REQUEST Only</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Priority Specificity
                  </label>
                  <select
                    value={createForm.priority}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        priority: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Wildcard (Applies to all priorities)</option>
                    <option value="URGENT">URGENT</option>
                    <option value="HIGH">HIGH</option>
                    <option value="NORMAL">NORMAL</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>

              {/* Targets: Response, Resolution & Warning */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    First Response (min) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={createForm.responseTargetMinutes}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        responseTargetMinutes: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {formatMinutes(createForm.responseTargetMinutes)}
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Resolution (min) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={createForm.resolutionTargetMinutes}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        resolutionTargetMinutes: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {formatMinutes(createForm.resolutionTargetMinutes)}
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Warning (%) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    required
                    value={createForm.warningThresholdPercent}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        warningThresholdPercent: parseInt(e.target.value) || 75,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    Warns at {createForm.warningThresholdPercent}% elapsed
                  </span>
                </div>
              </div>

              {/* Active Toggle */}
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white block">
                    Activate Immediately
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    If active, items matching this tier will snapshot this policy.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={createForm.isActive}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, isActive: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Creating Policy..." : "Create Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. EDIT POLICY MODAL */}
      {editingPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <span>✏️</span> Edit SLA Policy
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Updating mutable parameters does not modify past snapshots retrospectively.
                </p>
              </div>
              <button
                onClick={() => setEditingPolicy(null)}
                className="text-zinc-400 hover:text-white cursor-pointer text-base"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2">
                <span>⚠️</span>
                <span className="flex-1">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              {/* Name */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Policy Name *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm({ ...editForm, description: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Specificity reminder (immutable) */}
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Specificity Configuration:</span>
                <span className="font-mono text-zinc-300">
                  Type: {editingPolicy.workItemType ?? "*"} &bull; Priority:{" "}
                  {editingPolicy.priority ?? "*"}
                </span>
              </div>

              {/* Targets */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Response (min) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editForm.responseTargetMinutes}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        responseTargetMinutes: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {formatMinutes(editForm.responseTargetMinutes)}
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Resolution (min) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editForm.resolutionTargetMinutes}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        resolutionTargetMinutes: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {formatMinutes(editForm.resolutionTargetMinutes)}
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Warning (%) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    required
                    value={editForm.warningThresholdPercent}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        warningThresholdPercent: parseInt(e.target.value) || 75,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {editForm.warningThresholdPercent}% threshold
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingPolicy(null)}
                  className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Saving Changes..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DELETE CONFIRMATION MODAL */}
      {deletingPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 pb-3 border-b border-zinc-800 mb-4 text-rose-400">
              <span className="text-xl">⚠️</span>
              <h3 className="font-bold text-sm text-white">Delete SLA Policy?</h3>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-amber-950/80 border border-amber-800/80 text-amber-200 text-xs leading-relaxed">
                <div className="font-bold mb-1">Cannot Delete Referenced Policy:</div>
                <div>{modalError}</div>
              </div>
            )}

            <p className="text-xs text-zinc-300 leading-relaxed mb-4">
              Are you sure you want to permanently delete policy{" "}
              <strong className="text-white">"{deletingPolicy.name}"</strong>?
            </p>
            <p className="text-[11px] text-zinc-500 leading-relaxed mb-6">
              Note: The database enforces audit integrity. If any past or present work items
              snapshot this policy, deletion will be blocked and you should deactivate it instead.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingPolicy(null)}
                className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePolicy}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md shadow-rose-600/30 cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
