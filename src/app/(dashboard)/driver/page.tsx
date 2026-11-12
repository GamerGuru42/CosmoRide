import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOperationalStaffPageAccess } from "@/lib/admin-auth";
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
  const { userId, profile } = await requireOperationalStaffPageAccess("driver");
  const supabase = await createClient();

  // Fetch driver record (Mode A)
  const { data: driverRecord } = await supabase
    .from("drivers")
    .select("id, driver_reference, phone, status, has_app_access, assigned_vehicle_id")
    .eq("profile_id", userId)
    .maybeSingle();

  const driverReference =
    driverRecord?.driver_reference ||
    (profile.role === "admin" ? "SUPERVISORY" : "Unassigned");
  const driverPhone = driverRecord?.phone || profile.phone || null;
  const isUnlinkedDriver = profile.role === "driver" && !driverRecord;
  const isModeBOnlyDriver = Boolean(
    profile.role === "driver" && driverRecord && !driverRecord.has_app_access
  );

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
      journeysQuery = journeysQuery.or(`driver_id.eq.${userId},driver_record_id.eq.${driverRecord.id}`);
    } else {
      journeysQuery = journeysQuery.eq("driver_id", userId);
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
      estimated_minutes_from_start: number | null;
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
      routeCode: route?.code || "ROUTE",
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
      {(isUnlinkedDriver || isModeBOnlyDriver) && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1"
        >
          <p className="font-bold text-amber-950">
            {isUnlinkedDriver
              ? "Driver Profile Not Yet Linked to Fleet Roster"
              : "Mode B (Representative-Assisted Dispatch) Active"}
          </p>
          <p className="leading-relaxed">
            {isUnlinkedDriver
              ? "Your user account has not yet been linked to a driver record (drivers.profile_id). Contact a Super Administrator or Bus Manager to link your profile for Mode A execution."
              : "Direct Mode A smartphone dispatch is disabled on your driver record; Hostel Boarding Representatives handle assisted dispatch on your behalf."}
          </p>
        </div>
      )}
      <DriverDashboardView
        driverName={profile.full_name}
        driverReference={driverReference}
        driverPhone={driverPhone}
        journeys={journeys}
      />
    </div>
  );
}
