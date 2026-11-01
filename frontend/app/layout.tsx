import "./globals.css";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { SidebarProvider } from "../components/layout/SidebarContext";
import { AppToaster } from "../components/layout/AppToaster";
import AppLayout from "../components/layout/AppLayout";
import { SentryUserIdentifier } from "../components/providers/SentryUserIdentifier";
import { AuthSessionExpiredHandler } from "../components/providers/AuthSessionExpiredHandler";
import { I18nProvider } from "../components/providers/I18nProvider";
import { LOCALE_COOKIE, resolveLocale } from "../lib/i18n/config";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} data-theme="dark" className={`${geist.variable} ${geistMono.variable}`}>
      <body className={`${geist.className} bg-background text-foreground antialiased`}>
        <I18nProvider initialLocale={locale}>
          <ReactQueryProvider>
            <SidebarProvider>
              <SentryUserIdentifier />
              <AuthSessionExpiredHandler />
              <AppLayout>{children}</AppLayout>
              <AppToaster />
            </SidebarProvider>
          </ReactQueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
