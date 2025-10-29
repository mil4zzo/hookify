import "./globals.css";
import { ReactQueryProvider } from "../components/providers/ReactQueryProvider";
import { Toaster } from "sonner";
import Topbar from "../components/layout/Topbar";

export const metadata = {
  title: "Hookify",
  description: "Hookify Web",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark">
      <body className="bg-bg text-text antialiased">
        <ReactQueryProvider>
          <Topbar />
          <main className="min-h-screen">{children}</main>
          <Toaster position="top-right" richColors theme="dark" />
        </ReactQueryProvider>
      </body>
    </html>
  );
}
