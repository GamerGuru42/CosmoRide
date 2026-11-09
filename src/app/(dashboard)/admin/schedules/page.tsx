import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  SchedulesManagement,
  type ScheduleItem,
  type AvailableRouteOption,
} from "@/components/admin/schedules-management";

export const metadata: Metadata = {
  title: "Schedules & Timetable — CosmoRide Admin",
  description: "Configure weekly bus schedules and bulk-generate daily operating journeys.",
};

export const dynamic = "force-dynamic";

export default async function AdminSchedulesPage() {
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

  // Fetch recurring schedules with route details
  const { data: schedulesData } = await supabase
    .from("schedules")
    .select(`
      id,
      route_id,
      day_of_week,
      departure_time,
      direction,
      proposed_allocation,
      is_active,
      notes,
      route:routes(
        code,
        name
      )
    `)
    .order("day_of_week", { ascending: true })
    .order("departure_time", { ascending: true });

  const schedules: ScheduleItem[] = (schedulesData ?? []).map((s) => {
    const route = Array.isArray(s.route) ? s.route[0] : s.route;
    return {
      id: s.id,
      routeId: s.route_id,
      routeCode: route?.code || "RT",
      routeName: route?.name || "Transit Route",
      dayOfWeek: s.day_of_week,
      departureTime: s.departure_time,
      direction: (s.direction || "outbound") as "outbound" | "inbound",
      proposedAllocation: s.proposed_allocation,
      isActive: s.is_active,
      notes: s.notes,
    };
  });

  // Fetch available routes for selection
  const { data: routesData } = await supabase
    .from("routes")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code", { ascending: true });

  const availableRoutes: AvailableRouteOption[] = (routesData ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  }));

  return (
    <div>
      <PageHeader
        title="Timetable &amp; Schedule Templates"
        description="Configure weekly recurring timetable patterns and bulk-generate daily operating journeys for students."
      />

      <SchedulesManagement
        initialSchedules={schedules}
        availableRoutes={availableRoutes}
      />
    </div>
  );
}

