import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  ReportsView,
  type JourneyReportRow,
  type IncidentReportRow,
  type PassengerReportRow,
} from "@/components/admin/reports-view";

export const metadata: Metadata = {
  title: "Reports & Data Exports — CosmoRide Admin",
  description: "Fleet capacity utilization, boarding compliance audits, and service reliability reports.",
};

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
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

  // 1. Fetch journeys history
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      status,
      proposed_allocation,
      delay_minutes,
      route:routes(
        code,
        name,
        transport_group:transport_groups(name)
      ),
      vehicle:vehicles(
        registration_number,
        safe_capacity
      ),
      driver_record:drivers(
        full_name
      ),
      bookings(id, status),
      boarding_records(id)
    `)
    .order("journey_date", { ascending: false })
    .limit(100);

  const journeys: JourneyReportRow[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const vehicle = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const tg = route?.transport_group;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    const confirmed = (j.bookings ?? []).filter(
      (b: { status: string }) => b.status === "confirmed" || b.status === "boarded"
    ).length;

    const boarded = (j.boarding_records ?? []).length;
    const isDelayed = (j.delay_minutes || 0) > 0;

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      routeCode: route?.code || "RT",
      routeName: route?.name || "Route",
      transportGroupName: tgName || "General Fleet",
      vehiclePlate: vehicle?.registration_number || "Unassigned",
      driverName: driver?.full_name || "Unassigned",
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
      bookedCount: confirmed,
      boardedCount: boarded,
      status: j.status,
      isDelayed,
      delayMinutes: j.delay_minutes || 0,
    };
  });

  // 2. Fetch incidents
  const { data: incidentsData } = await supabase
    .from("incident_reports")
    .select(`
      id,
      created_at,
      category,
      severity,
      status,
      description,
      resolution_notes,
      reporter:profiles(full_name)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const incidents: IncidentReportRow[] = (incidentsData ?? []).map((inc) => {
    const reporter = Array.isArray(inc.reporter) ? inc.reporter[0] : inc.reporter;
    return {
      id: inc.id,
      date: inc.created_at,
      category: inc.category,
      severity: inc.severity,
      status: inc.status,
      reporterName: reporter?.full_name || "Staff",
      description: inc.description,
      resolutionNotes: inc.resolution_notes,
    };
  });

  // 3. Fetch recent passenger bookings for compliance report
  const { data: passengersData } = await supabase
    .from("bookings")
    .select(`
      id,
      status,
      journey:journeys(
        journey_date,
        route:routes(code)
      ),
      profile:profiles(
        full_name,
        student_id
      ),
      boarding_records(
        scanned_at
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const passengers: PassengerReportRow[] = (passengersData ?? []).map((b) => {
    const journey = Array.isArray(b.journey) ? b.journey[0] : b.journey;
    const route = Array.isArray(journey?.route) ? journey?.route[0] : journey?.route;
    const profile = Array.isArray(b.profile) ? b.profile[0] : b.profile;
    const bRecords = Array.isArray(b.boarding_records) ? b.boarding_records : [];

    return {
      id: b.id,
      journeyDate: journey?.journey_date || "",
      routeCode: route?.code || "RT",
      studentName: profile?.full_name || "Student",
      studentId: profile?.student_id || null,
      status: b.status,
      boardedAt: bRecords[0]?.scanned_at || null,
    };
  });

  return (
    <div>
      <PageHeader
        title="Operational Analytics &amp; Compliance Reports"
        description="University transit performance audits, capacity utilization ratios, and official CSV exports."
      />

      <ReportsView
        journeys={journeys}
        incidents={incidents}
        passengers={passengers}
      />
    </div>
  );
}
