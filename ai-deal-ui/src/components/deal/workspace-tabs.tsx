"use client";

import { useCallback, useRef, useState } from "react";

type Tab = "brief" | "financials" | "risks" | "investors" | "emails" | "timeline" | "reports" | "chat";

const TABS: { id: Tab; label: string }[] = [
  { id: "brief",      label: "Brief" },
  { id: "financials", label: "Financials" },
  { id: "risks",      label: "Risks & Tasks" },
  { id: "investors",  label: "Investors" },
  { id: "emails",     label: "Emails" },
  { id: "timeline",   label: "Timeline" },
  { id: "reports",    label: "Reports" },
  { id: "chat",       label: "Chat" },
];

type WorkspaceTabsProps = {
  brief: React.ReactNode;
  financials: React.ReactNode;
  risks: React.ReactNode;
  investors: React.ReactNode;
  emails: React.ReactNode;
  timeline: React.ReactNode;
  reports: React.ReactNode;
  chat: React.ReactNode;
  /** Badge counts shown next to tab labels */
  riskCount?: number;
  taskCount?: number;
  emailCount?: number;
};

export default function WorkspaceTabs({
  brief,
  financials,
  risks,
  investors,
  emails,
  timeline,
  reports,
  chat,
  riskCount = 0,
  taskCount = 0,
  emailCount = 0,
}: WorkspaceTabsProps) {
  const [active, setActive] = useState<Tab>("brief");
  const tabRefs = useRef<Map<Tab, HTMLButtonElement>>(new Map());

  const badge = (count: number) =>
    count > 0 ? (
      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
        {count}
      </span>
    ) : null;

  const focusTab = useCallback((id: Tab) => {
    tabRefs.current.get(id)?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, currentIndex: number) {
    const tabs = TABS;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = tabs[(currentIndex + 1) % tabs.length];
      setActive(next.id);
      focusTab(next.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
      setActive(prev.id);
      focusTab(prev.id);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(tabs[0].id);
      focusTab(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = tabs[tabs.length - 1];
      setActive(last.id);
      focusTab(last.id);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Deal workspace sections"
        className="flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/70 bg-background/80 p-1 shadow-sm"
      >
        {TABS.map((tab, index) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.id === "risks" ? badge(riskCount + taskCount) : null}
              {tab.id === "emails" ? badge(emailCount) : null}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      {TABS.map((tab) => {
        const content = {
          brief,
          financials,
          risks,
          investors,
          emails,
          timeline,
          reports,
          chat,
        }[tab.id];

        return (
          <div
            key={tab.id}
            id={`panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab.id}`}
            tabIndex={0}
            hidden={active !== tab.id}
            className="outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl"
          >
            {active === tab.id ? content : null}
          </div>
        );
      })}
    </div>
  );
}
