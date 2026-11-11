import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPageAccess } from "@/lib/admin-auth";
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
  await requireAdminPageAccess("settings");
  const supabase = await createClient();

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

