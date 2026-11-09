import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTime, formatDate } from "@/lib/utils";
import { BusIcon, CheckCircleIcon, QrCodeIcon, UserIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Boarding Officer Operations Console — CosmoRide",
  description: "Official boarding verification and passenger manifest operations for Cosmopolitan University, Nigeria.",
};

export const dynamic = "force-dynamic";

export default async function BoardingOfficerDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch officer profile with transport group details
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, assigned_transport_group_id")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "boarding_officer" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch transport group info if assigned
  let transportGroupName = "All Transport Operations (Administrator)";
  let transportGroupCode = "admin";

  if (profile.assigned_transport_group_id) {
    const { data: tg } = await supabase
      .from("transport_groups")
      .select("name, code, description")
      .eq("id", profile.assigned_transport_group_id)
      .single();

    if (tg) {
      transportGroupName = tg.name;
      transportGroupCode = tg.code;
    }
  }

  // Today's date (local date YYYY-MM-DD)
  const todayStr = new Date().toISOString().split("T")[0];

  // Query today's journeys with route, vehicle, driver, and bookings
  let journeysQuery = supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      status,
      proposed_allocation,
      routes!inner (
        id,
        code,
        name,
        transport_group_id
      ),
      vehicles (
        id,
        registration_number,
        name,
        safe_capacity
      ),
      driver:profiles!journeys_driver_id_fkey (
        id,
        full_name
      ),
      bookings (
        id,
        status
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  // Enforce transport group isolation: if boarding officer with assigned group, only fetch their corridor
  if (profile.role === "boarding_officer" && profile.assigned_transport_group_id) {
    journeysQuery = journeysQuery.eq("routes.transport_group_id", profile.assigned_transport_group_id);
  }

  const { data: rawJourneys, error: journeyError } = await journeysQuery;
  const journeys = rawJourneys || [];

  // Aggregate operational statistics
  let totalConfirmed = 0;
  let totalBoarded = 0;
  let totalPending = 0;
  let totalCancelled = 0;
  let totalNoShow = 0;
  let activeBoardingCount = 0;

  journeys.forEach((j) => {
    if (j.status === "boarding") activeBoardingCount++;
    const bookings = j.bookings || [];
    bookings.forEach((b) => {
      if (b.status === "confirmed") {
        totalConfirmed++;
        totalPending++;
      } else if (b.status === "checked_in") {
        totalConfirmed++;
        totalBoarded++;
      } else if (b.status === "cancelled") {
        totalCancelled++;
      } else if (b.status === "no_show") {
        totalNoShow++;
      }
    });
  });

  return (
    <div className="space-y-6">
      {/* Top Banner: Transport Corridor Badge & Greeting */}
      <div className="rounded-2xl bg-[#102D4A] p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              CORRIDOR ENFORCED
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {formatDate(todayStr)}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Boarding Operations Console
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Officer: <span className="text-white font-semibold">{profile.full_name}</span> • Assigned Corridor:{" "}
            <span className="text-emerald-300 font-semibold">{transportGroupName}</span>
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <Link
            href="/boarding/boarding"
            className="flex items-center gap-2 rounded-xl bg-[#20A477] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#1a8560] transition-colors"
          >
            <QrCodeIcon className="h-4 w-4" />
            <span>Launch Scanner</span>
          </Link>
          <Link
            href="/boarding/assisted"
            className="flex items-center gap-2 rounded-xl bg-amber-500/20 px-3.5 py-2.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            <span>🤝</span>
            <span>Assisted Driver Ops</span>
          </Link>
          <Link
            href="/boarding/passengers"
            className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            <UserIcon className="h-4 w-4" />
            <span>Manifest</span>
          </Link>
        </div>
      </div>

      {/* Operational Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#526B82] font-semibold">
            <span>Today&apos;s Journeys</span>
            <span>🚌</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#102D4A] font-mono">
            {journeys.length}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {activeBoardingCount} currently boarding
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#526B82] font-semibold">
            <span>Verified Boarded</span>
            <span className="text-[#20A477]">✓</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#20A477] font-mono">
            {totalBoarded}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Checked in with pass
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#526B82] font-semibold">
            <span>Awaiting Boarding</span>
            <span className="text-[#E5A13B]">⏳</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#E5A13B] font-mono">
            {totalPending}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Confirmed bookings
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#526B82] font-semibold">
            <span>Exceptions & No-Show</span>
            <span className="text-[#D9534F]">✕</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#D9534F] font-mono">
            {totalNoShow + totalCancelled}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {totalNoShow} no-show • {totalCancelled} cancelled
          </p>
        </div>
      </div>

      {/* Corridor Information Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#526B82]">
            SECURITY & CORRIDOR ENFORCEMENT
          </span>
          <p className="text-xs text-[#102D4A] font-medium leading-relaxed">
            Your officer account is locked to <strong>{transportGroupName}</strong>. Pass validation strictly denies cross-group tickets and enforces vehicle capacity limits.
          </p>
        </div>
        <div className="shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-mono font-bold text-[#102D4A]">
            Group: {transportGroupCode}
          </span>
        </div>
      </div>

      {/* Today's Assigned Journeys Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#102D4A]">
            Today&apos;s Assigned Departures ({journeys.length})
          </h2>
          <span className="text-xs font-mono text-[#526B82]">
            {formatDate(todayStr)}
          </span>
        </div>

        {journeys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <span className="text-4xl block mb-2">🚌</span>
            <h3 className="text-sm font-bold text-[#102D4A]">
              No Journeys Scheduled Today
            </h3>
            <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
              There are no departures scheduled for your transport corridor today. Once administrators create scheduled journeys, they will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {journeys.map((journey) => {
              const route = Array.isArray(journey.routes) ? journey.routes[0] : journey.routes;
              const vehicle = Array.isArray(journey.vehicles) ? journey.vehicles[0] : journey.vehicles;
              const driver = Array.isArray(journey.driver) ? journey.driver[0] : journey.driver;
              const bookings = journey.bookings || [];

              const journeyBoarded = bookings.filter((b) => b.status === "checked_in").length;
              const journeyConfirmed = bookings.filter((b) => b.status === "confirmed").length;
              const safeCap = vehicle?.safe_capacity || 30;
              const capCeiling = Math.min(journey.proposed_allocation, safeCap);
              const progressPct = Math.min(100, Math.round((journeyBoarded / capCeiling) * 100));

              return (
                <div
                  key={journey.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-[#526B82]">
                          {route?.code || "CORRIDOR"}
                        </span>
                        <h3 className="text-base font-extrabold text-[#102D4A]">
                          {route?.name || "University Route"}
                        </h3>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          journey.status === "boarding"
                            ? "bg-emerald-100 text-[#20A477] animate-pulse"
                            : journey.status === "in_transit"
                            ? "bg-blue-100 text-blue-700"
                            : journey.status === "completed"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-amber-100 text-[#E5A13B]"
                        }`}
                      >
                        {journey.status === "in_transit" ? "IN TRANSIT" : journey.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Operational Details */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-[#526B82]">
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">
                          Scheduled Departure
                        </span>
                        <span className="font-bold text-[#102D4A] font-mono text-sm">
                          {formatTime(journey.scheduled_departure)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">
                          Assigned Bus
                        </span>
                        <span className="font-bold text-[#102D4A]">
                          {vehicle?.registration_number || "Unassigned"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">
                          Driver
                        </span>
                        <span className="font-semibold text-[#102D4A]">
                          {driver?.full_name || "Assigned Driver"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">
                          Capacity Ceiling
                        </span>
                        <span className="font-semibold text-[#102D4A]">
                          {capCeiling} passengers
                        </span>
                      </div>
                    </div>

                    {/* Capacity Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-semibold text-[#526B82]">
                        <span>Boarding Status</span>
                        <span>
                          {journeyBoarded} boarded / {journeyConfirmed} pending
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            progressPct >= 100
                              ? "bg-[#D9534F]"
                              : progressPct >= 80
                              ? "bg-[#E5A13B]"
                              : "bg-[#20A477]"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <Link
                      href="/boarding/boarding"
                      className="flex-1 py-2 text-center rounded-xl bg-[#102D4A] hover:bg-[#18426C] text-white text-xs font-bold transition-colors shadow-2xs"
                    >
                      {journey.status === "boarding" ? "Active Boarding Gate" : "Open Console"}
                    </Link>
                    <Link
                      href={`/boarding/passengers?journeyId=${journey.id}`}
                      className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-[#102D4A] text-xs font-semibold transition-colors"
                    >
                      Manifest
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
