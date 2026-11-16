import { ShieldCheck, Users, Lock, Clock, CheckCircle2 } from "lucide-react";
import { UNIVERSITY_NAME } from "@/lib/constants";

export function SafetyStandards() {
  return (
    <section id="standards" className="py-20 lg:py-28 bg-[#0D2237] text-white relative overflow-hidden">
      {/* Background Accent Grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:3rem_3rem] pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Heading & Institutional Assurance */}
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-1 text-xs font-bold text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span>Institutional Mobility Standards</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
              Safety, dignity, and punctuality by design.
            </h2>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              CosmoRide was architected specifically for {UNIVERSITY_NAME}. It rejects commercial
              hailing unpredictability in favor of defined capacity limits, verified university identity,
              and structured route supervision.
            </p>

            <div className="pt-2 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#20A477] shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-slate-200">
                  <strong className="text-white">Defined 32 Capacity:</strong> 20 seated and 12 standing allocations per bus, preventing uncontrolled overloading.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#20A477] shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-slate-200">
                  <strong className="text-white">Dedicated Supervision:</strong> Official hostel routes overseen by assigned representatives.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#20A477] shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-slate-200">
                  <strong className="text-white">Booking Cutoff Window:</strong> Closes prior to departure (default 15 minutes) to finalize passenger manifests.
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: 4 Solid Pillars */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Pillar 1 */}
            <div className="rounded-3xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm space-y-3">
              <div className="h-10 w-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">
                Enforced 32-Capacity Limit
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Database-level concurrency controls enforce a hard 32-passenger ceiling (20 seated, 12 standing).
                When full, students can join the waiting list for promoted placement if cancellations occur.
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-3xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm space-y-3">
              <div className="h-10 w-10 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">
                Supervised Boarding Verification
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Every boarding operation is directly overseen by official Hostel Representatives who scan
                digital QR passes with camera verification before doors close.
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-3xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm space-y-3">
              <div className="h-10 w-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">
                Verified Community Only
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Strict domain verification ensures only authenticated Cosmopolitan University students,
                faculty, and staff can access boarding passes and transit services.
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="rounded-3xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm space-y-3">
              <div className="h-10 w-10 rounded-2xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
                <Clock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">
                FIDS Departure Lifecycle
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Campus screens and student portals display flight-style departure boards (FIDS)
                updating through Scheduled, Bus Arrived, Boarding Now, and In Transit states.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
