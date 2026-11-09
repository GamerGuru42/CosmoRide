import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  AuditLogView,
  type AuditLogRow,
} from "@/components/admin/audit-log-view";

export const metadata: Metadata = {
  title: "Audit Logs & Governance — CosmoRide Admin",
  description: "Immutable institutional audit trail of administrative changes, driver assignments, and boarding operations.",
};

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
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

  // Fetch recent audit logs with user info
  const { data: logsData } = await supabase
    .from("audit_logs")
    .select(`
      id,
      action,
      entity_type,
      entity_id,
      details,
      ip_address,
      created_at,
      profile:profiles(
        full_name,
        role
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const logs: AuditLogRow[] = (logsData ?? []).map((l) => {
    const p = Array.isArray(l.profile) ? l.profile[0] : l.profile;

    return {
      id: l.id,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      details: l.details,
      ipAddress: l.ip_address,
      createdAt: l.created_at,
      userName: p?.full_name || "System Automated",
      userRole: p?.role || "system",
    };
  });

  return (
    <div>
      <PageHeader
        title="Audit Logs &amp; Operational Governance"
        description="Immutable system-wide ledger of administrative actions, schedule generation, and boarding overrides."
      />

      <AuditLogView logs={logs} />
    </div>
  );
}

