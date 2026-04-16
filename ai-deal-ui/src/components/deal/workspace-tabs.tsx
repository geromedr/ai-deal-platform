"use client";

import { useState } from "react";

type Tab = "brief" | "financials" | "risks" | "investors" | "timeline" | "reports" | "chat";

const TABS: { id: Tab; label: string }[] = [
  { id: "brief",      label: "Brief" },
  { id: "financials", label: "Financials" },
  { id: "risks",      label: "Risks & Tasks" },
  { id: "investors",  label: "Investors" },
  { id: "timeline",   label: "Timeline" },
  { id: "reports",    label: "Reports" },
  { id: "chat",       label: "Chat" },
];

type WorkspaceTabsProps = {
  brief: React.ReactNode;
  financials: React.ReactNode;
  risks: React.ReactNode;
  investors: React.ReactNode;
  timeline: React.ReactNode;
  reports: React.ReactNode;
  chat: React.ReactNode;
  /** Badge counts shown next to tab labels */
  riskCount?: number;
  taskCount?: number;
};

export default function WorkspaceTabs({
  brief,
  financials,
  risks,
  investors,
  timeline,
  reports,
  chat,
  riskCount = 0,
  taskCount = 0,
}: WorkspaceTabsProps) {
  const [active, setActive] = useState<Tab>("brief");

  const badge = (count: number) =>
    count > 0 ? (
      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
        {count}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/70 bg-background/80 p-1 shadow-sm">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.id === "risks" ? badge(riskCount + taskCount) : null}
              {tab.id === "investors" ? null : null}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {active === "brief"      && brief}
        {active === "financials" && financials}
        {active === "risks"      && risks}
        {active === "investors"  && investors}
        {active === "timeline"   && timeline}
        {active === "reports"    && reports}
        {active === "chat"       && chat}
      </div>
    </div>
  );
}
