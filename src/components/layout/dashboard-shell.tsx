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
import { StudentNav } from "./student-nav";

interface DashboardUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
  studentId?: string | null;
}

interface DashboardShellProps {
  user: DashboardUser;
  children: React.ReactNode;
}

/**
 * Dashboard shell with role-adaptive navigation.
 * - For students: renders the modern mobile bottom bar + desktop top navigation layout.
 * - For operational staff (drivers, boarding officers, admins): renders the operational sidebar.
 */
export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // If student, use the dedicated student experience shell
  if (user.role === "student") {
    return <StudentNav user={user}>{children}</StudentNav>;
  }

  const dashboardPath = ROLE_DASHBOARDS[user.role];
  const navItems = getNavItems(user.role, dashboardPath);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Staff Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#102D4A] text-white font-bold">
            C
          </div>
          <div>
            <p className="text-sm font-bold text-[#102D4A] tracking-wider">
              {APP_NAME}
            </p>
            <p className="text-xs text-[#526B82]">
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
                (item.href !== dashboardPath && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#102D4A] text-white"
                        : "text-[#526B82] hover:bg-slate-100 hover:text-[#102D4A]"
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
        <div className="border-t border-slate-200 px-3 py-3">
          <p className="text-center text-xs text-[#526B82]">
            {DEVELOPER_ATTRIBUTION}
          </p>
        </div>
      </aside>

      {/* Staff Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-[#526B82] hover:bg-slate-100 lg:hidden"
            aria-label="Open sidebar"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="hidden lg:block" />

          {/* User info & sign out */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-[#102D4A]">
                {user.fullName}
              </p>
              <p className="text-xs text-[#526B82]">{user.email}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#102D4A] text-white text-sm font-bold">
              {user.fullName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm text-[#526B82] hover:bg-slate-100 hover:text-[#D9534F] transition-colors"
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

function getNavItems(
  role: UserRole,
  basePath: string
): { href: string; label: string; icon: string }[] {
  switch (role) {
    case "student":
      return [];
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
