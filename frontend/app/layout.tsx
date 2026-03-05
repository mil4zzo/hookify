import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { SidebarProvider } from "../components/layout/SidebarContext";
import { Toaster } from "sonner";
import AppLayout from "../components/layout/AppLayout";
import { SentryUserIdentifier } from "../components/providers/SentryUserIdentifier";

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
            <AppLayout>{children}</AppLayout>
            <Toaster
              position="bottom-right"
              richColors
              theme="dark"
              expand={true}
              visibleToasts={5}
              gap={8}
            />
          </SidebarProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
