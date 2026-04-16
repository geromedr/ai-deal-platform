"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, PlusCircle, Settings } from "lucide-react";

type NavLink = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
};

const LINKS: NavLink[] = [
  { href: "/",          label: "Feed",     icon: LayoutDashboard, exact: true },
  { href: "/ops",       label: "Ops",      icon: Settings },
  { href: "/deals/new", label: "New Deal", icon: PlusCircle },
];

export default function GlobalNav() {
  const pathname = usePathname();

  function isActive(link: NavLink) {
    if (link.exact) return pathname === link.href;
    return pathname.startsWith(link.href);
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-6 sm:px-10">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
        >
          <Building2 className="size-4 text-primary" />
          <span className="hidden sm:inline">AI Deal Platform</span>
        </Link>

        {/* Spacer */}
        <div className="h-4 w-px bg-border/70 hidden sm:block" />

        {/* Nav links */}
        <nav className="flex items-center gap-0.5">
          {LINKS.map((link) => {
            const active = isActive(link);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
