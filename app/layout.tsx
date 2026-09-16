import type { Metadata } from "next";
import "./globals.css";
import "./bach.css";

export const metadata: Metadata = {
  title: "拼出巴赫｜四声部盲听挑战",
  description: "四个声部，十六个选项，寻找巴赫的原作。田清新制作。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
