"use client";

import React, { useState, useEffect, useRef } from "react";
import { User } from "../lib/api";

export interface DemoUserPersona {
  name: string;
  email: string;
  role: "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
  title: string;
  description: string;
  permissions: string[];
  color: string;
}

export const DEMO_PERSONAS: DemoUserPersona[] = [
  {
    name: "Admin User",
    email: "admin@newtonite.dev",
    role: "ADMIN",
    title: "System Administrator",
    description:
      "Full access across team operations and platform controls. Configure SLA policies, manage teams, and exercise all incident commands.",
    permissions: [
      "Manage SLA policies and team config",
      "Command incidents at any severity",
      "Operate queue recovery controls",
    ],
    color: "from-violet-500 to-indigo-600",
  },
  {
    name: "Operations Lead",
    email: "lead@newtonite.dev",
    role: "LEAD",
    title: "Incident Commander",
    description:
      "Coordinate response, approve work, and tune team commitments. Lead-level access to transitions and responder management.",
    permissions: [
      "Approve workflow transitions",
      "Manage incident responders",
      "Configure team SLA targets",
    ],
    color: "from-blue-500 to-cyan-600",
  },
  {
    name: "Operations Member",
    email: "member@newtonite.dev",
    role: "MEMBER",
    title: "Mitigation Engineer",
    description:
      "Claim work, contribute to incident response, and keep the operational timeline current with field-level access.",
    permissions: [
      "Claim and transition work items",
      "Join incident response teams",
      "Add timeline and resolution notes",
    ],
    color: "from-emerald-500 to-teal-600",
  },
  {
    name: "Auditor Viewer",
    email: "viewer@newtonite.dev",
    role: "VIEWER",
    title: "Read-only Auditor",
    description:
      "Review operational state and compliance evidence with all mutation controls withheld. Audit-safe access.",
    permissions: [
      "Review SLA compliance records",
      "Inspect incident findings",
      "Explore dependency relationships",
    ],
    color: "from-amber-500 to-orange-600",
  },
];

