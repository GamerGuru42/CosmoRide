import Link from "next/link";
import {
  LogIn,
  CalendarSearch,
  CheckCircle2,
  QrCode,
  ScanLine,
  Bus,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

const STEPS = [
  {
    step: "01",
    title: "Sign In with University Account",
    description:
      "Access the platform using your official @cosmopolitan.edu.ng Google Workspace credentials. Seamless, secure, and exclusive to university members.",
    icon: LogIn,
    badge: "Student SSO",
  },
  {
    step: "02",
    title: "Browse Real-Time Timetable",
    description:
      "Inspect flight-style departure boards for morning and evening routes across Main Campus, Kado Campus, and student residences.",
    icon: CalendarSearch,
    badge: "Departure Board",
  },
  {
    step: "03",
    title: "Reserve Your Boarding Pass",
    description:
      "Select your journey before the booking cutoff. Capacity is capped at 32 passengers per bus (20 seated, 12 standing) according to university operating standards.",
    icon: CheckCircle2,
    badge: "Reserved Spot",
  },
  {
    step: "04",
    title: "Receive Digital QR Pass",
    description:
      "Your digital boarding pass is generated with your ticket token, vehicle assignment, allocated passenger category (seated or standing), and pickup stop.",
    icon: QrCode,
    badge: "Digital Pass",
  },
  {
    step: "05",
    title: "Doorstep Camera Verification",
    description:
      "Present your QR pass at the bus entrance. The assigned Hostel Representative scans and verifies your ticket via camera before departure.",
    icon: ScanLine,
    badge: "Camera Scan",
  },
  {
    step: "06",
    title: "Punctual, Supervised Transit",
    description:
      "Step aboard, take your allocated position, and travel safely with official university drivers across dedicated campus routes in Abuja.",
    icon: Bus,
    badge: "Campus Transit",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 lg:py-28 bg-white relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-bold text-[#20A477] mb-3 border border-emerald-200/60">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>The Student Experience</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#102D4A]">
            How CosmoRide Works
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            From schedule lookup to boarding at your stop, every step of the journey
            is structured for predictability, safety, and speed.
          </p>
        </div>

        {/* 6-Step Visual Journey Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.step}
                className="group relative rounded-3xl bg-slate-50 p-7 border border-slate-200/80 hover:bg-white hover:border-[#102D4A]/30 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  {/* Top Step Number & Badge */}
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-3xl font-black text-slate-300 group-hover:text-[#20A477] transition-colors">
                      {s.step}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 border border-slate-200/70 shadow-2xs">
                      {s.badge}
                    </span>
                  </div>

                  {/* Icon Box */}
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#102D4A] text-white shadow-md shadow-[#102D4A]/10 group-hover:scale-105 transition-transform">
                    <Icon className="h-6 w-6" />
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-base font-bold text-slate-900 mb-2">
                    {s.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {s.description}
                  </p>
                </div>

                {/* Bottom Step Indicator Accent */}
                <div className="mt-6 pt-4 border-t border-slate-200/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>Step {s.step} of 06</span>
                  <span className="text-[#20A477] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                    Standard Flow →
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Prompt */}
        <div className="mt-14 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#102D4A] px-7 py-3.5 text-xs sm:text-sm font-bold text-white shadow-md hover:bg-[#18426C] transition-all"
          >
            <span>Access Student Portal</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
