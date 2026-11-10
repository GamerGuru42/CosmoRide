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

  // Fetch all scheduled, boarding, or active journeys
  const today = getTodayDateString();
  const { data: journeysData, error } = await supabase
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
        safe_capacity
      )
    `)
    .gte("journey_date", today)
    .order("scheduled_departure", { ascending: true })
    .limit(30);

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
        safe_capacity: number;
      } | null;

      // Count confirmed and checked-in bookings and category breakdown
      const { count: bookedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .in("status", ["confirmed", "checked_in"]);

      const { count: seatedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .eq("passenger_category", "seated")
        .in("status", ["confirmed", "checked_in"]);

      const { count: standingCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .eq("passenger_category", "standing")
        .in("status", ["confirmed", "checked_in"]);

      // Check user's booking status
      const { data: userBooking } = await supabase
        .from("bookings")
        .select("id, passenger_category")
        .eq("journey_id", jd.id)
        .eq("student_id", user.id)
        .in("status", ["confirmed", "checked_in"])
        .maybeSingle();

      // Check user's waitlist status
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

      const origin = stopsList[0]?.name || "Main Terminal";
      const destination = stopsList[stopsList.length - 1]?.name || "Destination";

      // Fetch latest stop milestone update if any
      const { data: latestUpdates } = await supabase
        .from("journey_stop_updates")
        .select(`
          event_type,
          created_at,
          is_assisted,
          stops:stops!journey_stop_updates_stop_id_fkey ( name )
        `)
        .eq("journey_id", jd.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const latestUpdateRec = latestUpdates && latestUpdates.length > 0 ? latestUpdates[0] : null;
      const stopObj = Array.isArray(latestUpdateRec?.stops) ? latestUpdateRec?.stops[0] : latestUpdateRec?.stops;

      departures.push({
        id: jd.id,
        journeyDate: jd.journey_date,
        scheduledDeparture: jd.scheduled_departure,
        actualDeparture: jd.actual_departure,
        status: jd.status,
        delayMinutes: jd.delay_minutes ?? 0,
        delayReason: jd.delay_reason,
        proposedAllocation: jd.proposed_allocation,
        safeCapacity: vehicleInfo?.safe_capacity ?? 32,
        bookedCount: bookedCount ?? 0,
        seatedCount: seatedCount ?? 0,
        standingCount: standingCount ?? 0,
        routeId: routeInfo?.id ?? "",
        routeName: routeInfo?.name ?? "Campus Route",
        routeCode: routeInfo?.code ?? "CR",
        originName: origin,
        destinationName: destination,
        transportGroupName: routeInfo?.transport_group?.name,
        genderGroup: routeInfo?.gender_group,
        vehicleRegistration: vehicleInfo?.registration_number ?? "TBD",
        vehicleName: vehicleInfo?.name ?? null,
        stops: stopsList,
        userBookingId: userBooking?.id ?? null,
        userPassengerCategory: (userBooking as unknown as { passenger_category?: "seated" | "standing" })?.passenger_category ?? null,
        userWaitlistPosition: userWaitlist?.position ?? null,
        latestStopUpdate: latestUpdateRec
          ? {
              eventType: latestUpdateRec.event_type,
              stopName: stopObj?.name || "Bus Stop",
              timestamp: latestUpdateRec.created_at,
              isAssisted: latestUpdateRec.is_assisted,
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

      {error ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Database connection issue: Unable to load live departures. Please verify your Supabase connectivity.
        </div>
      ) : (
        <DepartureBoard journeys={departures} currentUserId={user.id} />
      )}
    </div>
  );
}

