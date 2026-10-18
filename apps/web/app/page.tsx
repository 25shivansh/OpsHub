"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  WorkItem,
  DashboardData,
  NotificationItem,
  getStoredUser,
  setStoredUser,
  setToken,
  clearToken,
} from "./lib/api";
import { IncidentCommandCenter } from "./components/IncidentCommandCenter";
import { SlaDashboard } from "./components/SlaDashboard";

function formatSlaRemaining(
  deadlineStr: string,
  completedAtStr?: string | null
): { text: string; isPast: boolean } {
  const deadline = new Date(deadlineStr).getTime();
  const targetTime = completedAtStr
    ? new Date(completedAtStr).getTime()
    : Date.now();
  const diffMs = deadline - targetTime;
  const isPast = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const mins = Math.floor(absDiff / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;

  let timeStr = "";
  if (hours > 0) {
    timeStr = remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  } else {
    timeStr = `${mins}m`;
  }

  if (completedAtStr) {
    return {
      text: isPast ? `+${timeStr} late` : `${timeStr} early`,
      isPast,
    };
  }

  return {
    text: isPast ? `+${timeStr} overdue` : `${timeStr} left`,
    isPast,
  };
}

function calculateSlaProgress(
  createdAtStr: string,
  deadlineStr: string,
  completedAtStr?: string | null
): number {
  const start = new Date(createdAtStr).getTime();
  const end = new Date(deadlineStr).getTime();
  const now = completedAtStr ? new Date(completedAtStr).getTime() : Date.now();
  if (end <= start) return 100;
  const progress = Math.round(((now - start) / (end - start)) * 100);
  return Math.min(Math.max(progress, 0), 100);
}

const DEMO_USERS = [
  { name: "Admin User", email: "admin@newtonite.dev", role: "ADMIN", color: "from-purple-500 to-indigo-600" },
  { name: "Operations Lead", email: "lead@newtonite.dev", role: "LEAD", color: "from-blue-500 to-cyan-600" },
  { name: "Operations Member", email: "member@newtonite.dev", role: "MEMBER", color: "from-emerald-500 to-teal-600" },
  { name: "Auditor Viewer", email: "viewer@newtonite.dev", role: "VIEWER", color: "from-amber-500 to-orange-600" },
];

const STATUS_COLUMNS: Array<{ key: WorkItem["status"]; label: string; color: string; bg: string }> = [
  { key: "OPEN", label: "Open Backlog", color: "text-slate-300", bg: "bg-slate-900/60 border-slate-800" },
  { key: "IN_PROGRESS", label: "In Progress", color: "text-blue-400", bg: "bg-blue-950/30 border-blue-900/50" },
  { key: "AWAITING_APPROVAL", label: "Awaiting Approval", color: "text-amber-400", bg: "bg-amber-950/30 border-amber-900/50" },
  { key: "RESOLVED", label: "Resolved", color: "text-emerald-400", bg: "bg-emerald-950/30 border-emerald-900/50" },
  { key: "CLOSED", label: "Closed", color: "text-zinc-500", bg: "bg-zinc-950/60 border-zinc-900" },
];

export default function NewtoniteApp() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string>("MEMBER");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Core team state
  const [teamId, setTeamId] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("Core Operations");

  // Dashboard & Items state
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [activeNavTab, setActiveNavTab] = useState<"workbench" | "sla" | "incidents">("workbench");

  // Notification state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Selected item drawer
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "conflict" } | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    type: "TASK" as WorkItem["type"],
    priority: "NORMAL" as WorkItem["priority"],
  });

  const showToast = (text: string, type: "success" | "error" | "conflict" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // 1. Initial Load & Auth verification
  useEffect(() => {
    const user = getStoredUser();
    if (user) {
      setCurrentUser(user);
    }
  }, []);

  // 2. Fetch dashboard data & work items
  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      setLoading(true);

      // Attempt to load notifications
      try {
        const notifRes = await api.listNotifications({ limit: 15 });
        setNotifications(notifRes.data);
        const countRes = await api.getUnreadCount();
        setUnreadCount(countRes.count);
      } catch (err) {
        console.warn("Could not load notifications:", err);
      }

      // First query items to resolve demo team ID if not set
      let activeTeamId = teamId;
      if (!activeTeamId) {
        // Query items for any team user belongs to
        try {
          const summaryRes = await fetch("/api/v1/items?page=1&limit=1", {
            headers: { Authorization: `Bearer ${localStorage.getItem("newtonite_token")}` },
          });
          if (summaryRes.ok) {
            const data = await summaryRes.json();
            if (data.data?.[0]?.teamId) {
              activeTeamId = data.data[0].teamId;
              setTeamId(activeTeamId);
            }
          }
        } catch {}
      }

      if (activeTeamId) {
        // Load dashboard summary
        try {
          const dash = await api.getDashboardSummary(activeTeamId);
          setDashboard(dash);
          setUserRole(dash.team.role);
          setTeamName(dash.team.name);
        } catch (err) {
          console.warn("Dashboard fetch:", err);
        }

        // Load items list
        const itemsRes = await api.listWorkItems({
          teamId: activeTeamId,
          limit: 100,
        });
        setItems(itemsRes.data);
      }
    } catch (err: any) {
      console.error("Data load error:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser, teamId]);

  useEffect(() => {
    if (currentUser) {
      loadData();
    }
  }, [currentUser, loadData]);

  // Handle Demo Login
  const handleDemoLogin = async (email: string) => {
    try {
      setIsLoggingIn(true);
      setAuthError(null);
      const res = await api.login(email, "Newtonite@123!");
      setCurrentUser(res.user);
      showToast(`Signed in as ${res.user.name} (${email})`, "success");
    } catch (err: any) {
      setAuthError(err.message || "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setDashboard(null);
    setItems([]);
    setSelectedItem(null);
    showToast("Signed out successfully", "success");
  };

  // Action: Atomic Claim Item
  const handleClaimItem = async (item: WorkItem) => {
    try {
      setActionLoading(true);
      const updated = await api.claimWorkItem(item.id, item.version);
      showToast(`Successfully claimed "${item.title}"`, "success");
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (selectedItem?.id === item.id) setSelectedItem(updated);
      loadData();
    } catch (err: any) {
      if (err.status === 409) {
        showToast(`Conflict: ${err.message}`, "conflict");
        loadData();
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Transition Item Workflow
  const handleTransitionItem = async (item: WorkItem, targetStatus: WorkItem["status"]) => {
    try {
      setActionLoading(true);
      const updated = await api.transitionWorkItem(item.id, targetStatus, item.version);
      showToast(`Transitioned to ${targetStatus}`, "success");
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (selectedItem?.id === item.id) setSelectedItem(updated);
      loadData();
    } catch (err: any) {
      if (err.status === 409) {
        showToast(`Conflict: Item was modified concurrently. Refreshed to latest state.`, "conflict");
        loadData();
      } else if (err.status === 403) {
        showToast(`Forbidden: ${err.message}`, "error");
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Assign Item
  const handleAssignItem = async (item: WorkItem, targetAssigneeId: string | null) => {
    try {
      setActionLoading(true);
      const updated = await api.assignWorkItem(item.id, targetAssigneeId, item.version);
      showToast(targetAssigneeId ? "Item assigned successfully" : "Item unassigned", "success");
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (selectedItem?.id === item.id) setSelectedItem(updated);
      loadData();
    } catch (err: any) {
      if (err.status === 409) {
        showToast(`Conflict: ${err.message}`, "conflict");
        loadData();
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Create Work Item
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.title.trim() || !teamId) return;

    try {
      setActionLoading(true);
      const newItem = await api.createWorkItem({
        teamId,
        title: createForm.title.trim(),
        description: createForm.description.trim() || undefined,
        type: createForm.type,
        priority: createForm.priority,
      });

      showToast(`Created work item "${newItem.title}"`, "success");
      setShowCreateModal(false);
      setCreateForm({ title: "", description: "", type: "TASK", priority: "NORMAL" });
      setItems((prev) => [newItem, ...prev]);
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // Notification mark as read
  const handleMarkNotifRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
      showToast("All notifications marked as read", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (priorityFilter !== "ALL" && item.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Allowed transitions helper based on role
  const getAllowedTransitions = (item: WorkItem) => {
    const transitions: Array<{ status: WorkItem["status"]; label: string; color: string; requiresApproval?: boolean }> = [];

    switch (item.status) {
      case "OPEN":
        transitions.push({ status: "IN_PROGRESS", label: "Start Work", color: "bg-blue-600 hover:bg-blue-500" });
        if (["LEAD", "ADMIN"].includes(userRole)) {
          transitions.push({ status: "CLOSED", label: "Discard", color: "bg-zinc-700 hover:bg-zinc-600" });
        }
        break;

      case "IN_PROGRESS":
        transitions.push({ status: "AWAITING_APPROVAL", label: "Submit for Approval", color: "bg-amber-600 hover:bg-amber-500" });
        transitions.push({ status: "OPEN", label: "Revert to Open", color: "bg-slate-700 hover:bg-slate-600" });
        if (["LEAD", "ADMIN"].includes(userRole)) {
          transitions.push({ status: "RESOLVED", label: "Fast-Track Resolve", color: "bg-emerald-600 hover:bg-emerald-500" });
        }
        break;

      case "AWAITING_APPROVAL":
        if (["LEAD", "ADMIN"].includes(userRole)) {
          transitions.push({ status: "RESOLVED", label: "Approve & Resolve", color: "bg-emerald-600 hover:bg-emerald-500" });
          transitions.push({ status: "IN_PROGRESS", label: "Request Changes", color: "bg-rose-600 hover:bg-rose-500" });
        } else {
          transitions.push({ status: "RESOLVED", label: "Requires Lead Approval", color: "bg-zinc-800 opacity-60 cursor-not-allowed", requiresApproval: true });
        }
        break;

      case "RESOLVED":
        transitions.push({ status: "CLOSED", label: "Close Item", color: "bg-zinc-700 hover:bg-zinc-600" });
        if (["LEAD", "ADMIN"].includes(userRole)) {
          transitions.push({ status: "OPEN", label: "Reopen", color: "bg-slate-700 hover:bg-slate-600" });
        }
        break;

      case "CLOSED":
        if (["LEAD", "ADMIN"].includes(userRole)) {
          transitions.push({ status: "OPEN", label: "Reopen", color: "bg-cyan-600 hover:bg-cyan-500" });
        }
        break;
    }

    return transitions;
  };

  // =========================================================================
  // RENDER: Unauthenticated Splash / Quick Demo Login
  // =========================================================================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-neutral-900 text-zinc-100 flex flex-col justify-center items-center p-6 font-sans">
        {/* Glow effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/10 blur-[140px] rounded-full pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-cyan-600/10 blur-[140px] rounded-full pointer-events-none" />

        <div className="relative max-w-xl w-full bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-2xl rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center font-black text-xl text-black shadow-lg shadow-indigo-500/20">
              N
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                NEWTONITE
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 tracking-wider">
                  OPS UNDER PRESSURE
                </span>
              </h1>
              <p className="text-xs text-zinc-400">Team Work-Management & Mission-Critical Workflow Engine</p>
            </div>
          </div>

          <p className="text-sm text-zinc-300 mb-6 leading-relaxed">
            Select a verified demo account to experience role-governed state machines, atomic work claiming, and transactional event outbox processing:
          </p>

          {authError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs">
              {authError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                onClick={() => handleDemoLogin(u.email)}
                disabled={isLoggingIn}
                className="group relative flex flex-col text-left p-4 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/60 hover:border-zinc-500 transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-sm text-zinc-100 group-hover:text-white">
                    {u.name}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r ${u.color} text-white shadow-xs`}
                  >
                    {u.role}
                  </span>
                </div>
                <span className="text-xs text-zinc-400 font-mono">{u.email}</span>
                <span className="mt-2 text-[11px] text-indigo-400 font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Sign In &rarr;
                </span>
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
            <span>Password: <code className="text-zinc-400 font-mono">Newtonite@123!</code></span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Supabase PostgreSQL Online
            </span>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Authenticated Dashboard & Operations Console
  // =========================================================================
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Toast alert */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm flex items-center gap-3 backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-200 ${
            toastMessage.type === "conflict"
              ? "bg-amber-950/90 border-amber-600/70 text-amber-200"
              : toastMessage.type === "error"
              ? "bg-rose-950/90 border-rose-600/70 text-rose-200"
              : "bg-zinc-900/90 border-emerald-500/60 text-emerald-300"
          }`}
        >
          <span className="text-base">
            {toastMessage.type === "conflict" ? "⚠️" : toastMessage.type === "error" ? "❌" : "✅"}
          </span>
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-xs opacity-60 hover:opacity-100 cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* 1. TOP NAV HEADER */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 border-b border-zinc-800/80 backdrop-blur-xl px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center font-black text-sm text-black shadow-md shadow-indigo-500/20">
              N
            </div>
            <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              NEWTONITE
            </span>
          </div>

          <div className="h-5 w-px bg-zinc-800" />

          {/* Active Team Pill */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-zinc-300">{teamName}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
              {teamId ? teamId.slice(0, 8) : "core-ops"}
            </span>
          </div>

          <div className="h-5 w-px bg-zinc-800 hidden md:block" />

          {/* Primary View Switcher */}
          <div className="flex rounded-xl bg-zinc-900/90 border border-zinc-800 p-1">
            <button
              onClick={() => setActiveNavTab("workbench")}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeNavTab === "workbench"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>📋</span>
              <span>Work Items</span>
            </button>
            <button
              onClick={() => setActiveNavTab("sla")}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeNavTab === "sla"
                  ? "bg-gradient-to-r from-amber-900/80 to-orange-900/80 text-amber-200 border border-amber-700/60 shadow-sm"
                  : "text-zinc-400 hover:text-amber-300"
              }`}
            >
              <span>⏱️</span>
              <span>SLA Engine</span>
            </button>
            <button
              onClick={() => setActiveNavTab("incidents")}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeNavTab === "incidents"
                  ? "bg-gradient-to-r from-rose-900/80 to-red-900/80 text-rose-200 border border-rose-700/60 shadow-sm"
                  : "text-zinc-400 hover:text-rose-300"
              }`}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              <span>Incident Command</span>
            </button>
          </div>
        </div>

        {/* User profile & Actions */}
        <div className="flex items-center gap-3">
          {/* Notifications Button */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Notifications"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 text-[9px] font-bold rounded-full bg-rose-600 text-white shadow-xs animate-bounce">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Drawer Popover */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 text-[10px]">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllNotifsRead}
                      className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2">
                  {notifications.length === 0 ? (
                    <p className="text-zinc-500 py-6 text-center">No notifications yet</p>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => !notif.readAt && handleMarkNotifRead(notif.id)}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                          notif.readAt
                            ? "bg-zinc-950/40 border-zinc-800/40 text-zinc-400"
                            : "bg-zinc-800/80 border-indigo-500/30 text-zinc-200"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-white">
                            {notif.event?.eventType || "ACTIVITY"}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(notif.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-zinc-300">
                          {notif.event?.itemTitle || "Work item update"}
                        </p>
                        {notif.event?.actorName && (
                          <span className="text-[10px] text-zinc-400 mt-1 block">
                            by {notif.event.actorName}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Account Switcher */}
          <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center font-bold text-xs text-white">
                {currentUser.name.charAt(0)}
              </div>
              <div className="hidden sm:block text-left">
                <span className="block text-xs font-semibold text-zinc-200">{currentUser.name}</span>
                <span className="block text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                  {userRole}
                </span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="ml-2 text-xs px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN CONTENT AREA */}
      {activeNavTab === "incidents" ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
          <IncidentCommandCenter
            currentUser={currentUser}
            userRole={userRole}
            teamId={teamId}
            workItems={items}
            showToast={showToast}
          />
        </main>
      ) : activeNavTab === "sla" ? (
        <SlaDashboard
          currentUser={currentUser}
          userRole={userRole}
          teamId={teamId}
          workItems={items}
          showToast={showToast}
          onRefreshWorkItems={loadData}
        />
      ) : (
        <>
          {/* 2. DASHBOARD SUMMARY STATS RIBBON */}
          {dashboard && (
            <section className="px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
          <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
              <span className="block text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1">
                Total Items
              </span>
              <span className="text-2xl font-black text-white">{dashboard.metrics.totalWorkItems}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-900/40">
              <span className="block text-[11px] font-medium text-blue-400 uppercase tracking-wider mb-1">
                In Progress
              </span>
              <span className="text-2xl font-black text-blue-300">
                {dashboard.metrics.byStatus.IN_PROGRESS}
              </span>
            </div>

            <div className={`p-3.5 rounded-xl border ${dashboard.metrics.awaitingApprovalCount > 0 ? "bg-amber-950/30 border-amber-600/50" : "bg-zinc-900/60 border-zinc-800/80"}`}>
              <span className="block text-[11px] font-medium text-amber-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                Awaiting Review
                {dashboard.metrics.awaitingApprovalCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                )}
              </span>
              <span className="text-2xl font-black text-amber-300">
                {dashboard.metrics.awaitingApprovalCount}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
              <span className="block text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1">
                Unassigned
              </span>
              <span className="text-2xl font-black text-zinc-200">
                {dashboard.metrics.unassignedCount}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
              <span className="block text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-1">
                Resolved
              </span>
              <span className="text-2xl font-black text-emerald-300">
                {dashboard.metrics.byStatus.RESOLVED}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-900/40">
              <span className="block text-[11px] font-medium text-purple-400 uppercase tracking-wider mb-1">
                Assigned to Me
              </span>
              <span className="text-2xl font-black text-purple-300">
                {dashboard.metrics.assignedToMeCount}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 3. TOOLBAR CONTROLS & WORKBENCH */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-white">Operations Workbench</h2>
            <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
              <button
                onClick={() => setViewMode("board")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  viewMode === "board" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
                }`}
              >
                Kanban Board
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  viewMode === "list" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
                }`}
              >
                Table List
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {/* Search */}
            <input
              type="text"
              placeholder="Search title, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 flex-1 sm:w-56"
            />

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Priorities</option>
              <option value="URGENT">Urgent</option>
              <option value="HIGH">High</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>

            {/* Refresh */}
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Create Button */}
            {userRole !== "VIEWER" && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow-md shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer"
              >
                <span>+</span> New Work Item
              </button>
            )}
          </div>
        </div>

        {/* 4. WORKBENCH VIEWS */}
        {loading && items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-zinc-500">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Connecting to Newtonite Operations Engine...</p>
          </div>
        ) : viewMode === "board" ? (
          /* KANBAN BOARD VIEW */
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
            {STATUS_COLUMNS.map((col) => {
              const colItems = filteredItems.filter((i) => i.status === col.key);

              return (
                <div key={col.key} className={`rounded-xl border ${col.bg} p-3 flex flex-col min-h-[500px]`}>
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-zinc-800/80">
                    <span className={`font-bold text-xs ${col.color}`}>{col.label}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 text-[10px] font-mono">
                      {colItems.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1">
                    {colItems.length === 0 ? (
                      <div className="h-28 flex items-center justify-center border border-dashed border-zinc-800/60 rounded-lg text-zinc-600 text-xs">
                        No items
                      </div>
                    ) : (
                      colItems.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className="group p-3 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 hover:border-zinc-700 transition-all shadow-sm hover:shadow-md cursor-pointer flex flex-col gap-2 relative"
                        >
                          {/* Priority, Version & SLA Risk pill */}
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  item.priority === "URGENT"
                                    ? "bg-rose-950 text-rose-300 border border-rose-800"
                                    : item.priority === "HIGH"
                                    ? "bg-amber-950 text-amber-300 border border-amber-800"
                                    : item.priority === "NORMAL"
                                    ? "bg-cyan-950 text-cyan-300 border border-cyan-800"
                                    : "bg-slate-900 text-slate-400 border border-slate-800"
                                }`}
                              >
                                {item.priority}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">v{item.version}</span>
                            </div>

                            {/* SLA Risk Pill */}
                            {item.sla ? (
                              <div
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
                                  item.sla.riskState === "BREACHED"
                                    ? "bg-rose-950/80 border-rose-700/80 text-rose-300"
                                    : item.sla.riskState === "AT_RISK"
                                    ? "bg-amber-950/80 border-amber-700/80 text-amber-300"
                                    : item.sla.riskState === "COMPLETED"
                                    ? "bg-cyan-950/80 border-cyan-700/80 text-cyan-300"
                                    : "bg-emerald-950/80 border-emerald-700/80 text-emerald-300"
                                }`}
                                title={`SLA Risk: ${item.sla.riskState}`}
                              >
                                <span>
                                  {item.sla.riskState === "BREACHED"
                                    ? "🚨"
                                    : item.sla.riskState === "AT_RISK"
                                    ? "⚠️"
                                    : item.sla.riskState === "COMPLETED"
                                    ? "✓"
                                    : "🟢"}
                                </span>
                                <span>{item.sla.riskState.replace("_", " ")}</span>
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono text-zinc-500 border border-zinc-800 bg-zinc-900/60"
                                title="No matching SLA policy configured"
                              >
                                <span>⚪</span>
                                <span>No SLA</span>
                              </div>
                            )}
                          </div>

                          <h3 className="text-xs font-semibold text-zinc-200 group-hover:text-white line-clamp-2">
                            {item.title}
                          </h3>

                          {/* SLA Deadline subtitle */}
                          {item.sla && (
                            <div className="text-[10px] font-mono flex items-center justify-between text-zinc-400 bg-zinc-950/50 px-2 py-1 rounded-md border border-zinc-800/60">
                              <span className="flex items-center gap-1">
                                <span className="text-zinc-500">Target:</span>
                                {item.sla.resolvedAt ? (
                                  <span className="text-cyan-400 font-semibold">✓ Completed</span>
                                ) : !item.sla.firstRespondedAt ? (
                                  <span
                                    className={
                                      new Date(item.sla.responseDeadline).getTime() < Date.now()
                                        ? "text-rose-400 font-bold"
                                        : "text-zinc-300"
                                    }
                                  >
                                    Resp: {formatSlaRemaining(item.sla.responseDeadline).text}
                                  </span>
                                ) : (
                                  <span
                                    className={
                                      new Date(item.sla.resolutionDeadline).getTime() < Date.now()
                                        ? "text-rose-400 font-bold"
                                        : "text-zinc-300"
                                    }
                                  >
                                    Res: {formatSlaRemaining(item.sla.resolutionDeadline).text}
                                  </span>
                                )}
                              </span>
                              <span className="text-[9px] text-zinc-500">
                                {item.sla.responseTargetMinutes}m/{item.sla.resolutionTargetMinutes}m
                              </span>
                            </div>
                          )}

                          {/* Footer with Assignee or Claim Button */}
                          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-[11px]">
                            {item.assigneeId ? (
                              <span className="text-zinc-400 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                {item.assigneeId === currentUser.id ? "Assigned to You" : "Assigned"}
                              </span>
                            ) : item.status === "OPEN" && userRole !== "VIEWER" ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleClaimItem(item);
                                }}
                                disabled={actionLoading}
                                className="px-2 py-0.5 rounded bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[10px] font-semibold transition-colors cursor-pointer"
                              >
                                ⚡ Claim Item
                              </button>
                            ) : (
                              <span className="text-zinc-500 italic text-[10px]">Unassigned</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* TABLE LIST VIEW */
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/60 text-zinc-400 font-semibold border-b border-zinc-800">
                <tr>
                  <th className="p-3">Title</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">SLA Risk</th>
                  <th className="p-3">SLA Deadlines</th>
                  <th className="p-3">Assignee</th>
                  <th className="p-3">Version</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="hover:bg-zinc-800/50 transition-colors cursor-pointer"
                  >
                    <td className="p-3 font-semibold text-white">{item.title}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-mono">
                        {item.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-[10px]">{item.priority}</td>
                    <td className="p-3">
                      {item.sla ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            item.sla.riskState === "BREACHED"
                              ? "bg-rose-950/80 border-rose-700/80 text-rose-300"
                              : item.sla.riskState === "AT_RISK"
                              ? "bg-amber-950/80 border-amber-700/80 text-amber-300"
                              : item.sla.riskState === "COMPLETED"
                              ? "bg-cyan-950/80 border-cyan-700/80 text-cyan-300"
                              : "bg-emerald-950/80 border-emerald-700/80 text-emerald-300"
                          }`}
                        >
                          <span>
                            {item.sla.riskState === "BREACHED"
                              ? "🚨"
                              : item.sla.riskState === "AT_RISK"
                              ? "⚠️"
                              : item.sla.riskState === "COMPLETED"
                              ? "✓"
                              : "🟢"}
                          </span>
                          <span>{item.sla.riskState.replace("_", " ")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                          <span>⚪</span> No SLA
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-[11px]">
                      {item.sla ? (
                        item.sla.resolvedAt ? (
                          <span className="text-cyan-400 font-semibold">✓ Completed</span>
                        ) : !item.sla.firstRespondedAt ? (
                          <span
                            className={
                              new Date(item.sla.responseDeadline).getTime() < Date.now()
                                ? "text-rose-400 font-bold"
                                : "text-zinc-300"
                            }
                          >
                            Resp: {formatSlaRemaining(item.sla.responseDeadline).text}
                          </span>
                        ) : (
                          <span
                            className={
                              new Date(item.sla.resolutionDeadline).getTime() < Date.now()
                                ? "text-rose-400 font-bold"
                                : "text-zinc-300"
                            }
                          >
                            Res: {formatSlaRemaining(item.sla.resolutionDeadline).text}
                          </span>
                        )
                      ) : (
                        <span className="text-zinc-600 italic">--</span>
                      )}
                    </td>
                    <td className="p-3">
                      {item.assigneeId
                        ? item.assigneeId === currentUser.id
                          ? "You"
                          : item.assigneeId.slice(0, 8)
                        : "Unassigned"}
                    </td>
                    <td className="p-3 font-mono text-zinc-500">v{item.version}</td>
                    <td className="p-3 text-right">
                      {!item.assigneeId && item.status === "OPEN" && userRole !== "VIEWER" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClaimItem(item);
                          }}
                          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                        >
                          Claim
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </main>
        </>
      )}

      {/* 5. WORK ITEM DETAILS & WORKFLOW DRAWER */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-zinc-950 border-l border-zinc-800 p-6 flex flex-col justify-between shadow-2xl overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-6">
                <div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                    v{selectedItem.version} &bull; {selectedItem.type}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 ml-2">
                    ID: {selectedItem.id.slice(0, 8)}...
                  </span>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-1 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-white cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <h2 className="text-lg font-bold text-white mb-2">{selectedItem.title}</h2>
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed whitespace-pre-wrap">
                {selectedItem.description || "No description provided."}
              </p>

              {/* Status & Assignment metadata */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 mb-6 text-xs">
                <div>
                  <span className="block text-[10px] text-zinc-500 uppercase font-semibold mb-1">
                    Current Status
                  </span>
                  <span className="font-bold text-white">{selectedItem.status}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-500 uppercase font-semibold mb-1">
                    Assignee
                  </span>
                  <span className="font-semibold text-zinc-300">
                    {selectedItem.assigneeId
                      ? selectedItem.assigneeId === currentUser.id
                        ? "You"
                        : "Team Member"
                      : "Unassigned"}
                  </span>
                </div>
              </div>

              {/* SLA Performance & Risk Commitments */}
              <div className="mb-6 p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
                  <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                    <span>⏱️</span> Operational SLA Commitment
                  </span>
                  {selectedItem.sla ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        selectedItem.sla.riskState === "BREACHED"
                          ? "bg-rose-950/90 border-rose-700 text-rose-300"
                          : selectedItem.sla.riskState === "AT_RISK"
                          ? "bg-amber-950/90 border-amber-700 text-amber-300"
                          : selectedItem.sla.riskState === "COMPLETED"
                          ? "bg-cyan-950/90 border-cyan-700 text-cyan-300"
                          : "bg-emerald-950/90 border-emerald-700 text-emerald-300"
                      }`}
                    >
                      <span>
                        {selectedItem.sla.riskState === "BREACHED"
                          ? "🚨"
                          : selectedItem.sla.riskState === "AT_RISK"
                          ? "⚠️"
                          : selectedItem.sla.riskState === "COMPLETED"
                          ? "✓"
                          : "🟢"}
                      </span>
                      <span>{selectedItem.sla.riskState.replace("_", " ")}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-zinc-500">⚪ No Policy</span>
                  )}
                </div>

                {selectedItem.sla ? (
                  <div className="space-y-3">
                    {/* Status Alert Banner */}
                    <div
                      className={`p-2.5 rounded-lg text-xs leading-relaxed flex items-start gap-2 border ${
                        selectedItem.sla.riskState === "BREACHED"
                          ? "bg-rose-950/30 border-rose-900/60 text-rose-200"
                          : selectedItem.sla.riskState === "AT_RISK"
                          ? "bg-amber-950/30 border-amber-900/60 text-amber-200"
                          : selectedItem.sla.riskState === "COMPLETED"
                          ? "bg-cyan-950/30 border-cyan-900/60 text-cyan-200"
                          : "bg-emerald-950/30 border-emerald-900/60 text-emerald-200"
                      }`}
                    >
                      <span className="text-sm">
                        {selectedItem.sla.riskState === "BREACHED"
                          ? "🚨"
                          : selectedItem.sla.riskState === "AT_RISK"
                          ? "⚠️"
                          : selectedItem.sla.riskState === "COMPLETED"
                          ? "✅"
                          : "🟢"}
                      </span>
                      <div className="flex-1 text-[11px]">
                        {selectedItem.sla.riskState === "BREACHED"
                          ? "SLA resolution deadline has been breached. Immediate escalation is recommended."
                          : selectedItem.sla.riskState === "AT_RISK"
                          ? `Warning threshold (${selectedItem.sla.warningThresholdPercent}%) exceeded. Item is at risk of breaching commitment.`
                          : selectedItem.sla.riskState === "COMPLETED"
                          ? "All agreed SLA commitments have been successfully completed."
                          : "Work item is on track and progressing within operational policy targets."}
                      </div>
                    </div>

                    {/* Response Target Card */}
                    <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                          <span>⚡</span> First Response Target
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {selectedItem.sla.responseTargetMinutes}m commitment
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-zinc-400">
                          Deadline: {new Date(selectedItem.sla.responseDeadline).toLocaleTimeString()}
                        </span>
                        <span className="font-semibold font-mono">
                          {selectedItem.sla.firstRespondedAt ? (
                            new Date(selectedItem.sla.firstRespondedAt).getTime() <=
                            new Date(selectedItem.sla.responseDeadline).getTime() ? (
                              <span className="text-emerald-400">✓ Responded on time</span>
                            ) : (
                              <span className="text-rose-400">Responded late</span>
                            )
                          ) : (
                            <span
                              className={
                                new Date(selectedItem.sla.responseDeadline).getTime() < Date.now()
                                  ? "text-rose-400 font-bold"
                                  : "text-amber-300 font-bold"
                              }
                            >
                              {formatSlaRemaining(selectedItem.sla.responseDeadline).text}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            selectedItem.sla.firstRespondedAt
                              ? "bg-emerald-500"
                              : new Date(selectedItem.sla.responseDeadline).getTime() < Date.now()
                              ? "bg-rose-500"
                              : "bg-indigo-500"
                          }`}
                          style={{
                            width: `${calculateSlaProgress(
                              selectedItem.createdAt,
                              selectedItem.sla.responseDeadline,
                              selectedItem.sla.firstRespondedAt
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Resolution Target Card */}
                    <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                          <span>🎯</span> Resolution Target
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {selectedItem.sla.resolutionTargetMinutes}m commitment
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-zinc-400">
                          Deadline: {new Date(selectedItem.sla.resolutionDeadline).toLocaleTimeString()}
                        </span>
                        <span className="font-semibold font-mono">
                          {selectedItem.sla.resolvedAt ? (
                            new Date(selectedItem.sla.resolvedAt).getTime() <=
                            new Date(selectedItem.sla.resolutionDeadline).getTime() ? (
                              <span className="text-emerald-400">✓ Resolved on time</span>
                            ) : (
                              <span className="text-rose-400">Resolved past deadline</span>
                            )
                          ) : (
                            <span
                              className={
                                new Date(selectedItem.sla.resolutionDeadline).getTime() < Date.now()
                                  ? "text-rose-400 font-bold"
                                  : "text-amber-300 font-bold"
                              }
                            >
                              {formatSlaRemaining(selectedItem.sla.resolutionDeadline).text}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            selectedItem.sla.resolvedAt
                              ? "bg-cyan-500"
                              : selectedItem.sla.riskState === "BREACHED"
                              ? "bg-rose-500"
                              : selectedItem.sla.riskState === "AT_RISK"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{
                            width: `${calculateSlaProgress(
                              selectedItem.createdAt,
                              selectedItem.sla.resolutionDeadline,
                              selectedItem.sla.resolvedAt
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Disambiguation note between SLA and planning due_at */}
                    <div className="text-[10px] text-zinc-500 italic bg-zinc-950/40 p-2 rounded border border-zinc-800/40 leading-relaxed">
                      ℹ️ SLA deadlines reflect contractual team targets and are evaluated separately from
                      user planning deadlines ({selectedItem.dueAt ? `Planning due: ${new Date(selectedItem.dueAt).toLocaleDateString()}` : "No planning due date set"}).
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 text-[11px] text-zinc-400 leading-relaxed">
                    ⚪ <strong className="text-zinc-300">No active SLA policy matched</strong> this item at creation time (Type: {selectedItem.type}, Priority: {selectedItem.priority}). No automated response or resolution deadlines are tracked.
                  </div>
                )}
              </div>

              {/* Role-Governed Workflow Transitions */}
              <div className="mb-6">
                <span className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2.5">
                  Workflow State Controls
                </span>

                <div className="flex flex-wrap gap-2">
                  {getAllowedTransitions(selectedItem).map((t) => (
                    <button
                      key={t.status}
                      onClick={() => !t.requiresApproval && handleTransitionItem(selectedItem, t.status)}
                      disabled={actionLoading || t.requiresApproval}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all shadow-sm cursor-pointer ${t.color}`}
                    >
                      {actionLoading ? "Processing..." : t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Atomic Claim Action */}
              {!selectedItem.assigneeId && selectedItem.status === "OPEN" && userRole !== "VIEWER" && (
                <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-900/60 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block font-semibold text-xs text-white">Item is Unassigned</span>
                      <span className="text-[11px] text-zinc-400">Claim ownership atomically to begin work</span>
                    </div>
                    <button
                      onClick={() => handleClaimItem(selectedItem)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs cursor-pointer shadow-md shadow-indigo-600/30"
                    >
                      ⚡ Claim Item
                    </button>
                  </div>
                </div>
              )}

              {/* Assignment controls */}
              {userRole !== "VIEWER" && (
                <div className="mb-6">
                  <span className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Assignment Control
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAssignItem(selectedItem, currentUser.id)}
                      disabled={actionLoading || selectedItem.assigneeId === currentUser.id}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 cursor-pointer disabled:opacity-50"
                    >
                      Assign to Me
                    </button>
                    {selectedItem.assigneeId && (
                      <button
                        onClick={() => handleAssignItem(selectedItem, null)}
                        disabled={actionLoading}
                        className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-rose-400 hover:text-rose-300 cursor-pointer disabled:opacity-50"
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-zinc-800 text-[11px] text-zinc-500 flex justify-between">
              <span>Optimistic Version: v{selectedItem.version}</span>
              <span>Updated: {new Date(selectedItem.updatedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* 6. CREATE WORK ITEM MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <h3 className="font-bold text-sm text-white">Create New Work Item</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-zinc-300 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Optimize Postgres transaction pooler"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="Operational details, acceptance criteria..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">Type</label>
                  <select
                    value={createForm.type}
                    onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="TASK">TASK</option>
                    <option value="INCIDENT">INCIDENT</option>
                    <option value="REQUEST">REQUEST</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">Priority</label>
                  <select
                    value={createForm.priority}
                    onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="LOW">LOW</option>
                    <option value="NORMAL">NORMAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="URGENT">URGENT</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? "Creating..." : "Create Work Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
