"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useAuthManager } from "@/lib/hooks/useAuthManager";
import { BarChart3, Menu, X, LogOut, User, Settings } from "lucide-react";

export default function Topbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { handleLogout } = useAuthManager();
  const router = useRouter();

  const handleLogoutClick = () => {
    handleLogout();
    router.push("/login");
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  if (!isClient) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-surface2 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-8 w-8 text-brand" />
            <span className="text-xl font-bold">Hookify</span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-surface2 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <BarChart3 className="h-8 w-8 text-brand" />
          <span className="text-xl font-bold">Hookify</span>
        </Link>

        {/* Desktop Navigation */}
        {isAuthenticated && (
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/ads-loader" className="text-sm font-medium text-muted hover:text-text transition-colors">
              ADs Loader
            </Link>
            <Link href="/dashboard" className="text-sm font-medium text-muted hover:text-text transition-colors">
              Dashboard
            </Link>
            <Link href="/rankings" className="text-sm font-medium text-muted hover:text-text transition-colors">
              Rankings
            </Link>
            <Link href="/api-test" className="text-sm font-medium text-muted hover:text-text transition-colors">
              API Test
            </Link>
          </nav>
        )}

        {/* User Section */}
        <div className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <>
              {/* Desktop User Info */}
              <div className="hidden md:flex items-center gap-3">
                {user.picture?.data?.url && <img src={user.picture.data.url} alt="Profile" className="w-8 h-8 rounded-full" />}
                <div className="text-sm">
                  <p className="font-medium">{user.name}</p>
                  <p className="text-muted text-xs">{user.email}</p>
                </div>
              </div>

              {/* Desktop Logout */}
              <Button variant="outline" size="sm" onClick={handleLogoutClick} className="hidden md:flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                Sair
              </Button>

              {/* Mobile Menu Button */}
              <Button variant="outline" size="sm" onClick={toggleMobileMenu} className="md:hidden">
                {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href="/login">Entrar</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Menu */}
      {isAuthenticated && isMobileMenuOpen && (
        <div className="md:hidden border-t border-surface2 bg-bg">
          <div className="container mx-auto px-4 py-4 space-y-4">
            {/* User Info */}
            <div className="flex items-center gap-3 pb-4 border-b border-surface2">
              {user?.picture?.data?.url && <img src={user.picture.data.url} alt="Profile" className="w-10 h-10 rounded-full" />}
              <div>
                <p className="font-medium">{user?.name}</p>
                <p className="text-muted text-sm">{user?.email}</p>
              </div>
            </div>

            {/* Navigation Links */}
            <nav className="space-y-2">
              <Link href="/ads-loader" className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface2 transition-colors" onClick={closeMobileMenu}>
                <BarChart3 className="h-5 w-5" />
                <span>ADs Loader</span>
              </Link>
              <Link href="/dashboard" className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface2 transition-colors" onClick={closeMobileMenu}>
                <BarChart3 className="h-5 w-5" />
                <span>Dashboard</span>
              </Link>
              <Link href="/rankings" className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface2 transition-colors" onClick={closeMobileMenu}>
                <BarChart3 className="h-5 w-5" />
                <span>Rankings</span>
              </Link>
              <Link href="/api-test" className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface2 transition-colors" onClick={closeMobileMenu}>
                <BarChart3 className="h-5 w-5" />
                <span>API Test</span>
              </Link>
            </nav>

            {/* Logout Button */}
            <Button variant="outline" onClick={handleLogoutClick} className="w-full flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
