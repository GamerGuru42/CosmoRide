import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { calculateCapacityBreakdown, getTodayDateString } from "@/lib/utils";
import {
  BusManagerDispatchView,
  type DispatchJourneyItem,
} from "@/components/admin/bus-manager-dispatch-view";

export const metadata: Metadata = {
  title: "Bus Manager Dispatch Console — CosmoRide",
  description: "Coordinates drivers, vehicle readiness, terminal arrival, and authorized bus dispatch.",
};

export const dynamic = "force-dynamic";

export default async function BusManagerDispatchPage() {
  const { adminRole } = await requireAdminPageAccess("dispatch");
  const isReadOnlySupervisory = adminRole === "hostel_manager";
  const supabase = await createClient();

  const todayStr = getTodayDateString();

  // Fetch today's journeys with full driver, vehicle, and booking counts
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      latest_permitted_departure,
      actual_departure,
      bus_arrived_at,
      boarding_opened_at,
      boarding_closed_at,
      departure_authorised_at,
      status,
      proposed_allocation,
      delay_minutes,
      delay_reason,
      routes!inner (
        id,
        code,
        name,
        transport_groups (
          id,
          name
        )
      ),
      vehicles (
        id,
        registration_number,
        name,
        safe_capacity,
        seated_capacity,
        standing_capacity
      ),
      driver_record:drivers (
        id,
        full_name,
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
        status,
        passenger_category
      ),
      vehicle_readiness_checks (
        status,
        vehicle_safe,
        created_at
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  const journeys: DispatchJourneyItem[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
    const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const directDriver = Array.isArray(j.driver) ? j.driver[0] : j.driver;
    const tg = route?.transport_groups;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    const rawBookings = j.bookings || [];
    const bookedCount = rawBookings.filter((b) => b.status === "confirmed" || b.status === "checked_in").length;
    const boardedCount = rawBookings.filter((b) => b.status === "checked_in").length;
    const seatedBoarded = rawBookings.filter((b) => b.status === "checked_in" && b.passenger_category === "seated").length;
    const standingBoarded = rawBookings.filter((b) => b.status === "checked_in" && b.passenger_category === "standing").length;

    // Safety check status
    const latestCheck = (j.vehicle_readiness_checks ?? []).sort(
      (a: { created_at: string }, b: { created_at: string }) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    let readinessStatus: "pending" | "passed" | "failed_unsafe" = "pending";
    if (latestCheck) {
      readinessStatus = latestCheck.status === "passed" || latestCheck.vehicle_safe ? "passed" : "failed_unsafe";
    }

    const effectiveLatestDeparture = j.latest_permitted_departure || j.scheduled_departure;
    const isOverdue =
      (j.status === "scheduled" ||
        j.status === "bus_arrived" ||
        j.status === "boarding" ||
        j.status === "boarding_closed" ||
        j.status === "ready_to_depart") &&
      !j.actual_departure &&
      new Date() > new Date(effectiveLatestDeparture);

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      latestPermittedDeparture: j.latest_permitted_departure,
      actualDeparture: j.actual_departure,
      busArrivedAt: j.bus_arrived_at,
      boardingOpenedAt: j.boarding_opened_at,
      boardingClosedAt: j.boarding_closed_at,
      departureAuthorisedAt: j.departure_authorised_at,
      status: j.status as DispatchJourneyItem["status"],
      routeCode: route?.code || "ROUTE",
      routeName: route?.name || "University Route",
      transportGroupName: tgName || "General Fleet",
      vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
      vehicleName: vehicle?.name || null,
      driverName: driver?.full_name || directDriver?.full_name || null,
      driverPhone: driver?.phone || directDriver?.phone || null,
      driverHasAppAccess: driver ? Boolean(driver.has_app_access) : Boolean(directDriver),
      ...(() => {
        const cap = calculateCapacityBreakdown({
          proposedAllocation: j.proposed_allocation,
          safeCapacity: vehicle?.safe_capacity ?? null,
          seatedLimit: vehicle?.seated_capacity ?? null,
          standingLimit: vehicle?.standing_capacity ?? null,
        });
        return {
          safeCapacity: cap.effectiveCapacity,
          seatedCapacity: cap.seatedLimit,
          standingCapacity: cap.standingLimit,
        };
      })(),
      readinessStatus,
      delayMinutes: j.delay_minutes || 0,
      delayReason: j.delay_reason || null,
      bookedCount,
      boardedCount,
      seatedBoarded,
      standingBoarded,
      isOverdue,
    };
  });

  return (
    <div className="space-y-6">
      <BusManagerDispatchView
        journeys={journeys}
        currentDate={todayStr}
        isReadOnlySupervisory={isReadOnlySupervisory}
      />
    </div>
  );
}

