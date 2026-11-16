import Link from "next/link";
import { LandingNav } from "./landing-nav";
import { PhoneMockup } from "./phone-mockup";
import { ArrowRight, ShieldCheck, Clock, QrCode } from "lucide-react";
import { UNIVERSITY_NAME } from "@/lib/constants";

export function LandingHero() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-[#091522] via-[#0E2238] to-[#102D4A] rounded-b-[40px] md:rounded-b-[56px] lg:rounded-b-[68px] shadow-2xl pb-16 lg:pb-24">
      {/* Background Architectural Grid Accent */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Subtle Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[#20A477]/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Navigation */}
      <LandingNav />

      {/* Hero Body Content */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-10 lg:pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Vision & Action */}
          <div className="lg:col-span-7 text-left space-y-6">
            {/* Institutional Badge */}
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md px-3.5 py-1.5 border border-white/15 text-xs text-slate-200 shadow-sm">
              <span className="flex h-2 w-2 rounded-full bg-[#20A477] animate-pulse" />
              <span className="font-semibold text-white tracking-wide">
                {UNIVERSITY_NAME}, Abuja
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-[#4ade80] font-medium font-mono text-[11px]">
                Official Transit Platform
              </span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.1]">
              Smart campus mobility,{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent">
                built for your schedule.
              </span>
            </h1>

            {/* Concise Supporting Description */}
            <p className="text-base sm:text-lg text-slate-300 max-w-xl leading-relaxed font-normal">
              Book your guaranteed seat between <strong className="text-white font-semibold">Main Campus</strong>,{" "}
              <strong className="text-white font-semibold">Kado Campus</strong>, and university residences.
              Track live timetables, receive instant encrypted QR passes, and travel with total punctuality.
            </p>

            {/* Call to Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Link
                href="/login"
                className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#20A477] to-[#17855f] px-7 py-4 text-sm font-bold text-white shadow-lg shadow-[#20A477]/30 hover:shadow-xl hover:shadow-[#20A477]/40 hover:scale-[1.02] active:scale-[0.99] transition-all"
              >
                <span>Book Your Ride</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>

              <a
                href="#routes"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 px-6 py-4 text-sm font-semibold text-white backdrop-blur-md transition-all"
              >
                <Clock className="h-4 w-4 text-emerald-400" />
                <span>View Route Timetable</span>
              </a>
            </div>

            {/* Institutional Reliability Highlights */}
            <div className="pt-6 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-slate-300">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-white">30 Safe Seats Max</div>
                  <div className="text-[11px] text-slate-400">Zero standing oversell</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-white">WAT Timetable</div>
                  <div className="text-[11px] text-slate-400">Punctual departures</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-500/20 text-teal-400">
                  <QrCode className="h-4 w-4" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-white">Instant QR Pass</div>
                  <div className="text-[11px] text-slate-400">Fast door scan</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Floating Interactive Phone Mockup */}
          <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
            <PhoneMockup />
          </div>
        </div>
      </div>
    </div>
  );
}
