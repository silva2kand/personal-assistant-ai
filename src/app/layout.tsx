import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2563eb",
};

export const metadata: Metadata = {
  title: "AI Assistant Pro - Professional Services Management",
  description: "Desktop-style AI Assistant with UK Solicitor, Accountant, Supplier Tracking, Email Integration, and Collaborative AI Agents. Voice and chat enabled.",
  keywords: ["AI Assistant", "UK Solicitor", "UK Accountant", "Supplier Tracking", "Email Management", "AI Agents", "Voice Chat"],
  authors: [{ name: "AI Assistant Pro" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "AI Assistant Pro",
    description: "Professional AI Assistant with multi-agent collaboration",
    type: "website",
  },
  applicationName: "AI Assistant Pro",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Assistant",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
