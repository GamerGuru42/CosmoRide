"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  APP_NAME,
  UNIVERSITY_NAME,
  STUDENT_NAV_ITEMS,
} from "@/lib/constants";
import {
  HomeIcon,
  BusIcon,
  TicketIcon,
  BellIcon,
  UserIcon,
} from "@/components/ui/icons";

interface StudentNavProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    studentId?: string | null;
  };
  children: React.ReactNode;
}

export function StudentNav({ user, children }: StudentNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function getIcon(key: string, isActive: boolean) {
    const className = `w-5 h-5 transition-transform ${isActive ? "scale-110 text-[#102D4A]" : "text-[#526B82]"}`;
    switch (key) {
      case "home":
        return <HomeIcon className={className} />;
      case "departures":
        return <BusIcon className={className} />;
      case "trips":
        return <TicketIcon className={className} />;
      case "notifications":
        return <BellIcon className={className} />;
      case "profile":
        return <UserIcon className={className} />;
      default:
        return <BusIcon className={className} />;
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8FA] flex flex-col">
      {/* Desktop Top Navigation Bar */}
      <header className="hidden md:block sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Brand Identity */}
          <Link href="/student" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-[#102D4A] flex items-center justify-center text-white font-bold tracking-tight text-lg shadow-sm">
              CR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-wider text-[#102D4A] text-base font-mono">
                  {APP_NAME}
                </span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[#20A477]/10 text-[#20A477] tracking-wider">
                  Student
                </span>
              </div>
              <p className="text-[11px] text-[#526B82] leading-tight font-medium">
                {UNIVERSITY_NAME}
              </p>
            </div>
          </Link>

          {/* Desktop Navigation Tabs */}
          <nav className="flex items-center gap-1">
            {STUDENT_NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/student"
                  ? pathname === "/student"
                  : pathname.startsWith(item.href) ||
                    (item.href === "/student/departures" && pathname.startsWith("/student/journeys")) ||
                    (item.href === "/student/trips" && pathname.startsWith("/student/bookings"));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-[#102D4A] text-white shadow-xs"
                      : "text-[#526B82] hover:text-[#102D4A] hover:bg-slate-100/70"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* User Profile & Sign Out */}
          <div className="flex items-center gap-3">
            <Link
              href="/student/profile"
              className="flex items-center gap-2.5 text-left py-1 px-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-[#102D4A]/10 text-[#102D4A] font-bold text-xs flex items-center justify-center">
                {user.fullName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="hidden lg:block">
                <p className="text-xs font-semibold text-[#102D4A] leading-tight">
                  {user.fullName}
                </p>
                <p className="text-[10px] text-[#526B82] font-mono leading-tight">
                  {user.studentId || "Student"}
                </p>
              </div>
            </Link>

            <button
              onClick={handleSignOut}
              className="text-xs text-[#526B82] hover:text-[#D9534F] py-1 px-2 rounded transition-colors font-medium"
              title="Sign Out"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 lg:p-8 pb-24 md:pb-12">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar (Docked, Airline App Style) */}
      <nav
        aria-label="Student Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg px-2 py-1 safe-area-bottom"
      >
        <div className="flex items-center justify-around">
          {STUDENT_NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/student"
                ? pathname === "/student"
                : pathname.startsWith(item.href) ||
                  (item.href === "/student/departures" && pathname.startsWith("/student/journeys")) ||
                  (item.href === "/student/trips" && pathname.startsWith("/student/bookings"));

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-all relative flex-1 text-center"
              >
                {isActive && (
                  <span className="absolute top-1 w-8 h-1 rounded-full bg-[#102D4A]" />
                )}
                <div className="mt-1">
                  {getIcon(item.icon, isActive)}
                </div>
                <span
                  className={`text-[10px] font-medium tracking-tight mt-1 ${
                    isActive ? "text-[#102D4A] font-bold" : "text-[#526B82]"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
