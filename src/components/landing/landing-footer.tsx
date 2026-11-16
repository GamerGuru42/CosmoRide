import Link from "next/link";
import { Bus, MapPin } from "lucide-react";
import {
  APP_NAME,
  UNIVERSITY_NAME,
  DEVELOPER_ATTRIBUTION,
} from "@/lib/constants";

export function LandingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#081523] text-slate-400 text-xs border-t border-white/5">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-12 mb-12">
          {/* Brand Info */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#20A477] text-white font-black text-sm shadow-xs">
                <Bus className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-mono text-base font-black tracking-wider text-white">
                  {APP_NAME}
                </span>
                <span className="text-[10px] text-slate-400">
                  {UNIVERSITY_NAME}, Abuja
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400 max-w-md leading-relaxed">
              Official campus mobility and scheduled bus transit platform for Cosmopolitan University.
              Providing guaranteed seating, encrypted digital boarding passes, and reliable inter-campus
              connectivity across Abuja.
            </p>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>Main Campus & Kado Campus Lines, Abuja, Nigeria</span>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-3">
            <div className="font-bold uppercase tracking-wider text-white text-[11px]">
              Platform & Network
            </div>
            <ul className="space-y-2">
              <li>
                <a href="#routes" className="hover:text-white transition-colors">
                  Routes & Timetable
                </a>
              </li>
              <li>
                <a href="#campuses" className="hover:text-white transition-colors">
                  Campus Stations
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-white transition-colors">
                  How CosmoRide Works
                </a>
              </li>
              <li>
                <a href="#standards" className="hover:text-white transition-colors">
                  Safety & Fleet Standards
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white transition-colors">
                  Frequently Asked Questions
                </a>
              </li>
            </ul>
          </div>

          {/* Operational Portals & Auth */}
          <div className="space-y-3">
            <div className="font-bold uppercase tracking-wider text-white text-[11px]">
              Access & Portals
            </div>
            <ul className="space-y-2">
              <li>
                <Link href="/login" className="hover:text-white transition-colors">
                  Sign In (All Roles)
                </Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-white transition-colors">
                  Student Registration
                </Link>
              </li>
              <li>
                <Link href="/student" className="hover:text-white transition-colors">
                  Student Dashboard
                </Link>
              </li>
              <li>
                <Link href="/boarding" className="hover:text-white transition-colors">
                  Hostel Representative Portal
                </Link>
              </li>
              <li>
                <Link href="/driver" className="hover:text-white transition-colors">
                  Driver Portal
                </Link>
              </li>
              <li>
                <Link href="/admin" className="hover:text-white transition-colors">
                  Transport Admin Control
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <div>
            © {currentYear} {UNIVERSITY_NAME}. All rights reserved.
          </div>
          <div className="font-medium text-slate-400">
            {DEVELOPER_ATTRIBUTION}
          </div>
        </div>
      </div>
    </footer>
  );
}
