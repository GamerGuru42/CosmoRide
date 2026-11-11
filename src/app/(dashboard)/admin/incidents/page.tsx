import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPageAccess } from "@/lib/admin-auth";
import { PageHeader } from "@/components/ui/page-header";
import {
  IncidentsManagement,
  type IncidentRecord,
} from "@/components/admin/incidents-management";

export const metadata: Metadata = {
  title: "Incidents & Service Disruptions — CosmoRide Admin",
  description: "Transport incident desk, mechanical issues, delay investigations, and resolution logs.",
};

export const dynamic = "force-dynamic";

export default async function AdminIncidentsPage() {
  await requireAdminPageAccess("incidents");
  const supabase = await createClient();

  // Fetch all incident reports
  const { data: incidentsData } = await supabase
    .from("incident_reports")
    .select(`
      id,
      category,
      severity,
      status,
      description,
      resolution_notes,
      created_at,
      resolved_at,
      reporter:profiles(
        full_name,
        role
      ),
      journey:journeys(
        route:routes(code),
        vehicle:vehicles(registration_number)
      )
    `)
    .order("created_at", { ascending: false });

  const incidents: IncidentRecord[] = (incidentsData ?? []).map((inc) => {
    const reporter = Array.isArray(inc.reporter) ? inc.reporter[0] : inc.reporter;
    const journey = Array.isArray(inc.journey) ? inc.journey[0] : inc.journey;
    const route = Array.isArray(journey?.route) ? journey?.route[0] : journey?.route;
    const vehicle = Array.isArray(journey?.vehicle) ? journey?.vehicle[0] : journey?.vehicle;

    return {
      id: inc.id,
      category: inc.category,
      severity: inc.severity as IncidentRecord["severity"],
      status: inc.status as IncidentRecord["status"],
      description: inc.description,
      resolutionNotes: inc.resolution_notes,
      createdAt: inc.created_at,
      resolvedAt: inc.resolved_at,
      reporterName: reporter?.full_name || "Staff Member",
      reporterRole: reporter?.role || "operations",
      routeCode: route?.code || null,
      vehiclePlate: vehicle?.registration_number || null,
    };
  });

  return (
    <div>
      <PageHeader
        title="Incident Desk &amp; Disruptions Log"
        description="Review reported vehicle faults, operational bottlenecks, student conduct issues, and official resolutions."
      />

      <IncidentsManagement initialIncidents={incidents} />
    </div>
  );
}

