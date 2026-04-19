import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operations Dashboard",
  description: "Monitor agent activity, system health, and deal pipeline operations.",
};

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
