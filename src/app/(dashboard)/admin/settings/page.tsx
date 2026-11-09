import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  SettingsManagement,
  type SettingItem,
} from "@/components/admin/settings-management";

export const metadata: Metadata = {
  title: "Policies & Settings — CosmoRide Admin",
  description: "University transport mobility rules, reservation cutoffs, and system policies.",
};

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
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

  // Fetch all system settings
  const { data: settingsData } = await supabase
    .from("system_settings")
    .select("key, value, description, updated_at")
    .order("key", { ascending: true });

  const settings: SettingItem[] = (settingsData ?? []).map((s) => ({
    key: s.key,
    value: s.value,
    description: s.description,
    updatedAt: s.updated_at,
  }));

  return (
    <div>
      <PageHeader
        title="Mobility Policies &amp; System Settings"
        description="Fine-tune booking lead times, cancellation deadlines, and fleet operational policies for Cosmopolitan University."
      />

      <SettingsManagement initialSettings={settings} />
    </div>
  );
}

