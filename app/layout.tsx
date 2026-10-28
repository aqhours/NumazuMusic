import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "NumazuMusic｜Aqours 日语歌词读本",
  description: "在旋律里读懂 Aqours：逐字同步、日语分词、假名注音、罗马音与中文释义。",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" }, shortcut: "/favicon.svg" },
};

const themeBootScript = `(() => {
  try {
    const saved = localStorage.getItem("numazumusic-theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();`;

const umamiWebsiteId = "869d44f0-dcf2-4693-93bb-76dcd5a53226";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Shared App Router root layout loads these fonts on every page. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@500&family=Noto+Sans+JP:wght@100..900&family=Noto+Sans+SC:wght@100..900&family=Noto+Serif+SC:wght@200..900&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script
          defer
          src="https://analytics.aqhours.cn/script.js"
          data-website-id={umamiWebsiteId}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
