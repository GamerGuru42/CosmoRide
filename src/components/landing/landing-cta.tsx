import Link from "next/link";
import { ArrowRight, Bus, ShieldCheck } from "lucide-react";
import { UNIVERSITY_NAME, APP_NAME } from "@/lib/constants";

export function LandingCTA() {
  return (
    <section className="py-20 lg:py-24 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[40px] bg-gradient-to-br from-[#0B1B2B] via-[#102D4A] to-[#143B61] p-8 sm:p-12 lg:p-16 text-white shadow-2xl">
          {/* Subtle Ambient Pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:3rem_3rem] pointer-events-none" />

          {/* Glowing orb in corner */}
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-[#20A477]/25 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-2xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 border border-white/15">
              <ShieldCheck className="h-4 w-4" />
              <span>Official Cosmopolitan University Transit</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
              Ready for your next campus journey?
            </h2>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl mx-auto">
              Join your fellow Cosmopolitan University students. Reserve your guaranteed seat,
              skip the queues, and enjoy safe, climate-controlled mobility across Abuja.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="group w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-[#20A477] px-8 py-4 text-sm font-bold text-white shadow-lg shadow-[#20A477]/30 hover:bg-[#1a8560] hover:scale-[1.02] active:scale-[0.99] transition-all"
              >
                <span>Sign In to Book a Seat</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>

              <Link
                href="/register"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 px-8 py-4 text-sm font-semibold text-white backdrop-blur-md transition-all"
              >
                <span>First Time Student? Register</span>
              </Link>
            </div>

            <div className="pt-4 text-[11px] text-slate-400 font-mono">
              Authentication restricted strictly to @cosmopolitan.edu.ng accounts
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
