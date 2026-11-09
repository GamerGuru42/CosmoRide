import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTime, formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Assigned Journeys — CosmoRide Driver Console",
  description: "View all current, scheduled, and past journey assignments.",
};

export const dynamic = "force-dynamic";

export default async function DriverJourneysPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "driver" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch driver record
  const { data: driverRecord } = await supabase
    .from("drivers")
    .select("id, driver_reference")
    .eq("profile_id", user.id)
    .maybeSingle();

  // Query all journeys assigned to driver
  let journeysQuery = supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      actual_departure,
      actual_arrival,
      status,
      proposed_allocation,
      routes!inner (
        id,
        code,
        name
      ),
      vehicles (
        id,
        registration_number,
        safe_capacity
      ),
      bookings (
        id,
        status
      )
    `)
    .order("journey_date", { ascending: false })
    .order("scheduled_departure", { ascending: false })
    .limit(30);

  if (profile.role === "driver") {
    if (driverRecord?.id) {
      journeysQuery = journeysQuery.or(`driver_id.eq.${user.id},driver_record_id.eq.${driverRecord.id}`);
    } else {
      journeysQuery = journeysQuery.eq("driver_id", user.id);
    }
  }

  const { data: rawJourneys } = await journeysQuery;
  const journeys = rawJourneys || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#102D4A]">
            My Journey Roster
          </h1>
          <p className="text-xs text-[#526B82]">
            Assigned trip schedule and historical driving records.
          </p>
        </div>

        <Link
          href="/driver"
          className="px-4 py-2 text-xs font-bold bg-[#102D4A] text-white rounded-xl hover:bg-[#18426C] transition-colors self-start sm:self-auto"
        >
          ← Live Trip Console
        </Link>
      </div>

      {/* Journeys List */}
      {journeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <span className="text-4xl block mb-2">🚌</span>
          <h3 className="text-sm font-bold text-[#102D4A]">
            No Journeys Recorded
          </h3>
          <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
            There are no journey assignments found for your driver account.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {journeys.map((j) => {
            const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
            const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
            const bookings = j.bookings || [];
            const boardedCount = bookings.filter((b) => b.status === "checked_in").length;

            return (
              <div
                key={j.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-300 transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold font-mono text-[#526B82] bg-slate-100 px-2 py-0.5 rounded">
                      {route?.code || "CORRIDOR"}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      {formatDate(j.journey_date)}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-[#102D4A]">
                    {route?.name}
                  </h3>
                  <p className="text-xs text-[#526B82]">
                    Bus: <strong className="text-[#102D4A]">{vehicle?.registration_number || "Unassigned"}</strong> • Scheduled:{" "}
                    <strong className="text-[#102D4A] font-mono">{formatTime(j.scheduled_departure)}</strong>
                    {j.actual_departure && ` • Departed: ${formatTime(j.actual_departure)}`}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-[#526B82] block">
                      Boarded
                    </span>
                    <span className="text-sm font-bold text-[#20A477] font-mono">
                      {boardedCount} Pax
                    </span>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      j.status === "in_transit"
                        ? "bg-blue-100 text-blue-800"
                        : j.status === "boarding"
                        ? "bg-emerald-100 text-[#20A477]"
                        : j.status === "completed"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-100 text-[#E5A13B]"
                    }`}
                  >
                    {j.status === "in_transit" ? "IN TRANSIT" : j.status.toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
