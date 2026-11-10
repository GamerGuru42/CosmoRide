import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  LiveOperationsView,
  type LiveJourneyOperation,
  type LiveStopMilestone,
  type LivePassenger,
} from "@/components/admin/live-operations-view";

export const metadata: Metadata = {
  title: "Live Operations Monitor — CosmoRide Admin",
  description: "Real-time dispatch telemetry, stop milestones, vehicle readiness, and provenance monitoring.",
};

export const dynamic = "force-dynamic";

interface AdminOperationsPageProps {
  searchParams: Promise<{ journey?: string }>;
}

export default async function AdminOperationsPage({
  searchParams,
}: AdminOperationsPageProps) {
  const resolvedParams = await searchParams;
  const targetJourneyId = resolvedParams.journey;
  const todayStr = getTodayDateString();

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

  // Fetch today's journeys with full operational telemetry
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
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
        safe_capacity
      ),
      driver_record:drivers(
        full_name,
        has_app_access
      ),
      bookings(
        id,
        status,
        passenger_category,
        pickup_stop:stops(name),
        profile:profiles(
          full_name,
          student_id
        ),
        boarding_records(
          scanned_at
        )
      ),
      vehicle_readiness_checks(
        status,
        vehicle_safe,
        notes,
        created_at
      ),
      journey_stop_updates(
        id,
        event_type,
        created_at,
        notes,
        is_assisted,
        stop:stops(name)
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  const journeys: LiveJourneyOperation[] = (journeysData ?? []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const vehicle = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const driver = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
    const tg = route?.transport_group;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    // Safety checks
    const latestCheck = (j.vehicle_readiness_checks ?? []).sort(
      (a: { created_at: string }, b: { created_at: string }) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    let safetyCheckStatus: "passed" | "failed_unsafe" | "pending" = "pending";
    if (latestCheck) {
      safetyCheckStatus =
        latestCheck.status === "passed" || latestCheck.vehicle_safe
          ? "passed"
          : "failed_unsafe";
    }

    // Stop milestones
    const milestones: LiveStopMilestone[] = (j.journey_stop_updates ?? [])
      .sort(
        (a: { created_at: string }, b: { created_at: string }) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((u: Record<string, unknown>) => {
        const stop = Array.isArray(u.stop) ? u.stop[0] : u.stop;
        return {
          id: String(u.id),
          stopName: (stop as { name?: string })?.name || "Campus Stop",
          updateType: u.event_type as LiveStopMilestone["updateType"],
          timestamp: String(u.created_at),
          notes: (u.notes as string) || null,
          reportedByRole: Boolean(u.is_assisted) ? "boarding_officer" : "driver",
          isAssisted: Boolean(u.is_assisted),
        };
      });

    // Delays
    const isDelayed = (j.delay_minutes || 0) > 0;

    // Bookings & Passengers
    const confirmedList = (j.bookings ?? []).filter(
      (b: { status: string }) => b.status === "confirmed" || b.status === "boarded"
    );

    const boardedList = (j.bookings ?? []).filter(
      (b: { status: string }) => b.status === "boarded"
    );

    const passengers: LivePassenger[] = (j.bookings ?? []).map((b: Record<string, unknown>) => {
      const prof = Array.isArray(b.profile) ? b.profile[0] : b.profile;
      const pStop = Array.isArray(b.pickup_stop) ? b.pickup_stop[0] : b.pickup_stop;
      const bRecords = Array.isArray(b.boarding_records) ? b.boarding_records : [];
      const boardedAt = bRecords[0]?.scanned_at || null;

      return {
        id: String(b.id),
        studentName: (prof as { full_name?: string })?.full_name || "Student",
        matricNumber: (prof as { student_id?: string })?.student_id || null,
        status: b.status as LivePassenger["status"],
        passengerCategory: (b.passenger_category as "seated" | "standing") || "seated",
        boardingStopName: (pStop as { name?: string })?.name || "Campus Stop",
        boardedAt,
      };
    });

    let driverMode: "app" | "assisted" | "unassigned" = "unassigned";
    if (driver) {
      driverMode = driver.has_app_access ? "app" : "assisted";
    }

    const effectiveLatestDeparture = j.latest_permitted_departure || j.scheduled_departure;
    const isOverdue =
      (j.status === "scheduled" || j.status === "boarding") &&
      !j.actual_departure &&
      new Date() > new Date(effectiveLatestDeparture);

    return {
      id: j.id,
      scheduledDeparture: j.scheduled_departure,
      latestPermittedDeparture: j.latest_permitted_departure || null,
      actualDeparture: j.actual_departure,
      actualArrival: j.actual_arrival,
      status: j.status as LiveJourneyOperation["status"],
      isOverdue,
      routeCode: route?.code || "RT",
      routeName: route?.name || "Route",
      transportGroupName: tgName || "General Corridor",
      vehiclePlate: vehicle?.registration_number || null,
      vehicleName: vehicle?.name || null,
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
      driverName: driver?.full_name || null,
      driverMode,
      bookedCount: confirmedList.length,
      boardedCount: boardedList.length,
      safetyCheckStatus,
      safetyCheckNotes: latestCheck?.notes || null,
      milestones,
      isDelayed,
      delayMinutes: j.delay_minutes || 0,
      delayReason: j.delay_reason || null,
      passengers,
    };
  });

  return (
    <div>
      <PageHeader
        title="Live Operations &amp; Dispatch Telemetry"
        description="Monitor today's active bus operations with milestone verification, safety pre-flight inspection gate, and driver provenance tracking."
      />

      <LiveOperationsView
        initialJourneyId={targetJourneyId}
        journeys={journeys}
      />
    </div>
  );
}
