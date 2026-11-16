"use client";

import { useState } from "react";
import Link from "next/link";
import { APP_NAME, UNIVERSITY_NAME } from "@/lib/constants";
import { Bus, Menu, X, ArrowRight } from "lucide-react";

export function LandingNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="relative z-30 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-4">
      <div className="flex items-center justify-between">
        {/* Brand Identity */}
        <Link
          href="/"
          className="flex items-center gap-3.5 group focus:outline-none"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#20A477] to-[#17855f] text-white shadow-lg shadow-[#20A477]/20 transition-transform group-hover:scale-105">
            <Bus className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-black tracking-wider text-white">
                {APP_NAME}
              </span>
              <span className="rounded-full bg-[#20A477]/20 border border-[#20A477]/40 px-2 py-0.5 text-[10px] font-bold text-[#4ade80] tracking-wider uppercase">
                Transit
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-300">
              {UNIVERSITY_NAME}, Abuja
            </span>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8 rounded-full bg-white/10 backdrop-blur-md px-6 py-2.5 border border-white/15">
          <a
            href="#routes"
            className="text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            Routes & Timetable
          </a>
          <a
            href="#campuses"
            className="text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            Campus Network
          </a>
          <a
            href="#how-it-works"
            className="text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            How It Works
          </a>
          <a
            href="#standards"
            className="text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            Safety
          </a>
          <a
            href="#faq"
            className="text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            FAQ
          </a>
        </div>

        {/* Desktop CTA Action Group */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/login"
            className="group inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-[#102D4A] shadow-md hover:bg-slate-100 hover:shadow-lg transition-all"
          >
            <span>Book a Seat</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-200 hover:bg-white/10 hover:text-white focus:outline-none"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-4 rounded-2xl bg-[#0B1B2B]/95 backdrop-blur-xl border border-white/10 p-5 shadow-2xl">
          <div className="flex flex-col gap-3">
            <a
              href="#routes"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 hover:text-white"
            >
              Routes & Timetable
            </a>
            <a
              href="#campuses"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 hover:text-white"
            >
              Campus Network
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 hover:text-white"
            >
              How It Works
            </a>
            <a
              href="#standards"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 hover:text-white"
            >
              Safety & Standards
            </a>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 hover:text-white"
            >
              Frequently Asked Questions
            </a>

            <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-2">
              <Link
                href="/login"
                className="w-full text-center rounded-xl border border-white/20 py-2.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                Sign In to CosmoRide
              </Link>
              <Link
                href="/login"
                className="w-full text-center rounded-xl bg-[#20A477] py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#1a8560]"
              >
                Book a Seat Now
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
