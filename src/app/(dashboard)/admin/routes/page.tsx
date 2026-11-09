import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  RoutesManagement,
  type RouteItem,
  type TransportGroupOption,
  type StopOption,
} from "@/components/admin/routes-management";

export const metadata: Metadata = {
  title: "Routes & Stops — CosmoRide Admin",
  description: "Configure university transit routes, ordered pickup stops, and transit travel times.",
};

export const dynamic = "force-dynamic";

export default async function AdminRoutesPage() {
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

  // Fetch routes with transport group and route stops
  const { data: routesData } = await supabase
    .from("routes")
    .select(`
      id,
      code,
      name,
      description,
      gender_group,
      transport_group_id,
      is_active,
      transport_group:transport_groups(
        id,
        name
      ),
      route_stops(
        stop_id,
        stop_order,
        estimated_minutes_from_start,
        stop:stops(
          id,
          name,
          campus:campuses(name)
        )
      )
    `)
    .order("code", { ascending: true });

  const routes: RouteItem[] = (routesData ?? []).map((r) => {
    const tg = Array.isArray(r.transport_group) ? r.transport_group[0] : r.transport_group;
    const sortedStops = (r.route_stops ?? [])
      .sort((a, b) => a.stop_order - b.stop_order)
      .map((rs) => {
        const stop = Array.isArray(rs.stop) ? rs.stop[0] : rs.stop;
        const campus = Array.isArray(stop?.campus) ? stop?.campus[0] : stop?.campus;
        return {
          stopId: rs.stop_id,
          stopName: stop?.name || "Campus Stop",
          campusName: campus?.name || null,
          stopOrder: rs.stop_order,
          estimatedMinutesFromStart: rs.estimated_minutes_from_start,
        };
      });

    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      genderGroup: (r.gender_group || "mixed") as RouteItem["genderGroup"],
      transportGroupId: r.transport_group_id,
      transportGroupName: tg?.name || "General Transport Group",
      isActive: r.is_active,
      stops: sortedStops,
    };
  });

  // Fetch transport groups for dropdown
  const { data: tgData } = await supabase
    .from("transport_groups")
    .select("id, name, gender_group")
    .order("name", { ascending: true });

  const transportGroups: TransportGroupOption[] = (tgData ?? []).map((tg) => ({
    id: tg.id,
    name: tg.name,
    genderGroup: tg.gender_group,
  }));

  // Fetch all stops for dropdown
  const { data: stopsData } = await supabase
    .from("stops")
    .select("id, name, campus:campuses(name)")
    .order("name", { ascending: true });

  const availableStops: StopOption[] = (stopsData ?? []).map((s) => {
    const campus = Array.isArray(s.campus) ? s.campus[0] : s.campus;
    return {
      id: s.id,
      name: s.name,
      campusName: campus?.name || null,
    };
  });

  return (
    <div>
      <PageHeader
        title="Routes &amp; Stop Itineraries"
        description="Configure university transit routes, ordered intermediate stops, and transit timing between Main Campus and Kado Campus."
      />

      <RoutesManagement
        initialRoutes={routes}
        transportGroups={transportGroups}
        availableStops={availableStops}
      />
    </div>
  );
}

