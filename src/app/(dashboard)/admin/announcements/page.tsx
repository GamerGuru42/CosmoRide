import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  AnnouncementsManagement,
  type AnnouncementItem,
  type TransportGroupOption,
  type CampusOption,
} from "@/components/admin/announcements-management";

export const metadata: Metadata = {
  title: "Announcements & Notices — CosmoRide Admin",
  description: "Broadcast official transport announcements and service updates across university campuses.",
};

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
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

  // Fetch announcements
  const { data: annData } = await supabase
    .from("announcements")
    .select(`
      id,
      title,
      content,
      target_role,
      is_active,
      created_at,
      expires_at,
      author:profiles(full_name),
      transport_group:transport_groups(name),
      campus:campuses(name)
    `)
    .order("created_at", { ascending: false });

  const announcements: AnnouncementItem[] = (annData ?? []).map((a) => {
    const author = Array.isArray(a.author) ? a.author[0] : a.author;
    const tg = Array.isArray(a.transport_group) ? a.transport_group[0] : a.transport_group;
    const campus = Array.isArray(a.campus) ? a.campus[0] : a.campus;

    return {
      id: a.id,
      title: a.title,
      content: a.content,
      targetRole: a.target_role,
      transportGroupName: tg?.name || null,
      campusName: campus?.name || null,
      isActive: a.is_active,
      createdAt: a.created_at,
      expiresAt: a.expires_at,
      authorName: author?.full_name || "Transport Administration",
    };
  });

  // Fetch transport groups & campuses
  const { data: tgData } = await supabase
    .from("transport_groups")
    .select("id, name")
    .order("name", { ascending: true });

  const transportGroups: TransportGroupOption[] = (tgData ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }));

  const { data: campusData } = await supabase
    .from("campuses")
    .select("id, name")
    .order("name", { ascending: true });

  const campuses: CampusOption[] = (campusData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div>
      <PageHeader
        title="Announcements &amp; Passenger Communications"
        description="Publish university-wide transit bulletins, corridor notifications, and service disruption alerts."
      />

      <AnnouncementsManagement
        initialAnnouncements={announcements}
        transportGroups={transportGroups}
        campuses={campuses}
      />
    </div>
  );
}

