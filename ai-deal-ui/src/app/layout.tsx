import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import GlobalNav from "@/components/layout/global-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Deal Platform",
    template: "%s — AI Deal Platform",
  },
  description:
    "AI-powered deal analysis platform for property investment — score, financials, risks, and investor matching in one workspace.",
  openGraph: {
    type: "website",
    siteName: "AI Deal Platform",
    title: "AI Deal Platform",
    description:
      "AI-powered deal analysis platform for property investment — score, financials, risks, and investor matching in one workspace.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <GlobalNav />
        {children}
      </body>
    </html>
  );
}
