import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import { DepartureBoard, type DepartureJourney } from "@/components/student/departure-board";

export const metadata: Metadata = {
  title: "Flight & Bus Departure Board | CosmoRide",
  description: "Official Campus Departure Information System for Cosmopolitan University",
};

export default async function StudentDeparturesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify profile completeness & active student status
  const { data: profile } = await supabase
    .from("profiles")
    .select("student_id, role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login?error=profile_missing");
  }

  if (!profile.is_active) {
    redirect("/login?error=account_inactive");
  }

  if (profile.role !== "student") {
    if (profile.role === "admin") redirect("/admin");
    if (profile.role === "boarding_officer") redirect("/boarding");
    if (profile.role === "driver") redirect("/driver");
    redirect("/login");
  }

  if (!profile.student_id || profile.student_id.trim() === "") {
    redirect("/register?reason=incomplete_profile");
  }

  // Fetch all scheduled, boarding, or active journeys
  const today = getTodayDateString();
  const { data: journeysData, error: journeysError } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      actual_departure,
      status,
      delay_minutes,
      delay_reason,
      proposed_allocation,
      route:routes (
        id,
        name,
        code,
        gender_group,
        transport_group:transport_groups ( name )
      ),
      vehicle:vehicles (
        name,
        registration_number,
        safe_capacity,
        seated_capacity,
        standing_capacity
      )
    `)
    .gte("journey_date", today)
    .order("scheduled_departure", { ascending: true })
    .limit(30);

  type OccupancyEntry = {
    seated_count: number;
    standing_count: number;
    active_bookings_count: number;
    waitlist_count: number;
    seated_limit: number;
    standing_limit: number;
    effective_capacity: number;
    latest_stop_update: {
      event_type: string;
      stop_name: string;
      created_at: string;
    } | null;
  };

  const journeyIds = (journeysData || []).map((j) => j.id);
  const { data: occResponse } = journeyIds.length
    ? await supabase.rpc("get_student_departure_occupancy", {
        p_journey_ids: journeyIds,
      })
    : { data: null };

  const occupancyMap =
    occResponse &&
    typeof occResponse === "object" &&
    !Array.isArray(occResponse) &&
    "occupancy" in occResponse
      ? ((occResponse as { occupancy?: Record<string, OccupancyEntry> }).occupancy ?? {})
      : {};

  const departures: DepartureJourney[] = [];

  if (journeysData && journeysData.length > 0) {
    for (const jd of journeysData) {
      const routeInfo = jd.route as unknown as {
        id: string;
        name: string;
        code: string;
        gender_group?: string;
        transport_group?: { name: string } | null;
      } | null;

      const vehicleInfo = jd.vehicle as unknown as {
        name: string | null;
        registration_number: string;
        safe_capacity: number | null;
        seated_capacity: number | null;
        standing_capacity: number | null;
      } | null;

      const occ = occupancyMap[jd.id];

      // Check user's own booking status
      const { data: userBooking } = await supabase
        .from("bookings")
        .select("id, passenger_category")
        .eq("journey_id", jd.id)
        .eq("student_id", user.id)
        .in("status", ["confirmed", "checked_in"])
        .maybeSingle();

      // Check user's own waitlist status
      const { data: userWaitlist } = await supabase
        .from("waitlists")
        .select("position")
        .eq("journey_id", jd.id)
        .eq("student_id", user.id)
        .eq("status", "waiting")
        .maybeSingle();

      // Fetch route stops
      const { data: routeStops } = await supabase
        .from("route_stops")
        .select(`
          stop_order,
          estimated_minutes_from_start,
          stop:stops ( id, name )
        `)
        .eq("route_id", routeInfo?.id ?? "")
        .order("stop_order", { ascending: true });

      const stopsList = (routeStops || []).map((rs) => {
        const s = rs.stop as unknown as { id: string; name: string } | null;
        return {
          id: s?.id || rs.stop_order.toString(),
          name: s?.name || `Stop ${rs.stop_order}`,
          order: rs.stop_order,
          estimatedMinutesFromStart: rs.estimated_minutes_from_start,
        };
      });

      const origin = stopsList[0]?.name || "Departure Terminal";
      const destination = stopsList[stopsList.length - 1]?.name || "Destination";

      departures.push({
        id: jd.id,
        journeyDate: jd.journey_date,
        scheduledDeparture: jd.scheduled_departure,
        actualDeparture: jd.actual_departure,
        status: jd.status,
        delayMinutes: jd.delay_minutes ?? 0,
        delayReason: jd.delay_reason,
        proposedAllocation: jd.proposed_allocation,
        safeCapacity: vehicleInfo?.safe_capacity ?? 0,
        bookedCount: occ?.active_bookings_count ?? 0,
        seatedCount: occ?.seated_count ?? 0,
        standingCount: occ?.standing_count ?? 0,
        seatedLimit: occ?.seated_limit ?? vehicleInfo?.seated_capacity ?? undefined,
        standingLimit: occ?.standing_limit ?? vehicleInfo?.standing_capacity ?? undefined,
        effectiveCapacity: occ?.effective_capacity,
        routeId: routeInfo?.id ?? "",
        routeName: routeInfo?.name ?? "Campus Route",
        routeCode: routeInfo?.code ?? "CR",
        originName: origin,
        destinationName: destination,
        transportGroupName: routeInfo?.transport_group?.name,
        genderGroup: routeInfo?.gender_group,
        vehicleRegistration: vehicleInfo?.registration_number ?? "Unassigned",
        vehicleName: vehicleInfo?.name ?? null,
        stops: stopsList,
        userBookingId: userBooking?.id ?? null,
        userPassengerCategory: (userBooking as unknown as { passenger_category?: "seated" | "standing" })?.passenger_category ?? null,
        userWaitlistPosition: userWaitlist?.position ?? null,
        latestStopUpdate: occ?.latest_stop_update
          ? {
              eventType: occ.latest_stop_update.event_type,
              stopName: occ.latest_stop_update.stop_name,
              timestamp: occ.latest_stop_update.created_at,
            }
          : null,
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="border-b border-slate-200/80 pb-5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#20A477] animate-pulse" />
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#20A477]">
            LIVE SCHEDULE DISPATCH
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#102D4A] tracking-tight mt-1">
          Departure Board
        </h1>
        <p className="text-xs text-[#526B82] mt-0.5">
          Real-time scheduled departures across Main Campus and Kado Campus
        </p>
      </div>

      {journeysError ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Database connection issue: Unable to load live departures. Please verify your Supabase connectivity.
        </div>
      ) : (
        <DepartureBoard journeys={departures} currentUserId={user.id} />
      )}
    </div>
  );
}

