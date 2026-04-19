import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Deal — AI Deal Platform",
  description: "Submit a new property address to begin AI-powered deal analysis.",
};

export default function NewDealLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
