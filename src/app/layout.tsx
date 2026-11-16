import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Google Fonts をビルド時に取りに行くと失敗する（2026-11-09 の Deployment Failed）ため、
// 同じ Noto Sans JP（latin・可変ウェイト）をリポジトリ内のファイルから読む。見た目は同じ。
const notoSansJP = localFont({
  src: "./fonts/NotoSansJP-latin.woff2",
  variable: "--font-noto-sans-jp",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ハイアルチ 業績ダッシュボード",
  description: "ハイアルチ 店舗業績管理ダッシュボード",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} h-full`}>
      <body className="min-h-full flex flex-col font-[var(--font-noto-sans-jp)] antialiased">
        {children}
      </body>
    </html>
  );
}
