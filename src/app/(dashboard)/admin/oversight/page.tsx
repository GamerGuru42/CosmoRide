import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import {
  HostelManagerOversightView,
  type OversightJourneyItem,
  type OversightIncidentItem,
  type OversightAuditItem,
} from "@/components/admin/hostel-manager-oversight-view";

export const metadata: Metadata = {
  title: "Hostel Manager Oversight Dashboard — CosmoRide",
  description: "Cross-hostel supervisory dashboard: tracks representative boarding activity, Bus Manager dispatch, and exceptions.",
};

export const dynamic = "force-dynamic";

export default async function HostelManagerOversightPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/student");

  const todayStr = getTodayDateString();

  // Fetch today's journeys across BOTH operations with full workflow timestamps and actor attribution
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      latest_permitted_departure,
      actual_departure,
      bus_arrived_at,
      bus_arrived_by,
      boarding_opened_at,
      boarding_opened_by,
      boarding_closed_at,
      boarding_closed_by,
      departure_authorised_at,
      departure_authorised_by,
      departure_confirmed_by,
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
        safe_capacity
      ),
      driver_record:drivers (
        full_name
      ),
      bookings (
        id,
        status,
        passenger_category
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  const journeys: OversightJourneyItem[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
    const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const tg = route?.transport_groups;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    const rawBookings = j.bookings || [];
    const bookedCount = rawBookings.filter((b) => b.status === "confirmed" || b.status === "checked_in").length;
    const boardedCount = rawBookings.filter((b) => b.status === "checked_in").length;
    const seatedBoarded = rawBookings.filter((b) => b.status === "checked_in" && b.passenger_category === "seated").length;
    const standingBoarded = rawBookings.filter((b) => b.status === "checked_in" && b.passenger_category === "standing").length;

    const effectiveLatestDeparture = j.latest_permitted_departure || j.scheduled_departure;
    const isOverdue =
      (j.status === "scheduled" || j.status === "bus_arrived" || j.status === "boarding") &&
      !j.actual_departure &&
      new Date() > new Date(effectiveLatestDeparture);

    return {
      id: j.id,
      journeyDate: j.journey_date,
      scheduledDeparture: j.scheduled_departure,
      latestPermittedDeparture: j.latest_permitted_departure,
      actualDeparture: j.actual_departure,
      busArrivedAt: j.bus_arrived_at,
      busArrivedBy: j.bus_arrived_by,
      boardingOpenedAt: j.boarding_opened_at,
      boardingOpenedBy: j.boarding_opened_by,
      boardingClosedAt: j.boarding_closed_at,
      boardingClosedBy: j.boarding_closed_by,
      departureAuthorisedAt: j.departure_authorised_at,
      departureAuthorisedBy: j.departure_authorised_by,
      departureConfirmedBy: j.departure_confirmed_by,
      status: j.status as OversightJourneyItem["status"],
      routeCode: route?.code || "ROUTE",
      routeName: route?.name || "University Route",
      transportGroupName: tgName || "General Operation",
      vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
      driverName: driver?.full_name || null,
      bookedCount,
      boardedCount,
      seatedBoarded,
      standingBoarded,
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 30,
      isOverdue,
      delayMinutes: j.delay_minutes || 0,
      delayReason: j.delay_reason || null,
    };
  });

  // Fetch open incidents
  const { data: rawIncidents } = await supabase
    .from("incident_reports")
    .select(`
      id,
      category,
      severity,
      description,
      status,
      created_at,
      reporter:profiles!incident_reports_reported_by_fkey (
        full_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(10);

  const incidents: OversightIncidentItem[] = (rawIncidents ?? []).map((inc) => {
    const reporter = Array.isArray(inc.reporter) ? inc.reporter[0] : inc.reporter;
    return {
      id: inc.id,
      category: inc.category,
      severity: inc.severity as OversightIncidentItem["severity"],
      description: inc.description,
      status: inc.status,
      createdAt: inc.created_at,
      reportedByName: reporter?.full_name || "Staff Member",
    };
  });

  // Fetch recent audit logs for representative and dispatch activity
  const { data: rawAudits } = await supabase
    .from("audit_logs")
    .select(`
      id,
      action,
      entity_type,
      created_at,
      details,
      actor:profiles!audit_logs_user_id_fkey (
        full_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(15);

  const recentAudits: OversightAuditItem[] = (rawAudits ?? []).map((a) => {
    const actor = Array.isArray(a.actor) ? a.actor[0] : a.actor;
    return {
      id: a.id,
      action: a.action,
      userName: actor?.full_name || "System Actor",
      entityType: a.entity_type,
      createdAt: a.created_at,
      details: (a.details as Record<string, unknown>) || {},
    };
  });

  return (
    <div className="space-y-6">
      <HostelManagerOversightView
        currentDate={todayStr}
        hostelManagerName={profile.full_name}
        journeys={journeys}
        incidents={incidents}
        recentAudits={recentAudits}
      />
    </div>
  );
}
