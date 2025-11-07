import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { SidebarProvider } from "../components/layout/SidebarContext";
import { Toaster } from "sonner";
import Topbar from "../components/layout/Topbar";
import { PacksLoader } from "../components/layout/PacksLoader";
import Sidebar from "../components/layout/Sidebar";
import LayoutContent from "../components/layout/LayoutContent";
import BottomNavigationBar from "../components/layout/BottomNavigationBar";

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
            <PacksLoader>
              <Sidebar />
              <LayoutContent>
                <Topbar />
                <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-8 py-8 pb-20 md:pb-8">{children}</main>
              </LayoutContent>
            </PacksLoader>
          </SidebarProvider>
          <BottomNavigationBar />
          <Toaster position="top-right" richColors theme="dark" />
        </ReactQueryProvider>
      </body>
    </html>
  );
}
