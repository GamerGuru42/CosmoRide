import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { calculateCapacityBreakdown, getTodayDateString } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  JourneysManagement,
  type JourneyListItem,
} from "@/components/admin/journeys-management";

export const metadata: Metadata = {
  title: "Journeys Management — CosmoRide Admin",
  description: "Monitor daily bus journey dispatches, passenger counts, and service status.",
};

export const dynamic = "force-dynamic";

interface AdminJourneysPageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function AdminJourneysPage({
  searchParams,
}: AdminJourneysPageProps) {
  const { adminRole } = await requireAdminPageAccess("journeys");
  const canCancelJourneys =
    adminRole === "super_admin" || adminRole === "bus_manager";
  const resolvedParams = await searchParams;
  const todayStr = getTodayDateString();
  const targetDate = resolvedParams.date || todayStr;

  const supabase = await createClient();

  // Fetch journeys for target date
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      latest_permitted_departure,
      actual_departure,
      actual_arrival,
      status,
      proposed_allocation,
      delay_minutes,
      delay_reason,
      route:routes(
        code,
        name,
        transport_group:transport_groups(name)
      ),
      vehicle:vehicles(
        registration_number,
        name,
        safe_capacity,
        seated_capacity,
        standing_capacity
      ),
      driver_record:drivers(
        full_name,
        driver_reference,
        has_app_access
      ),
      driver:profiles!journeys_driver_id_fkey(
        full_name
      ),
      bookings(id, status, passenger_category),
      boarding_records(id)
    `)
    .eq("journey_date", targetDate)
    .order("scheduled_departure", { ascending: true });

  const journeys: JourneyListItem[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const vehicle = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const directDriver = Array.isArray(j.driver) ? j.driver[0] : j.driver;
    const tg = route?.transport_group;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    const activeBookings = (j.bookings ?? []).filter(
      (b: { id: string; status: string; passenger_category?: string }) =>
        b.status === "confirmed" || b.status === "checked_in"
    );
    const confirmedCount = activeBookings.length;
    const seatedCount = activeBookings.filter(
      (b: { id: string; status: string; passenger_category?: string }) =>
        b.passenger_category === "seated"
    ).length;
    const standingCount = activeBookings.filter(
      (b: { id: string; status: string; passenger_category?: string }) =>
        b.passenger_category === "standing"
    ).length;

    const boardedCount = (j.boarding_records ?? []).length;

    const isDelayed = (j.delay_minutes || 0) > 0;

    let driverMode: "app" | "assisted" | "unassigned" = "unassigned";
    if (driver) {
      driverMode = driver.has_app_access ? "app" : "assisted";
    } else if (directDriver) {
      driverMode = "app";
    }

    const capacityBreakdown = calculateCapacityBreakdown({
      proposedAllocation: j.proposed_allocation,
      safeCapacity: vehicle?.safe_capacity ?? null,
      seatedLimit: vehicle?.seated_capacity ?? null,
      standingLimit: vehicle?.standing_capacity ?? null,
    });

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      latestPermittedDeparture: j.latest_permitted_departure || null,
      actualDeparture: j.actual_departure,
      actualArrival: j.actual_arrival,
      status: j.status as JourneyListItem["status"],
      proposedAllocation: j.proposed_allocation,
      safeCapacity: capacityBreakdown.effectiveCapacity,
      seatedCapacity: capacityBreakdown.seatedLimit,
      standingCapacity: capacityBreakdown.standingLimit,
      routeCode: route?.code || "RT",
      routeName: route?.name || "Route",
      transportGroupName: tgName || "General Fleet",
      vehicleRegistration: vehicle?.registration_number || null,
      vehicleName: vehicle?.name || null,
      driverName: driver?.full_name || directDriver?.full_name || null,
      driverReference: driver?.driver_reference || null,
      driverMode,
      bookedCount: confirmedCount,
      seatedCount,
      standingCount,
      boardedCount,
      isDelayed,
      delayMinutes: j.delay_minutes || 0,
      cancellationReason: j.status === "cancelled" ? (j.delay_reason || "Administrative cancellation") : null,
    };
  });

  return (
    <div>
      <PageHeader
        title="Journeys Dispatch &amp; Trip Oversight"
        description="Inspect scheduled, in-transit, and completed bus journeys with booking capacity and cancellation governance."
      />

      <JourneysManagement
        initialDate={targetDate}
        journeys={journeys}
        canCancelJourneys={canCancelJourneys}
      />
    </div>
  );
}
