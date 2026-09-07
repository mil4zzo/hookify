import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { SidebarProvider } from "../components/layout/SidebarContext";
import { AppToaster } from "../components/layout/AppToaster";
import AppLayout from "../components/layout/AppLayout";
import { SentryUserIdentifier } from "../components/providers/SentryUserIdentifier";
import { AuthSessionExpiredHandler } from "../components/providers/AuthSessionExpiredHandler";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata = {
  title: "Hookify",
  description: "Hookify Web",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" className={`${geist.variable} ${geistMono.variable}`}>
      <body className={`${geist.className} bg-background text-text antialiased`}>
        <ReactQueryProvider>
          <SidebarProvider>
            <SentryUserIdentifier />
            <AuthSessionExpiredHandler />
            <AppLayout>{children}</AppLayout>
            <AppToaster />
          </SidebarProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
