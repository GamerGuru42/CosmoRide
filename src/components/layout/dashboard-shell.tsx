"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  APP_NAME,
  ROLE_LABELS,
  ROLE_DASHBOARDS,
  DEVELOPER_ATTRIBUTION,
} from "@/lib/constants";
import type { UserRole } from "@/lib/supabase/types";

interface DashboardUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
}

interface DashboardShellProps {
  user: DashboardUser;
  children: React.ReactNode;
}

/**
 * Dashboard shell with sidebar navigation and header.
 * Adapts navigation items based on the user's role.
 */
export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const dashboardPath = ROLE_DASHBOARDS[user.role];

  // Navigation items per role
  const navItems = getNavItems(user.role, dashboardPath);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white font-bold">
            C
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--color-primary)]">
              {APP_NAME}
            </p>
            <p className="text-xs text-gray-500">
              {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== dashboardPath &&
                  pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 px-3 py-3">
          <p className="text-center text-xs text-gray-400">
            {DEVELOPER_ATTRIBUTION}
          </p>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            aria-label="Open sidebar"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          <div className="hidden lg:block" />

          {/* User info & sign out */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user.fullName}
              </p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-white text-sm font-bold">
              {user.fullName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

/**
 * Returns navigation items based on user role.
 */
function getNavItems(
  role: UserRole,
  basePath: string
): { href: string; label: string; icon: string }[] {
  switch (role) {
    case "student":
      return [
        { href: basePath, label: "Dashboard", icon: "🏠" },
        { href: `${basePath}/journeys`, label: "Available Journeys", icon: "🚌" },
        { href: `${basePath}/bookings`, label: "My Bookings", icon: "🎫" },
        { href: `${basePath}/profile`, label: "Profile", icon: "👤" },
      ];
    case "boarding_officer":
      return [
        { href: basePath, label: "Dashboard", icon: "🏠" },
        { href: `${basePath}/boarding`, label: "Boarding", icon: "📋" },
        { href: `${basePath}/passengers`, label: "Passengers", icon: "👥" },
        { href: `${basePath}/profile`, label: "Profile", icon: "👤" },
      ];
    case "driver":
      return [
        { href: basePath, label: "Dashboard", icon: "🏠" },
        { href: `${basePath}/journeys`, label: "My Journeys", icon: "🚌" },
        { href: `${basePath}/profile`, label: "Profile", icon: "👤" },
      ];
    case "admin":
      return [
        { href: basePath, label: "Dashboard", icon: "🏠" },
        { href: `${basePath}/journeys`, label: "Journeys", icon: "🚌" },
        { href: `${basePath}/routes`, label: "Routes", icon: "🗺️" },
        { href: `${basePath}/vehicles`, label: "Fleet", icon: "🚍" },
        { href: `${basePath}/schedules`, label: "Schedules", icon: "📅" },
        { href: `${basePath}/users`, label: "Users", icon: "👥" },
        { href: `${basePath}/reports`, label: "Reports", icon: "📊" },
      ];
  }
}

