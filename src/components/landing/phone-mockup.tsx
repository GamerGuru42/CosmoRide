import { QrCode, Bus, ShieldCheck, Clock, CheckCircle2, Wifi, Battery, Sparkles } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export function PhoneMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[340px] sm:max-w-[360px] lg:max-w-[380px]">
      {/* Ambient glow behind phone */}
      <div className="absolute -inset-4 bg-gradient-to-tr from-[#20A477]/30 via-[#102D4A]/50 to-emerald-500/20 rounded-[50px] blur-2xl opacity-70 transform -rotate-1" />

      {/* Floating Accent Card 1 — Certified Safe Seat */}
      <div className="hidden sm:flex absolute -left-8 top-16 z-20 items-center gap-2.5 rounded-2xl bg-white/95 backdrop-blur-md px-4 py-3 shadow-xl border border-slate-200/80 transform -rotate-3 hover:rotate-0 transition-transform">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-[#20A477]">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Capacity Guarantee
          </div>
          <div className="text-xs font-black text-[#102D4A]">
            30 Safe Seats Max
          </div>
        </div>
      </div>

      {/* Floating Accent Card 2 — Live Status */}
      <div className="hidden sm:flex absolute -right-6 bottom-24 z-20 items-center gap-2.5 rounded-2xl bg-white/95 backdrop-blur-md px-4 py-3 shadow-xl border border-slate-200/80 transform rotate-2 hover:rotate-0 transition-transform">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-[#102D4A]">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Timetable Status
          </div>
          <div className="text-xs font-black text-[#102D4A] flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#20A477] animate-ping" />
            <span>Punctual Departure</span>
          </div>
        </div>
      </div>

      {/* Phone Hardware Chassis */}
      <div className="relative rounded-[46px] p-3 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950 shadow-2xl shadow-black/60 border border-slate-600/50">
        {/* Inner Phone Screen */}
        <div className="relative overflow-hidden rounded-[38px] bg-[#0A1724] text-slate-100 border border-slate-800 shadow-inner flex flex-col">
          {/* Hardware Notch / Dynamic Island & Status Bar */}
          <div className="pt-3 px-6 pb-2 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none">
            <span className="font-bold text-white">07:18</span>
            <div className="h-4 w-20 rounded-full bg-black/90 mx-auto" />
            <div className="flex items-center gap-1.5">
              <Wifi className="h-3 w-3" />
              <Battery className="h-3.5 w-3.5" />
            </div>
          </div>

          {/* App Header Inside Mockup */}
          <div className="px-5 pt-2 pb-3 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#20A477] text-white font-black text-xs shadow-xs">
                C
              </div>
              <div>
                <div className="text-[10px] font-mono tracking-widest text-[#20A477] font-bold uppercase">
                  CosmoRide
                </div>
                <div className="text-xs font-bold text-white">
                  Student Portal
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-2.5 py-1 text-[10px] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Active</span>
            </div>
          </div>

          {/* Screen Content: Active Boarding Pass */}
          <div className="p-4 space-y-3.5">
            {/* Digital Pass Card */}
            <div className="rounded-2xl bg-white text-slate-900 p-4 shadow-xl relative overflow-hidden border border-slate-100">
              {/* Top Accent Strip */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#102D4A] via-[#20A477] to-[#102D4A]" />

              <div className="flex items-start justify-between mb-3 pt-0.5">
                <div>
                  <div className="text-[9px] font-mono font-bold tracking-widest text-[#102D4A] uppercase">
                    Official Boarding Pass
                  </div>
                  <div className="text-sm font-black text-slate-900 tracking-tight">
                    Boys&apos; Morning Route
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#20A477]/10 px-2 py-0.5 text-[9px] font-extrabold text-[#20A477] border border-[#20A477]/20 uppercase tracking-wide">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#20A477] animate-pulse" />
                  Confirmed
                </span>
              </div>

              {/* Transit Route Legs */}
              <div className="bg-slate-50 rounded-xl p-2.5 mb-3 border border-slate-100 flex items-center justify-between text-xs">
                <div className="text-left">
                  <div className="text-[9px] font-medium text-slate-500 uppercase">From</div>
                  <div className="font-bold text-slate-800 text-[11px] leading-tight">
                    Main Boys&apos; Hostel
                  </div>
                </div>
                <div className="flex flex-col items-center px-2">
                  <div className="text-[8px] text-slate-400 font-mono">07:30 AM</div>
                  <div className="w-12 h-0.5 bg-slate-300 relative my-0.5">
                    <div className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-[#20A477]" />
                  </div>
                  <div className="text-[8px] text-[#20A477] font-semibold">via Wuye</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-medium text-slate-500 uppercase">To</div>
                  <div className="font-bold text-slate-800 text-[11px] leading-tight">
                    Main Campus
                  </div>
                </div>
              </div>

              {/* Passenger & Vehicle Details Grid */}
              <div className="grid grid-cols-2 gap-2 text-[10px] mb-3 pb-3 border-b border-dashed border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[9px]">Vehicle Allocation</span>
                  <span className="font-bold text-slate-800 font-mono">CU-BUS-01 (Shuttle 1)</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px]">Seat Category</span>
                  <span className="font-bold text-[#20A477]">Seated Passenger</span>
                </div>
              </div>

              {/* Visual QR Code Display */}
              <div className="flex items-center gap-3">
                <div className="h-20 w-20 shrink-0 rounded-xl bg-slate-900 p-1.5 flex items-center justify-center text-white shadow-inner">
                  {/* High fidelity SVG QR pattern */}
                  <svg viewBox="0 0 100 100" className="h-full w-full fill-white">
                    {/* Top Left Corner */}
                    <rect x="5" y="5" width="28" height="28" rx="4" />
                    <rect x="11" y="11" width="16" height="16" fill="#0f172a" />
                    <rect x="15" y="15" width="8" height="8" />
                    {/* Top Right Corner */}
                    <rect x="67" y="5" width="28" height="28" rx="4" />
                    <rect x="73" y="11" width="16" height="16" fill="#0f172a" />
                    <rect x="77" y="15" width="8" height="8" />
                    {/* Bottom Left Corner */}
                    <rect x="5" y="67" width="28" height="28" rx="4" />
                    <rect x="11" y="73" width="16" height="16" fill="#0f172a" />
                    <rect x="15" y="77" width="8" height="8" />
                    {/* Center matrix elements */}
                    <rect x="40" y="8" width="6" height="12" />
                    <rect x="52" y="16" width="8" height="6" />
                    <rect x="42" y="38" width="16" height="16" rx="2" />
                    <rect x="46" y="42" width="8" height="8" fill="#0f172a" />
                    <rect x="10" y="44" width="8" height="12" />
                    <rect x="24" y="40" width="8" height="8" />
                    <rect x="68" y="42" width="12" height="6" />
                    <rect x="84" y="48" width="8" height="12" />
                    <rect x="40" y="68" width="10" height="10" />
                    <rect x="56" y="74" width="8" height="16" />
                    <rect x="70" y="68" width="12" height="8" />
                    <rect x="84" y="78" width="8" height="8" />
                  </svg>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-[10px] font-bold text-slate-800">
                    Scan for Boarding
                  </div>
                  <p className="text-[9px] text-slate-500 leading-tight">
                    Present to the Hostel Representative when boarding the bus at Main Boys&apos; Hostel.
                  </p>
                  <div className="text-[8px] font-mono text-slate-400">
                    Token: CR-8941-WAT
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Navigation Card Inside Phone */}
            <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#102D4A] text-slate-200">
                  <Bus className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-white">Next Departure</div>
                  <div className="text-[9px] text-slate-400">08:30 AM Express Direct</div>
                </div>
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold text-emerald-400 font-mono">
                Seats Open
              </span>
            </div>
          </div>

          {/* Bottom Phone Bar */}
          <div className="py-2 flex justify-center">
            <div className="h-1 w-24 rounded-full bg-slate-600/60" />
          </div>
        </div>
      </div>
    </div>
  );
}