const CAPABILITIES = [
  {
    id: "01",
    title: "Work Management",
    tagline: "Governed task flow",
    description:
      "Move team work through a role-governed lifecycle. Claim items atomically to prevent concurrent conflicts. Every transition is recorded in the activity log.",
    detail: "Board & list views Â· atomic claims Â· role gates",
    span: "lg:col-span-7",
    accent: "bg-indigo-600",
    dot: "bg-indigo-400",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  {
    id: "02",
    title: "Incident Command",
    tagline: "Coordinated response",
    description:
      "Coordinate commanders and responders through incident lifecycle changes, a chronological timeline, linked mitigation work, and postmortem tracking.",
    detail: "SEV1â€“SEV4 Â· responder roles Â· timeline",
    span: "lg:col-span-5",
    accent: "bg-rose-600",
    dot: "bg-rose-400",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
  },
  {
    id: "03",
    title: "SLA Risk Engine",
    tagline: "Commitment tracking",
    description:
      "Track response and resolution commitments against team policy. Surface explicit on-track, at-risk, and breached states with breach evidence.",
    detail: "Policy-based targets Â· breach records",
    span: "lg:col-span-4",
    accent: "bg-amber-500",
    dot: "bg-amber-400",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    id: "04",
    title: "Queue Recovery",
    tagline: "Resilient background jobs",
    description:
      "Inspect failed and completed jobs, exercise controlled failure scenarios, and retry recoverable work directly from the operations console.",
    detail: "Failure scenarios Â· retry controls Â· queue health",
    span: "lg:col-span-4",
    accent: "bg-cyan-600",
    dot: "bg-cyan-400",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  {
    id: "05",
    title: "Incident Intelligence",
    tagline: "Explainable risk scoring",
    description:
      "Evidence-backed severity assessments with contributing factors, affected scope, and recommended next actions attached to each incident finding.",
    detail: "Deterministic scoring Â· evidence-led findings",
    span: "lg:col-span-4",
    accent: "bg-violet-600",
    dot: "bg-violet-400",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    id: "06",
    title: "Dependency & Blast Radius",
    tagline: "Impact visualization",
    description:
      "Explore incident-linked work items and shared-assignee relationships in a relationship graph built entirely from recorded product data.",
    detail: "Direct links Â· shared-assignee context Â· graph view",
    span: "lg:col-span-12",
    accent: "bg-emerald-600",
    dot: "bg-emerald-400",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Track work",
    body: "Assign ownership and move tasks through governed lifecycle states with role-based access controls.",
    num: "text-indigo-600",
    border: "border-indigo-200",
    bg: "bg-indigo-50",
  },
  {
    step: "02",
    title: "Command response",
    body: "Coordinate incident roles, live updates, and mitigation work through a structured command interface.",
    num: "text-rose-600",
    border: "border-rose-200",
    bg: "bg-rose-50",
  },
  {
    step: "03",
    title: "Evaluate SLAs",
    body: "See team commitments and surface emerging SLA risk before thresholds are breached.",
    num: "text-amber-600",
    border: "border-amber-200",
    bg: "bg-amber-50",
  },
  {
    step: "04",
    title: "Recover jobs",
    body: "Inspect queue failures and selectively retry recoverable background work without leaving the ops console.",
    num: "text-cyan-600",
    border: "border-cyan-200",
    bg: "bg-cyan-50",
  },
  {
    step: "05",
    title: "Explain incidents",
    body: "Read evidence-backed severity findings with contributing factors and recommended next actions.",
    num: "text-violet-600",
    border: "border-violet-200",
    bg: "bg-violet-50",
  },
  {
    step: "06",
    title: "Explore impact",
    body: "Follow recorded item links and workload relationships to understand the full operational blast radius.",
    num: "text-emerald-600",
    border: "border-emerald-200",
    bg: "bg-emerald-50",
  },
];

const STACK = [
  {
    layer: "Application",
    items: ["Next.js App Router", "React 19", "TypeScript", "Tailwind CSS"],
    accent: "text-indigo-600",
  },
  {
    layer: "API",
    items: ["Express", "TypeScript", "Zod validation", "JWT authentication"],
    accent: "text-blue-600",
  },
  {
    layer: "Data",
    items: ["PostgreSQL", "Drizzle ORM", "Supabase", "Transactional writes"],
    accent: "text-emerald-600",
  },
  {
    layer: "Background",
    items: ["Redis", "BullMQ", "Transactional outbox", "Retry queues"],
    accent: "text-amber-600",
  },
];

interface LandingPageProps {
  onLogin: (email: string) => Promise<void>;
  isLoggingIn: boolean;
  authError: string | null;
  currentUser?: User | null;
  onReturnToConsole?: () => void;
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-black tracking-tight shadow-sm ${
        light
          ? "bg-white text-slate-950 shadow-slate-300/60"
          : "bg-slate-950 text-white"
      }`}
      aria-hidden="true"
    >
      N<span className="text-indigo-400">.</span>
    </span>
  );
}

function SectionLabel({
  children,
  light = false,
}: {
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <p
      className={`inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] ${
        light ? "text-indigo-300" : "text-indigo-700"
      }`}
    >
      <span className={`h-px w-5 ${light ? "bg-indigo-400" : "bg-indigo-500"}`} />
      {children}
    </p>
  );
}

function AnimatedCounter({
  end,
  suffix = "",
}: {
  end: number;
  suffix?: string;
}) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1100;
          let startTs: number | null = null;
          const tick = (ts: number) => {
            if (!startTs) startTs = ts;
            const p = Math.min((ts - startTs) / duration, 1);
            setVal(Math.floor(p * end));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end]);

  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  );
}

function NavBar({
  currentUser,
  onReturnToConsole,
}: {
  currentUser?: User | null;
  onReturnToConsole?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <a
          href="#top"
          className="flex items-center gap-2.5"
          aria-label="Newtonite home"
        >
          <Logo />
          <span className="text-[15px] font-black tracking-[-0.04em] text-slate-950">
            NEWTONITE
          </span>
        </a>

        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-7 md:flex"
        >
          {(
            [
              ["Platform", "#platform"],
              ["Capabilities", "#capabilities"],
              ["Architecture", "#architecture"],
              ["Demo", "#demo"],
            ] as [string, string][]
          ).map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-[13px] font-medium text-slate-600 transition-colors hover:text-indigo-700"
            >
              {label}
            </a>
          ))}
        </nav>

        {currentUser && onReturnToConsole ? (
          <button
            onClick={onReturnToConsole}
            className="flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Back to console
          </button>
        ) : (
          <a
            href="#demo"
            className="rounded-lg bg-slate-950 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700"
          >
            Launch demo →
          </a>
        )}
      </div>
    </header>
  );
}

function ProductMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[660px]">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[48px] bg-gradient-to-br from-indigo-100 via-white to-cyan-100 opacity-80 blur-3xl" />
      {/* Border gradient */}
      <div className="absolute -inset-px -z-10 rounded-[22px] bg-gradient-to-br from-indigo-300 via-slate-200 to-cyan-300 opacity-70" />

      <div className="overflow-hidden rounded-[20px] border border-slate-700 bg-[#0d1117] shadow-[0_56px_130px_-30px_rgba(0,0,0,0.65)]">
        {/* Window chrome */}
        <div className="flex items-center justify-between border-b border-white/[.07] bg-[#161b22] px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-rose-500/70" />
              <span className="h-3 w-3 rounded-full bg-amber-400/70" />
              <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-white/[.05] bg-white/[.03] px-2.5 py-1 text-[11px] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              newtonite.dev/console
            </div>
          </div>
          <span className="rounded border border-white/10 px-2 py-0.5 font-mono text-[9px] text-slate-600">
            PREVIEW
          </span>
        </div>

        {/* App nav strip */}
        <div className="flex items-center justify-between border-b border-white/[.05] bg-[#0d1117] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-indigo-600 text-[11px] font-black text-white">
              N
            </span>
            <span className="text-[11px] font-bold tracking-tight text-white">
              NEWTONITE
            </span>
          </div>
          <div className="hidden items-center gap-4 text-[10px] text-slate-500 sm:flex">
            {["Overview", "Work", "Incidents", "Reliability"].map((t) => (
              <span
                key={t}
                className={t === "Overview" ? "font-semibold text-white" : ""}
              >
                {t}
              </span>
            ))}
          </div>
          <span className="h-6 w-6 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600" />
        </div>

        {/* Dashboard content */}
        <div className="p-4 sm:p-5">
          {/* Metric row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Work Items", value: "24", sub: "+3 today" },
              { label: "Active Incidents", value: "2", sub: "SEV2, SEV3" },
              { label: "SLA Health", value: "94%", sub: "1 at risk" },
              { label: "Queue Jobs", value: "847", sub: "99.8% ok" },
            ].map(({ label, value, sub }) => (
              <div
                key={label}
                className="rounded-lg border border-white/[.06] bg-white/[.03] p-3"
              >
                <p className="text-[9px] font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
                <p className="mt-0.5 text-[9px] text-slate-600">{sub}</p>
              </div>
            ))}
          </div>

          {/* Work + Incidents split */}
          <div className="mt-3 grid gap-3 sm:grid-cols-[1.5fr_.5fr]">
            <div className="rounded-lg border border-white/[.06] bg-white/[.025] p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-200">
                  Work queue
                </span>
                <span className="text-[9px] text-slate-600">Board view</span>
              </div>
              <div className="divide-y divide-white/[.04]">
                {[
                  ["IN PROGRESS", "text-cyan-400", "bg-cyan-400"],
                  ["AWAITING APPROVAL", "text-amber-400", "bg-amber-400"],
                  ["OPEN", "text-slate-400", "bg-slate-500"],
                ].map(([state, color, dot]) => (
                  <div
                    key={state}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                      <span className="text-[9px] text-slate-500">
                        Critical work item
                      </span>
                    </div>
                    <span className={`font-mono text-[8px] font-bold ${color}`}>
                      {state}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/[.06] bg-white/[.025] p-3">
              <span className="text-[10px] font-semibold text-slate-200">
                Incidents
              </span>
              <div className="mt-3 space-y-2">
                {[
                  { sev: "SEV2", label: "DB latency", bg: "bg-rose-600" },
                  { sev: "SEV3", label: "API spike", bg: "bg-amber-500" },
                ].map(({ sev, label, bg }) => (
                  <div
                    key={sev}
                    className="flex items-center gap-2 rounded border border-white/[.04] bg-white/[.02] px-2 py-1.5"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[8px] font-black text-white ${bg}`}
                    >
                      {sev}
                    </span>
                    <span className="text-[9px] text-slate-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SLA bar */}
          <div className="mt-3 rounded-lg border border-white/[.06] bg-white/[.025] px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-200">
                SLA compliance
              </span>
              <span className="text-[9px] font-bold text-emerald-400">94%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                style={{ width: "94%" }}
              />
            </div>
            <p className="mt-2 text-[9px] text-slate-600">
              Preview only. Live data loads from the API after authentication.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Main Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function LandingPage({
  onLogin,
  isLoggingIn,
  authError,
  currentUser,
  onReturnToConsole,
}: LandingPageProps) {
  return (
    <div
      className="landing-page min-h-screen bg-white text-slate-900 selection:bg-indigo-100 selection:text-indigo-900"
      style={{ fontFamily: "var(--font-geist-sans, system-ui, sans-serif)" }}
    >
      <NavBar currentUser={currentUser} onReturnToConsole={onReturnToConsole} />

      <main id="top">
        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ HERO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section
          id="platform"
          className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50 pb-0 pt-28 sm:pt-36"
        >
          {/* Grid bg */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-[.035]"
            style={{
              backgroundImage:
                "linear-gradient(#94a3b8 1px, transparent 1px),linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="pointer-events-none absolute -left-40 -top-40 -z-10 h-[700px] w-[700px] rounded-full bg-indigo-100 opacity-50 blur-[110px]" />

          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            {/* Badge */}
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                Operations under pressure â€” v1.0
              </span>
            </div>

            {/* Headline */}
            <h1 className="mx-auto mt-7 max-w-4xl text-center text-[2.4rem] font-black leading-[1.05] tracking-[-0.055em] text-slate-950 sm:text-5xl md:text-[4.2rem]">
              Keep critical work moving{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
                when the pressure is on.
              </span>
            </h1>

            {/* Sub headline */}
            <p className="mx-auto mt-6 max-w-2xl text-center text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Newtonite connects work queues, incident command, SLA commitments,
              and failure recovery in one role-aware operations workspace.
            </p>

            {/* CTAs */}
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              {currentUser && onReturnToConsole ? (
                <button
                  onClick={onReturnToConsole}
                  className="group flex items-center gap-2 rounded-xl bg-indigo-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-800 hover:shadow-indigo-300"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Resume {currentUser.name}&apos;s session
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              ) : (
                <a
                  href="#demo"
                  className="group flex items-center gap-2 rounded-xl bg-indigo-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-800 hover:shadow-indigo-300"
                >
                  Launch Demo Console
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                </a>
              )}
              <a
                href="#capabilities"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:shadow"
              >
                Explore capabilities
              </a>
            </div>

            {/* Trust strip */}
            <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-[11px] font-medium text-slate-400">
              {[
                "Role-governed workflows",
                "Evidence-backed analysis",
                "Recorded operational activity",
                "Atomic concurrency control",
              ].map((b) => (
                <span key={b} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Product mockup */}
          <div className="relative mx-auto mt-16 max-w-5xl px-5 sm:px-8">
            <ProductMockup />
            <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-white to-transparent" />
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ METRICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="border-b border-slate-100 bg-white py-14">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid grid-cols-2 gap-10 text-center md:grid-cols-4">
              {[
                { end: 6, suffix: "", label: "Integrated modules" },
                { end: 4, suffix: "", label: "RBAC permission levels" },
                { end: 100, suffix: "%", label: "Type-safe API surface" },
                { end: 0, suffix: " downtime", label: "During failover demo" },
              ].map(({ end, suffix, label }) => (
                <div key={label}>
                  <p className="text-4xl font-black tracking-tight text-slate-950">
                    <AnimatedCounter end={end} suffix={suffix} />
                  </p>
                  <p className="mt-2 text-[12px] font-medium text-slate-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CAPABILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section
          id="capabilities"
          className="border-b border-slate-100 bg-slate-50/60 py-20 sm:py-28"
        >
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-6 pb-10 md:grid-cols-[.65fr_1.35fr] md:items-end">
              <div>
                <SectionLabel>Platform</SectionLabel>
                <h2 className="mt-4 text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-4xl">
                  From daily work to incident recovery.
                </h2>
              </div>
              <p className="max-w-lg text-base leading-7 text-slate-600">
                Six production-ready modules built around recorded team data.
                Every decision, dependency and commitment is grounded in actual
                database state â€” not mock data.
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-12">
              {CAPABILITIES.map((cap) => (
                <article
                  key={cap.id}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-7 ${cap.span}`}
                >
                  <div className={`absolute left-0 top-0 h-1 w-full rounded-t-2xl ${cap.accent}`} />
                  <div className="flex items-start justify-between gap-4 pt-1">
                    <div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${cap.badge}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${cap.dot}`} />
                        {cap.tagline}
                      </span>
                      <h3 className="mt-4 text-xl font-bold tracking-[-0.03em] text-slate-950">
                        {cap.title}
                      </h3>
                    </div>
                    <span className="shrink-0 font-mono text-3xl font-black text-slate-100 transition-colors group-hover:text-slate-200">
                      {cap.id}
                    </span>
                  </div>
                  <div className="mt-5">
                    <p className="text-sm leading-6 text-slate-600">
                      {cap.description}
                    </p>
                    <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] font-medium text-slate-400">
                      {cap.detail}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ HOW IT WORKS (dark) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="relative overflow-hidden bg-slate-950 py-20 sm:py-28">
          <div
            className="pointer-events-none absolute inset-0 opacity-[.04]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="pointer-events-none absolute -right-40 top-0 h-[500px] w-[500px] rounded-full bg-indigo-900 opacity-30 blur-[120px]" />

          <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 md:grid-cols-[.55fr_1.45fr] md:items-start">
              <div>
                <SectionLabel light>Workflow</SectionLabel>
                <h2 className="mt-5 text-3xl font-black leading-tight tracking-[-0.04em] text-white sm:text-4xl">
                  A shared operational picture, step by step.
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  Each module feeds into the next â€” creating a connected view of
                  operations from initial task to incident resolution.
                </p>
              </div>

              <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {HOW_IT_WORKS.map(({ step, title, body, num, border, bg }) => (
                  <li
                    key={step}
                    className="group rounded-xl border border-white/[.07] bg-white/[.04] p-5 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/[.07]"
                  >
                    <div
                      className={`mb-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${border} ${bg} font-mono text-[11px] font-bold ${num}`}
                    >
                      {step}
                    </div>
                    <h3 className="text-sm font-bold text-white">{title}</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ARCHITECTURE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section
          id="architecture"
          className="border-b border-slate-100 bg-white py-20 sm:py-28"
        >
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-16 md:grid-cols-[.6fr_1.4fr] md:items-start">
              <div>
                <SectionLabel>Architecture</SectionLabel>
                <h2 className="mt-4 text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-4xl">
                  Built for accountable operations.
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  A fully typed web client, validated API boundaries, relational
                  data integrity, and transactional background processing â€” all
                  wired together to support the product workflows.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {STACK.map(({ layer, items, accent }) => (
                  <div
                    key={layer}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                  >
                    <p className={`text-[11px] font-bold uppercase tracking-widest ${accent}`}>
                      {layer}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {items.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-sm font-medium text-slate-700"
                        >
                          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DEMO PERSONAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section
          id="demo"
          className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-slate-50 py-20 sm:py-28"
        >
          <div className="pointer-events-none absolute -left-40 top-10 h-[400px] w-[400px] rounded-full bg-indigo-100 opacity-60 blur-[90px]" />

          <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <SectionLabel>Guided Demo</SectionLabel>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-4xl">
                Choose a role and explore.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-slate-600">
                Each persona opens the same console with permissions enforced at
                the API layer â€” nothing is mocked.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="mx-auto mt-8 max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700"
              >
                <strong>Login error:</strong> {authError}
              </div>
            )}

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {DEMO_PERSONAS.map((persona) => (
                <article
                  key={persona.email}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                >
                  <div className={`h-1.5 w-full bg-gradient-to-r ${persona.color}`} />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-[15px] font-bold text-slate-950">
                          {persona.name}
                        </h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {persona.title}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold text-slate-600">
                        {persona.role}
                      </span>
                    </div>

                    <p className="mt-4 flex-1 text-[13px] leading-5 text-slate-600">
                      {persona.description}
                    </p>

                    <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4">
                      {persona.permissions.map((perm) => (
                        <li key={perm} className="flex items-start gap-2 text-[11px] text-slate-600">
                          <span
                            className={`mt-0.5 grid h-3.5 w-3.5 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br text-[8px] font-bold text-white ${persona.color}`}
                          >
                            âœ“
                          </span>
                          {perm}
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={() => void onLogin(persona.email)}
                      disabled={isLoggingIn}
                      className={`mt-6 flex w-full items-center justify-between rounded-xl bg-gradient-to-r px-4 py-3 text-[13px] font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:shadow disabled:cursor-wait disabled:opacity-60 ${persona.color}`}
                    >
                      <span>
                        {isLoggingIn ? "Opening consoleâ€¦" : `Enter as ${persona.role}`}
                      </span>
                      <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                        →
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-8 text-center text-[11px] text-slate-400">
              Demo access is available in non-production environments. API
              permissions are enforced server-side per role.
            </p>
          </div>
        </section>

        {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ FINAL CTA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="relative overflow-hidden bg-slate-950 py-20 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_60%_50%,rgba(99,102,241,.15),transparent_70%)]" />
          <div className="relative mx-auto max-w-3xl px-5 text-center sm:px-8">
            <SectionLabel light>Newtonite Â· Operations Under Pressure</SectionLabel>
            <h2 className="mx-auto mt-5 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">
              Bring the next response into focus.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-400">
              Six integrated modules, one shared operational picture â€” from work
              queue to incident command and back.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              {currentUser && onReturnToConsole ? (
                <button
                  onClick={onReturnToConsole}
                  className="rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-slate-950 shadow transition-all hover:bg-indigo-50"
                >
                  Return to console →
                </button>
              ) : (
                <a
                  href="#demo"
                  className="rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-slate-950 shadow transition-all hover:bg-indigo-50"
                >
                  Launch Demo Console →
                </a>
              )}
              <a
                href="#capabilities"
                className="rounded-xl border border-white/20 px-7 py-3.5 text-sm font-semibold text-slate-300 transition-all hover:border-white/40 hover:text-white"
              >
                View capabilities
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ FOOTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <footer className="bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-white/[.07] px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo light />
            <div>
              <span className="block text-[13px] font-black tracking-tight text-white">
                NEWTONITE
              </span>
              <span className="text-[10px] text-slate-500">
                Operations under pressure
              </span>
            </div>
          </div>

          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-5 text-[12px] font-medium text-slate-500"
          >
            {(
              [
                ["Platform", "#platform"],
                ["Capabilities", "#capabilities"],
                ["Architecture", "#architecture"],
                ["Demo", "#demo"],
              ] as [string, string][]
            ).map(([label, href]) => (
              <a key={href} href={href} className="transition-colors hover:text-slate-200">
                {label}
              </a>
            ))}
          </nav>

          <p className="text-[11px] text-slate-600">
            Work management · Incident operations · Reliability
          </p>
        </div>
      </footer>
    </div>
  );
}
