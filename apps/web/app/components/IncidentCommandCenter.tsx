"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  User,
  WorkItem,
  Incident,
  IncidentSeverity,
  IncidentImpact,
  IncidentStatus,
  IncidentResponderRole,
  IncidentTimelineEvent,
  IncidentLinkedItem,
} from "../lib/api";

interface IncidentCommandCenterProps {
  currentUser: User;
  userRole: string;
  teamId: string;
  workItems: WorkItem[];
  showToast: (text: string, type?: "success" | "error" | "conflict") => void;
}

const SEVERITY_CONFIG: Record<
  IncidentSeverity,
  { label: string; bg: string; text: string; border: string; badge: string; pulse: boolean }
> = {
  SEV1: {
    label: "SEV1 - Critical",
    bg: "bg-rose-950/40",
    text: "text-rose-300",
    border: "border-rose-600/60",
    badge: "bg-rose-600 text-white shadow-rose-600/40 shadow-sm",
    pulse: true,
  },
  SEV2: {
    label: "SEV2 - Major",
    bg: "bg-amber-950/40",
    text: "text-amber-300",
    border: "border-amber-600/60",
    badge: "bg-amber-600 text-white shadow-amber-600/40 shadow-sm",
    pulse: true,
  },
  SEV3: {
    label: "SEV3 - Moderate",
    bg: "bg-yellow-950/30",
    text: "text-yellow-300",
    border: "border-yellow-600/40",
    badge: "bg-yellow-600 text-black",
    pulse: false,
  },
  SEV4: {
    label: "SEV4 - Low",
    bg: "bg-blue-950/30",
    text: "text-blue-300",
    border: "border-blue-600/40",
    badge: "bg-blue-600 text-white",
    pulse: false,
  },
};

const IMPACT_LABELS: Record<IncidentImpact, string> = {
  TOTAL_OUTAGE: "Total Outage",
  MAJOR_DEGRADATION: "Major Degradation",
  MINOR_DEGRADATION: "Minor Degradation",
  NO_IMPACT: "No Impact",
};

const STATUS_ORDER: IncidentStatus[] = [
  "DECLARED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "MONITORING",
  "RESOLVED",
  "POSTMORTEM",
  "CLOSED",
];

const STATUS_BADGES: Record<
  IncidentStatus,
  { label: string; color: string; border: string }
> = {
  DECLARED: { label: "Declared", color: "bg-rose-950/80 text-rose-300", border: "border-rose-700/60" },
  INVESTIGATING: { label: "Investigating", color: "bg-indigo-950/80 text-indigo-300", border: "border-indigo-700/60" },
  IDENTIFIED: { label: "Identified", color: "bg-purple-950/80 text-purple-300", border: "border-purple-700/60" },
  MITIGATING: { label: "Mitigating", color: "bg-cyan-950/80 text-cyan-300", border: "border-cyan-700/60" },
  MONITORING: { label: "Monitoring", color: "bg-teal-950/80 text-teal-300", border: "border-teal-700/60" },
  RESOLVED: { label: "Resolved", color: "bg-emerald-950/80 text-emerald-300", border: "border-emerald-700/60" },
  POSTMORTEM: { label: "Postmortem", color: "bg-amber-950/80 text-amber-300", border: "border-amber-700/60" },
  CLOSED: { label: "Closed", color: "bg-zinc-900 text-zinc-400", border: "border-zinc-800" },
};

