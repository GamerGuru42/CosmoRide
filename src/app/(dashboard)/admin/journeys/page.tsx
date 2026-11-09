import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const resolvedParams = await searchParams;
  const todayStr = new Date().toISOString().split("T")[0];
  const targetDate = resolvedParams.date || todayStr;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/student");

  // Fetch journeys for target date
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
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
        safe_capacity
      ),
      driver_record:drivers(
        full_name,
        driver_reference,
        has_app_access
      ),
      bookings(id, status),
      boarding_records(id)
    `)
    .eq("journey_date", targetDate)
    .order("scheduled_departure", { ascending: true });

  const journeys: JourneyListItem[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const vehicle = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const tg = route?.transport_group;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    const confirmedCount = (j.bookings ?? []).filter(
      (b: { id: string; status: string }) =>
        b.status === "confirmed" || b.status === "boarded"
    ).length;

    const boardedCount = (j.boarding_records ?? []).length;

    const isDelayed = (j.delay_minutes || 0) > 0;

    let driverMode: "app" | "assisted" | "unassigned" = "unassigned";
    if (driver) {
      driverMode = driver.has_app_access ? "app" : "assisted";
    }

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      actualDeparture: j.actual_departure,
      actualArrival: j.actual_arrival,
      status: j.status as JourneyListItem["status"],
      proposedAllocation: j.proposed_allocation,
      safeCapacity: vehicle?.safe_capacity || j.proposed_allocation || 30,
      routeCode: route?.code || "RT",
      routeName: route?.name || "Route",
      transportGroupName: tgName || "General Fleet",
      vehicleRegistration: vehicle?.registration_number || null,
      vehicleName: vehicle?.name || null,
      driverName: driver?.full_name || null,
      driverReference: driver?.driver_reference || null,
      driverMode,
      bookedCount: confirmedCount,
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
      />
    </div>
  );
}
