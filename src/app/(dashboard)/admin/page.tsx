import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  AdminOverview,
  type AdminJourneyOverview,
  type AdminFleetSummary,
  type AdminIncidentSummary,
} from "@/components/admin/admin-overview";

export const metadata: Metadata = {
  title: "Operational Control Centre — CosmoRide Admin",
  description: "Cosmopolitan University transportation operations control centre and fleet monitoring.",
};

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Authorize admin caller
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    redirect("/student");
  }

  const todayStr = getTodayDateString();

  // 1. Fetch today's journeys
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
        has_app_access
      ),
      bookings(id, status),
      boarding_records(id)
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  const journeys: AdminJourneyOverview[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const vehicle = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const transportGroup = route?.transport_group;
    const tgName = Array.isArray(transportGroup)
      ? transportGroup[0]?.name
      : transportGroup?.name;

    const confirmedBookings = (j.bookings ?? []).filter(
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
      status: j.status as AdminJourneyOverview["status"],
      routeCode: route?.code || "CU-RT",
      routeName: route?.name || "Route",
      transportGroupName: tgName || "General Fleet",
      vehicleRegistration: vehicle?.registration_number || null,
      vehicleName: vehicle?.name || null,
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
      driverName: driver?.full_name || null,
      driverMode,
      bookedCount: confirmedBookings,
      boardedCount,
      isDelayed,
      delayMinutes: j.delay_minutes || 0,
    };
  });

  // 2. Fetch fleet summary
  const { data: fleetData } = await supabase
    .from("vehicles")
    .select("id, status, is_active");

  const allVehicles = fleetData ?? [];
  const assignedVehicleIds = new Set(
    journeys.map((j) => j.vehicleRegistration).filter(Boolean)
  );

  const fleetSummary: AdminFleetSummary = {
    totalVehicles: allVehicles.length,
    availableVehicles: allVehicles.filter(
      (v) => v.is_active && v.status !== "maintenance" && v.status !== "retired"
    ).length,
    maintenanceVehicles: allVehicles.filter((v) => v.status === "maintenance").length,
    assignedToday: assignedVehicleIds.size,
  };

  // 3. Fetch open incidents
  const { data: incidentData } = await supabase
    .from("incident_reports")
    .select(`
      id,
      category,
      severity,
      status,
      description,
      created_at,
      journey:journeys(
        route:routes(code)
      )
    `)
    .in("status", ["reported", "investigating"])
    .order("created_at", { ascending: false })
    .limit(5);

  const openIncidents: AdminIncidentSummary[] = (incidentData ?? []).map((inc) => {
    const journey = Array.isArray(inc.journey) ? inc.journey[0] : inc.journey;
    const route = Array.isArray(journey?.route) ? journey?.route[0] : journey?.route;
    return {
      id: inc.id,
      category: inc.category,
      severity: inc.severity as AdminIncidentSummary["severity"],
      status: inc.status as AdminIncidentSummary["status"],
      description: inc.description,
      createdAt: inc.created_at,
      routeCode: route?.code || null,
    };
  });

  // 4. Fetch registered students and total drivers count
  const { count: studentCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student");

  const { count: driverCount } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true });

  return (
    <div>
      <PageHeader
        title="Transport Operational Control Centre"
        description="Comprehensive real-time monitoring and administrative oversight for Cosmopolitan University bus operations."
      />

      <AdminOverview
        date={todayStr}
        journeys={journeys}
        fleetSummary={fleetSummary}
        openIncidents={openIncidents}
        registeredStudentsCount={studentCount || 0}
        totalDriversCount={driverCount || 0}
      />
    </div>
  );
}