export function IncidentCommandCenter({
  currentUser,
  userRole,
  teamId,
  workItems,
  showToast,
}: IncidentCommandCenterProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");

  // Selected Incident War Room
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<IncidentTimelineEvent[]>([]);
  const [linkedItems, setLinkedItems] = useState<IncidentLinkedItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  // Edit / OCC
  const [mitigationNotes, setMitigationNotes] = useState("");
  const [postmortemUrl, setPostmortemUrl] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  // Link Work Item
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [linkingItem, setLinkingItem] = useState(false);

  // Declare Incident Modal
  const [showDeclareModal, setShowDeclareModal] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [declareForm, setDeclareForm] = useState({
    title: "",
    summary: "",
    severity: "SEV2" as IncidentSeverity,
    impact: "MAJOR_DEGRADATION" as IncidentImpact,
  });

  // Load Incidents
  const loadIncidents = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const res = await api.listIncidents({
        teamId,
        status: statusFilter !== "ALL" ? (statusFilter as IncidentStatus) : undefined,
        severity: severityFilter !== "ALL" ? (severityFilter as IncidentSeverity) : undefined,
        limit: 50,
      });
      setIncidents(res.data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [teamId, statusFilter, severityFilter, showToast]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  // Load Incident War Room Details
  const openIncidentWarRoom = async (incident: Incident) => {
    try {
      setSelectedIncident(incident);
      setMitigationNotes(incident.mitigationNotes || "");
      setPostmortemUrl(incident.postmortemUrl || "");
      setTimelineLoading(true);

      const [details, timelineRes, itemsRes] = await Promise.all([
        api.getIncident(incident.id),
        api.getIncidentTimeline(incident.id),
        api.getIncidentLinkedItems(incident.id),
      ]);

      setSelectedIncident(details);
      setTimeline(timelineRes.data);
      setLinkedItems(itemsRes.data);
      setMitigationNotes(details.mitigationNotes || "");
      setPostmortemUrl(details.postmortemUrl || "");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setTimelineLoading(false);
    }
  };

  // Declare Incident Submit
  const handleDeclareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declareForm.title.trim() || !teamId) return;

    try {
      setDeclaring(true);
      const newInc = await api.declareIncident({
        teamId,
        title: declareForm.title.trim(),
        summary: declareForm.summary.trim() || undefined,
        severity: declareForm.severity,
        impact: declareForm.impact,
        commanderId: currentUser.id,
      });

      showToast(`Declared ${newInc.severity} Incident: "${newInc.title}"`, "success");
      setShowDeclareModal(false);
      setDeclareForm({
        title: "",
        summary: "",
        severity: "SEV2",
        impact: "MAJOR_DEGRADATION",
      });
      loadIncidents();
      openIncidentWarRoom(newInc);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setDeclaring(false);
    }
  };

  // Status Transition
  const handleTransition = async (targetStatus: IncidentStatus) => {
    if (!selectedIncident) return;
    try {
      const updated = await api.transitionIncident(selectedIncident.id, {
        status: targetStatus,
        expectedVersion: selectedIncident.version,
      });
      showToast(`Status changed to ${targetStatus}`, "success");
      setSelectedIncident(updated);
      setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));

      // Refresh timeline
      const timelineRes = await api.getIncidentTimeline(updated.id);
      setTimeline(timelineRes.data);
    } catch (err: any) {
      if (err.status === 409) {
        showToast("Conflict: Incident was updated concurrently. Refreshing state...", "conflict");
        openIncidentWarRoom(selectedIncident);
      } else {
        showToast(err.message, "error");
      }
    }
  };

  // Save Mitigation Notes & Postmortem URL
  const handleSaveDetails = async () => {
    if (!selectedIncident) return;
    try {
      setSavingDetails(true);
      const updated = await api.updateIncident(selectedIncident.id, {
        mitigationNotes: mitigationNotes.trim() || undefined,
        postmortemUrl: postmortemUrl.trim() || undefined,
        expectedVersion: selectedIncident.version,
      });
      showToast("Incident details saved", "success");
      setSelectedIncident(updated);
      setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err: any) {
      if (err.status === 409) {
        showToast("Conflict: Incident modified concurrently. Re-fetching latest...", "conflict");
        openIncidentWarRoom(selectedIncident);
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setSavingDetails(false);
    }
  };

  // Add Timeline Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !newNote.trim()) return;

    try {
      setSubmittingNote(true);
      await api.addIncidentTimelineNote(selectedIncident.id, newNote.trim());
      setNewNote("");
      const timelineRes = await api.getIncidentTimeline(selectedIncident.id);
      setTimeline(timelineRes.data);
      showToast("Timeline note added", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSubmittingNote(false);
    }
  };

  // Link Work Item
  const handleLinkItem = async () => {
    if (!selectedIncident || !selectedWorkItemId) return;
    try {
      setLinkingItem(true);
      const updated = await api.linkIncidentWorkItem(selectedIncident.id, selectedWorkItemId);
      setSelectedIncident(updated);
      setSelectedWorkItemId("");
      const itemsRes = await api.getIncidentLinkedItems(selectedIncident.id);
      setLinkedItems(itemsRes.data);
      const timelineRes = await api.getIncidentTimeline(selectedIncident.id);
      setTimeline(timelineRes.data);
      showToast("Work item linked to incident", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLinkingItem(false);
    }
  };

  // Unlink Work Item
  const handleUnlinkItem = async (itemId: string) => {
    if (!selectedIncident) return;
    try {
      const updated = await api.unlinkIncidentWorkItem(selectedIncident.id, itemId);
      setSelectedIncident(updated);
      setLinkedItems((prev) => prev.filter((i) => i.workItemId !== itemId));
      const timelineRes = await api.getIncidentTimeline(selectedIncident.id);
      setTimeline(timelineRes.data);
      showToast("Work item unlinked", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  // Severity metrics calculation
  const sev1Count = incidents.filter((i) => i.severity === "SEV1" && i.status !== "CLOSED").length;
  const sev2Count = incidents.filter((i) => i.severity === "SEV2" && i.status !== "CLOSED").length;
  const sev3Count = incidents.filter((i) => i.severity === "SEV3" && i.status !== "CLOSED").length;
  const activeCount = incidents.filter((i) => !["RESOLVED", "CLOSED"].includes(i.status)).length;

  return (
    <div className="flex-1 flex flex-col gap-6">
      {/* 1. SEVERITY PULSE RIBBON */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div
          className={`p-4 rounded-xl border relative overflow-hidden transition-all ${
            sev1Count > 0
              ? "bg-rose-950/50 border-rose-600/70 shadow-lg shadow-rose-950/40"
              : "bg-zinc-900/50 border-zinc-800/80"
          }`}
        >
          {sev1Count > 0 && (
            <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
          )}
          <span className="block text-[11px] font-bold text-rose-400 uppercase tracking-wider mb-1">
            SEV1 Critical Outage
          </span>
          <span className="text-3xl font-black text-rose-100">{sev1Count}</span>
        </div>

        <div
          className={`p-4 rounded-xl border relative overflow-hidden transition-all ${
            sev2Count > 0
              ? "bg-amber-950/50 border-amber-600/70 shadow-lg shadow-amber-950/40"
              : "bg-zinc-900/50 border-zinc-800/80"
          }`}
        >
          {sev2Count > 0 && (
            <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
          )}
          <span className="block text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1">
            SEV2 Major Impact
          </span>
          <span className="text-3xl font-black text-amber-100">{sev2Count}</span>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <span className="block text-[11px] font-bold text-yellow-400 uppercase tracking-wider mb-1">
            SEV3 Moderate / SEV4 Low
          </span>
          <span className="text-3xl font-black text-yellow-100">{sev3Count}</span>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80">
          <span className="block text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-1">
            Active Incidents Underway
          </span>
          <span className="text-3xl font-black text-cyan-100">{activeCount}</span>
        </div>
      </div>

      {/* 2. CONTROLS BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            {STATUS_ORDER.map((st) => (
              <option key={st} value={st}>
                {STATUS_BADGES[st].label}
              </option>
            ))}
          </select>

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Severities</option>
            <option value="SEV1">SEV1 (Critical)</option>
            <option value="SEV2">SEV2 (Major)</option>
            <option value="SEV3">SEV3 (Moderate)</option>
            <option value="SEV4">SEV4 (Low)</option>
          </select>

          <button
            onClick={loadIncidents}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh Incidents"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Declare Incident Action Button */}
        <button
          onClick={() => setShowDeclareModal(true)}
          disabled={userRole === "VIEWER"}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
            userRole === "VIEWER"
              ? "bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed"
              : "bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white shadow-rose-900/30 cursor-pointer active:scale-98"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Declare Incident
        </button>
      </div>

      {/* 3. INCIDENTS GRID */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-zinc-500">Loading incident command center...</span>
        </div>
      ) : incidents.length === 0 ? (
        <div className="py-16 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800/60 p-8">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-950/60 border border-emerald-600/40 flex items-center justify-center text-emerald-400 text-xl mb-3">
            ✓
          </div>
          <h3 className="text-base font-bold text-white mb-1">All Systems Operational</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            No active incidents matching the selected filter. Declare an incident above if an unexpected service interruption or performance degradation occurs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {incidents.map((inc) => {
            const sev = SEVERITY_CONFIG[inc.severity];
            const statusConfig = STATUS_BADGES[inc.status];

            return (
              <div
                key={inc.id}
                onClick={() => openIncidentWarRoom(inc)}
                className={`group relative p-5 rounded-2xl border transition-all cursor-pointer hover:border-zinc-500 hover:shadow-xl ${sev.bg} ${sev.border}`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${sev.badge}`}>
                      {inc.severity}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusConfig.color} ${statusConfig.border}`}>
                      {statusConfig.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">
                    v{inc.version}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors mb-2 line-clamp-2">
                  {inc.title}
                </h3>

                {inc.summary && (
                  <p className="text-xs text-zinc-400 line-clamp-2 mb-4 leading-relaxed">
                    {inc.summary}
                  </p>
                )}

                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">Impact:</span>
                    <span className="font-semibold text-zinc-300">
                      {IMPACT_LABELS[inc.impact]}
                    </span>
                  </div>

                  <span className="text-[10px] text-zinc-500">
                    {new Date(inc.declaredAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. WAR ROOM INCIDENT DRAWER */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Drawer Header */}
            <div className="p-6 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-900/60">
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${SEVERITY_CONFIG[selectedIncident.severity].badge}`}>
                    {selectedIncident.severity}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGES[selectedIncident.status].color} ${STATUS_BADGES[selectedIncident.status].border}`}>
                    {STATUS_BADGES[selectedIncident.status].label}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400">
                    Version {selectedIncident.version}
                  </span>
                </div>
                <h2 className="text-lg font-black text-white">{selectedIncident.title}</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Declared {new Date(selectedIncident.declaredAt).toLocaleString()}
                </p>
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Drawer Body - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Lifecycle State Stepper */}
              <div>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Lifecycle Phase
                </h4>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
                  {STATUS_ORDER.map((st, idx) => {
                    const isCurrent = selectedIncident.status === st;
                    const currentIndex = STATUS_ORDER.indexOf(selectedIncident.status);
                    const isPast = idx < currentIndex;

                    return (
                      <span
                        key={st}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                          isCurrent
                            ? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
                            : isPast
                            ? "bg-zinc-800/80 text-zinc-300 border-zinc-700/60"
                            : "bg-zinc-950/60 text-zinc-500 border-zinc-800/60"
                        }`}
                      >
                        {st}
                      </span>
                    );
                  })}
                </div>

                {/* Transition Actions */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedIncident.status === "DECLARED" && (
                    <button
                      onClick={() => handleTransition("INVESTIGATING")}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Begin Investigation &rarr;
                    </button>
                  )}

                  {selectedIncident.status === "INVESTIGATING" && (
                    <>
                      <button
                        onClick={() => handleTransition("IDENTIFIED")}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Root Cause Identified &rarr;
                      </button>
                      <button
                        onClick={() => handleTransition("MITIGATING")}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Fast-Track Mitigation &rarr;
                      </button>
                    </>
                  )}

                  {selectedIncident.status === "IDENTIFIED" && (
                    <button
                      onClick={() => handleTransition("MITIGATING")}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Apply Mitigation &rarr;
                    </button>
                  )}

                  {selectedIncident.status === "MITIGATING" && (
                    <button
                      onClick={() => handleTransition("MONITORING")}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Begin Stability Monitoring &rarr;
                    </button>
                  )}

                  {selectedIncident.status === "MONITORING" && (
                    <>
                      {["LEAD", "ADMIN"].includes(userRole) ? (
                        <button
                          onClick={() => handleTransition("RESOLVED")}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer"
                        >
                          Confirm & Resolve Incident ✓
                        </button>
                      ) : (
                        <span className="text-xs text-amber-400 bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-800/40">
                          Resolution requires Lead or Admin authorization
                        </span>
                      )}
                    </>
                  )}

                  {selectedIncident.status === "RESOLVED" && ["LEAD", "ADMIN"].includes(userRole) && (
                    <button
                      onClick={() => handleTransition("POSTMORTEM")}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Initiate Postmortem Review &rarr;
                    </button>
                  )}

                  {selectedIncident.status === "POSTMORTEM" && ["LEAD", "ADMIN"].includes(userRole) && (
                    <button
                      onClick={() => handleTransition("CLOSED")}
                      className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Close Incident
                    </button>
                  )}
                </div>
              </div>

              {/* Response Team Roster */}
              <div>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Incident Response Team
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedIncident.responders?.map((resp) => (
                    <div
                      key={resp.userId}
                      className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 flex items-center justify-between"
                    >
                      <div>
                        <span className="block text-xs font-bold text-white">{resp.userName}</span>
                        <span className="block text-[10px] text-zinc-500 font-mono">{resp.userEmail}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                        {resp.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mitigation & Postmortem Section */}
              <div className="space-y-3 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  Mitigation & Analysis
                </h4>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Mitigation Notes
                  </label>
                  <textarea
                    rows={3}
                    value={mitigationNotes}
                    onChange={(e) => setMitigationNotes(e.target.value)}
                    placeholder="Document ongoing mitigation steps, rollback procedures, or workarounds..."
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Postmortem URL
                  </label>
                  <input
                    type="url"
                    value={postmortemUrl}
                    onChange={(e) => setPostmortemUrl(e.target.value)}
                    placeholder="https://docs.newtonite.dev/postmortems/inc-01"
                    className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  onClick={handleSaveDetails}
                  disabled={savingDetails}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingDetails ? "Saving..." : "Save Details"}
                </button>
              </div>

              {/* Linked Work Items */}
              <div>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Linked Work Items ({linkedItems.length})
                </h4>

                {/* Link new item control */}
                <div className="flex gap-2 mb-3">
                  <select
                    value={selectedWorkItemId}
                    onChange={(e) => setSelectedWorkItemId(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select a work item to link...</option>
                    {workItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        [{item.priority}] {item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleLinkItem}
                    disabled={!selectedWorkItemId || linkingItem}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {linkingItem ? "Linking..." : "Link Item"}
                  </button>
                </div>

                {linkedItems.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-3 text-center">
                    No work items linked to this incident.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {linkedItems.map((item) => (
                      <div
                        key={item.workItemId}
                        className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 flex items-center justify-between"
                      >
                        <div>
                          <span className="block text-xs font-bold text-white">{item.title}</span>
                          <span className="text-[10px] text-zinc-500">
                            Status: {item.status} | Priority: {item.priority}
                          </span>
                        </div>
                        <button
                          onClick={() => handleUnlinkItem(item.workItemId)}
                          className="text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Incident Audit Timeline */}
              <div>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Audit Timeline & Notes
                </h4>

                {/* Live Note Composer */}
                <form onSubmit={handleAddNote} className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Post observation, mitigation update, or status note..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={!newNote.trim() || submittingNote}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {submittingNote ? "Posting..." : "Post Note"}
                  </button>
                </form>

                {timelineLoading ? (
                  <div className="py-6 text-center text-xs text-zinc-500">Loading timeline...</div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
                    {timeline.map((evt) => (
                      <div key={evt.id} className="relative text-xs">
                        <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-zinc-950" />
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-semibold text-zinc-300">
                            {evt.eventType.replace(/_/g, " ")}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {evt.message && <p className="text-zinc-400">{evt.message}</p>}
                        {evt.actorName && (
                          <span className="text-[10px] text-zinc-500 block mt-0.5">
                            by {evt.actorName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. DECLARE INCIDENT MODAL */}
      {showDeclareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <h3 className="text-base font-bold text-white">Declare New Incident</h3>
              </div>
              <button
                onClick={() => setShowDeclareModal(false)}
                className="text-zinc-500 hover:text-white text-lg cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleDeclareSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Incident Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Primary DB High Replication Lag & Read Degradation"
                  value={declareForm.title}
                  onChange={(e) => setDeclareForm({ ...declareForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Severity
                  </label>
                  <select
                    value={declareForm.severity}
                    onChange={(e) =>
                      setDeclareForm({ ...declareForm, severity: e.target.value as IncidentSeverity })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-rose-500"
                  >
                    <option value="SEV1">SEV1 - Critical Outage</option>
                    <option value="SEV2">SEV2 - Major Degradation</option>
                    <option value="SEV3">SEV3 - Moderate Impact</option>
                    <option value="SEV4">SEV4 - Low / Informational</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Customer Impact
                  </label>
                  <select
                    value={declareForm.impact}
                    onChange={(e) =>
                      setDeclareForm({ ...declareForm, impact: e.target.value as IncidentImpact })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-rose-500"
                  >
                    <option value="TOTAL_OUTAGE">Total Outage</option>
                    <option value="MAJOR_DEGRADATION">Major Degradation</option>
                    <option value="MINOR_DEGRADATION">Minor Degradation</option>
                    <option value="NO_IMPACT">No Customer Impact</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Incident Summary & Known Symptoms
                </label>
                <textarea
                  rows={3}
                  placeholder="Detail observable symptoms, affected microservices, error rates, and initial triage observations..."
                  value={declareForm.summary}
                  onChange={(e) => setDeclareForm({ ...declareForm, summary: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowDeclareModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={declaring || !declareForm.title.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white shadow-lg shadow-rose-900/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {declaring ? "Declaring Incident..." : "Confirm & Declare Incident"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
