import type { Metadata } from "next";

import "./globals.css";

import "@livekit/components-styles";

import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Chat",
  description: "Real-time chat with audio and video calls",
};

/** Runs before first paint so the saved (or system) theme is applied without a flash. */
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
