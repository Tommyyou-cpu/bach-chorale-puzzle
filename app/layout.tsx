import type { Metadata } from "next";
import "./globals.css";
import "./bach.css";

export const metadata: Metadata = {
  title: "拼出巴赫｜声部盲听挑战",
  description: "从众赞歌、赋格与三声部创意曲片段中，听辨巴赫的原作声部。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "./favicon.svg",
    shortcut: "./favicon.svg",
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
