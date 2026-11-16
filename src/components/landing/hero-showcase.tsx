import Image from "next/image";
import { Bus, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { UNIVERSITY_NAME } from "@/lib/constants";

export function HeroShowcase() {
  return (
    <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 -mt-8 sm:-mt-12 lg:-mt-16 z-20">
      <div className="relative rounded-3xl overflow-hidden border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/10">
        {/* Aspect Ratio Container for Responsive Image */}
        <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full bg-slate-900">
          <Image
            src="/images/hero-shuttle.jpg"
            alt="Cosmopolitan University Official Campus Shuttle parked at the main academic entrance"
            fill
            priority
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
          />

          {/* Elegant Gradient Scrim for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent pointer-events-none" />

          {/* Floating Pill on Top Left */}
          <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-10 flex items-center gap-2 rounded-full bg-white/90 backdrop-blur-md px-3.5 py-1.5 text-xs font-bold text-[#102D4A] shadow-lg border border-white/50">
            <span className="flex h-2 w-2 rounded-full bg-[#20A477]" />
            <span>Official University Shuttle Fleet</span>
          </div>

          {/* Bottom Overlay Information Bar */}
          <div className="absolute bottom-4 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 z-10 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 text-white">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-mono tracking-widest text-emerald-300 uppercase">
                <MapPin className="h-3.5 w-3.5" />
                <span>Main Campus Bus Park • Kado Campus</span>
              </div>
              <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-white drop-shadow-md">
                Modern, Climate-Controlled Campus Transit
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="rounded-xl bg-black/50 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-slate-200 border border-white/10">
                30 Safe Seats Max
              </span>
              <span className="rounded-xl bg-[#20A477]/80 backdrop-blur-md px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                Mon – Fri Schedules
              </span>
            </div>
          </div>
        </div>

        {/* Quick Fleet & Route Summary Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 bg-white text-slate-700 text-xs">
          <div className="p-4 sm:p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#102D4A]">
              <Bus className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-[#102D4A] text-sm">Dedicated Shuttles</div>
              <div className="text-slate-500 text-[11px]">Regular campus runs</div>
            </div>
          </div>

          <div className="p-4 sm:p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#20A477]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-[#102D4A] text-sm">Zero Standees</div>
              <div className="text-slate-500 text-[11px]">Strict seat guarantee</div>
            </div>
          </div>

          <div className="p-4 sm:p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#102D4A]">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-[#102D4A] text-sm">4 Daily Routes</div>
              <div className="text-slate-500 text-[11px]">Direct & Wuye stops</div>
            </div>
          </div>

          <div className="p-4 sm:p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-[#102D4A] text-sm">No Paper Tickets</div>
              <div className="text-slate-500 text-[11px]">100% digital QR pass</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
