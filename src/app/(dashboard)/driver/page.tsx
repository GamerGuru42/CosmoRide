import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import {
  DriverDashboardView,
  type DriverJourneyData,
} from "@/components/driver/driver-dashboard-view";
import type { RouteStopItem } from "@/components/driver/stop-milestones";

export const metadata: Metadata = {
  title: "Driver Operations Dashboard — CosmoRide",
  description: "Official bus trip execution and operational controls for Cosmopolitan University drivers.",
};

export const dynamic = "force-dynamic";

export default async function DriverDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch driver profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "driver" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch driver record (Mode A)
  const { data: driverRecord } = await supabase
    .from("drivers")
    .select("id, driver_reference, phone, status, assigned_vehicle_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  const driverReference = driverRecord?.driver_reference || "DRV-CU-APP";
  const driverPhone = driverRecord?.phone || profile.phone || null;

  const todayStr = getTodayDateString();

  // Fetch assigned journeys for today
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
      readiness_status,
      delay_minutes,
      delay_reason,
      routes!inner (
        id,
        code,
        name,
        route_stops (
          stop_order,
          estimated_minutes_from_start,
          stops (
            id,
            name
          )
        )
      ),
      vehicles (
        id,
        registration_number,
        name,
        safe_capacity
      ),
      bookings (
        id,
        status
      ),
      journey_stop_updates (
        stop_id,
        event_type,
        created_at,
        is_assisted,
        notes
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  // Filter journeys for this driver (unless admin)
  if (profile.role === "driver") {
    if (driverRecord?.id) {
      journeysQuery = journeysQuery.or(`driver_id.eq.${user.id},driver_record_id.eq.${driverRecord.id}`);
    } else {
      journeysQuery = journeysQuery.eq("driver_id", user.id);
    }
  }

  const { data: rawJourneys } = await journeysQuery;

  const journeys: DriverJourneyData[] = (rawJourneys || []).map((j) => {
    const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
    const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
    const bookings = j.bookings || [];
    const stopUpdates = j.journey_stop_updates || [];

    const rawRouteStops = (route?.route_stops || []) as Array<{
      stop_order: number;
      estimated_minutes_from_start: number;
      stops: { id: string; name: string } | Array<{ id: string; name: string }>;
    }>;

    // Sort route stops by stop_order
    const sortedStops = [...rawRouteStops].sort((a, b) => a.stop_order - b.stop_order);

    const stops: RouteStopItem[] = sortedStops.map((rs) => {
      const stopObj = Array.isArray(rs.stops) ? rs.stops[0] : rs.stops;
      const latestUpdate = stopUpdates
        .filter((su) => su.stop_id === stopObj?.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

      return {
        id: stopObj?.id || "",
        name: stopObj?.name || "Bus Stop",
        order: rs.stop_order,
        estimatedMinutesFromStart: rs.estimated_minutes_from_start,
        lastUpdate: latestUpdate
          ? {
              eventType: latestUpdate.event_type as RouteStopItem["lastUpdate"] extends { eventType: infer E } ? E : never,
              timestamp: latestUpdate.created_at,
              isAssisted: latestUpdate.is_assisted,
              notes: latestUpdate.notes,
            }
          : null,
      };
    });

    const boardedCount = bookings.filter((b) => b.status === "checked_in").length;
    const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      actualDeparture: j.actual_departure,
      actualArrival: j.actual_arrival,
      status: j.status as DriverJourneyData["status"],
      routeCode: route?.code || "CORRIDOR",
      routeName: route?.name || "University Route",
      vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
      vehicleName: vehicle?.name || null,
      vehicleId: vehicle?.id || "",
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
      proposedAllocation: j.proposed_allocation,
      readinessStatus: (j.readiness_status as DriverJourneyData["readinessStatus"]) || "pending",
      delayMinutes: j.delay_minutes || 0,
      delayReason: j.delay_reason || null,
      boardedCount,
      confirmedCount,
      stops,
    };
  });

  return (
    <div className="space-y-6">
      <DriverDashboardView
        driverName={profile.full_name}
        driverReference={driverReference}
        driverPhone={driverPhone}
        journeys={journeys}
      />
    </div>
  );
}
