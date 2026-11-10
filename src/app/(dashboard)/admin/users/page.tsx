import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  UsersManagement,
  type UserProfileItem,
  type TransportGroupOption,
  type HostelOption,
} from "@/components/admin/users-management";

export const metadata: Metadata = {
  title: "Users & Staff Roles — CosmoRide Admin",
  description: "User directory, operational staff role assignments, and fleet isolation settings.",
};

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
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

  // Fetch profiles with transport group and hostel
  const { data: profilesData } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      student_id,
      phone,
      role,
      admin_role,
      assigned_transport_group_id,
      hostel_id,
      created_at,
      transport_group:transport_groups(name),
      hostel:hostels(name)
    `)
    .order("full_name", { ascending: true });

  const users: UserProfileItem[] = (profilesData ?? []).map((p) => {
    const tg = Array.isArray(p.transport_group) ? p.transport_group[0] : p.transport_group;
    const h = Array.isArray(p.hostel) ? p.hostel[0] : p.hostel;

    return {
      id: p.id,
      fullName: p.full_name,
      studentId: p.student_id,
      phone: p.phone,
      role: (p.role || "student") as UserProfileItem["role"],
      adminRole: (p.admin_role as UserProfileItem["adminRole"]) || null,
      assignedTransportGroupId: p.assigned_transport_group_id,
      transportGroupName: tg?.name || null,
      hostelName: h?.name || null,
      hostelId: p.hostel_id,
      createdAt: p.created_at,
    };
  });

  // Fetch transport groups & hostels
  const { data: tgData } = await supabase
    .from("transport_groups")
    .select("id, name")
    .order("name", { ascending: true });

  const transportGroups: TransportGroupOption[] = (tgData ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }));

  const { data: hostelData } = await supabase
    .from("hostels")
    .select("id, name")
    .order("name", { ascending: true });

  const hostels: HostelOption[] = (hostelData ?? []).map((h) => ({
    id: h.id,
    name: h.name,
  }));

  return (
    <div>
      <PageHeader
        title="User Roles &amp; Staff Permissions"
        description="Manage university student accounts, assign boarding officer credentials, and enforce fleet operational boundaries."
      />

      <UsersManagement
        initialUsers={users}
        transportGroups={transportGroups}
        hostels={hostels}
      />
    </div>
  );
}

