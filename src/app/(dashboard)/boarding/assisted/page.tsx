import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  AssistedDriverOperations,
  type AssistedJourneyData,
} from "@/components/boarding/assisted-driver-operations";
import type { RouteStopItem } from "@/components/driver/stop-milestones";

export const metadata: Metadata = {
  title: "Representative-Assisted Driver Operations — CosmoRide",
  description: "Operational controls for hostel representatives managing non-smartphone drivers.",
};

export const dynamic = "force-dynamic";

export default async function AssistedDriverOperationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify officer role
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, assigned_transport_group_id")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "boarding_officer" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch transport group name
  let corridorName = "All Transport Corridors (Supervisory)";
  if (profile.assigned_transport_group_id) {
    const { data: tg } = await supabase
      .from("transport_groups")
      .select("name")
      .eq("id", profile.assigned_transport_group_id)
      .single();
    if (tg) corridorName = tg.name;
  }

  const todayStr = new Date().toISOString().split("T")[0];

  // Fetch today's journeys in corridor
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
        transport_group_id,
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
      driver_record:drivers!journeys_driver_record_id_fkey (
        id,
        full_name,
        driver_reference,
        phone,
        has_app_access
      ),
      driver:profiles!journeys_driver_id_fkey (
        id,
        full_name,
        phone
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

  // Enforce transport group isolation
  if (profile.role === "boarding_officer" && profile.assigned_transport_group_id) {
    journeysQuery = journeysQuery.eq("routes.transport_group_id", profile.assigned_transport_group_id);
  }

  const { data: rawJourneys } = await journeysQuery;

  const journeys: AssistedJourneyData[] = (rawJourneys || []).map((j) => {
    const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
    const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
    const driverRec = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const driverProfile = Array.isArray(j.driver) ? j.driver[0] : j.driver;
    const bookings = j.bookings || [];
    const stopUpdates = j.journey_stop_updates || [];

    const driverName = driverRec?.full_name || driverProfile?.full_name || "Assigned Driver";
    const driverRef = driverRec?.driver_reference || "DRV-CU";
    const driverPhone = driverRec?.phone || driverProfile?.phone || null;
    const driverHasApp = Boolean(driverRec?.has_app_access);

    const rawRouteStops = (route?.route_stops || []) as Array<{
      stop_order: number;
      estimated_minutes_from_start: number;
      stops: { id: string; name: string } | Array<{ id: string; name: string }>;
    }>;

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
      status: j.status as AssistedJourneyData["status"],
      routeCode: route?.code || "CORRIDOR",
      routeName: route?.name || "University Route",
      vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
      vehicleName: vehicle?.name || null,
      vehicleId: vehicle?.id || "",
      driverName,
      driverReference: driverRef,
      driverPhone,
      driverHasAppAccess: driverHasApp,
      safeCapacity: vehicle?.safe_capacity || 30,
      proposedAllocation: j.proposed_allocation,
      readinessStatus: (j.readiness_status as AssistedJourneyData["readinessStatus"]) || "pending",
      delayMinutes: j.delay_minutes || 0,
      delayReason: j.delay_reason || null,
      boardedCount,
      confirmedCount,
      stops,
    };
  });

  return (
    <div className="space-y-6">
      <AssistedDriverOperations
        officerName={profile.full_name}
        corridorName={corridorName}
        journeys={journeys}
      />
    </div>
  );
}
