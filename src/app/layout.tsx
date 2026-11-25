import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Admin", template: "%s" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#e8502a", width: "device-width", initialScale: 1 };

// The only things this app serves are the admin (/adminx) and the Latars landing page, a static file in /public.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
