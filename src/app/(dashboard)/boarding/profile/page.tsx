import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, DEVELOPER_ATTRIBUTION } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Officer Profile & Transport Authorization — CosmoRide",
  description: "Boarding officer operational profile and hostel fleet assignment.",
};

export const dynamic = "force-dynamic";

export default async function BoardingOfficerProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch full officer profile
  const { data: profile } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      phone,
      role,
      avatar_url,
      assigned_transport_group_id,
      hostel_id,
      created_at
    `)
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "boarding_officer" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch transport group info
  let transportGroup = null;
  if (profile.assigned_transport_group_id) {
    const { data: tg } = await supabase
      .from("transport_groups")
      .select("name, code, description")
      .eq("id", profile.assigned_transport_group_id)
      .single();
    transportGroup = tg;
  }

  // Fetch hostel info
  let hostel = null;
  if (profile.hostel_id) {
    const { data: h } = await supabase
      .from("hostels")
      .select("id, name, campus_id")
      .eq("id", profile.hostel_id)
      .single();
    hostel = h;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#102D4A]">
          Officer Profile & Authorization
        </h1>
        <p className="text-xs text-[#526B82] mt-0.5">
          Authorized university boarding representative details and operation assignments.
        </p>
      </div>

      {/* Main Identity Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#102D4A] text-xl font-extrabold text-white">
            {profile.full_name
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#102D4A]">
              {profile.full_name}
            </h2>
            <p className="text-xs text-[#526B82]">{user.email}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#102D4A]">
                {ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-[#20A477]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#20A477]" />
                Active Personnel
              </span>
            </div>
          </div>
        </div>

        {/* Locked Authorization Details */}
        <div className="grid gap-3 pt-3 border-t border-slate-100 sm:grid-cols-2 text-xs">
          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Assigned Hostel Operation / Fleet
            </span>
            <span className="text-sm font-bold text-[#102D4A] block">
              {transportGroup?.name || "All Operations (Supervisory)"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              {transportGroup?.description || "University-wide transport oversight"}
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Assigned Hostel / Base
            </span>
            <span className="text-sm font-bold text-[#102D4A] block">
              {hostel?.name || "Main Campus Terminal"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              Primary passenger verification post
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Contact Phone
            </span>
            <span className="text-sm font-bold text-[#102D4A] block font-mono">
              {profile.phone || "Not configured"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              Operational transit dispatch contact
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Access Restriction Level
            </span>
            <span className="text-sm font-bold text-[#20A477] block">
              Row Level Security Enforced
            </span>
            <span className="text-[11px] text-[#526B82] block">
              Cross-group manifests restricted
            </span>
          </div>
        </div>

        {/* Security Warning Notice */}
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <span>🔒</span>
            <span>Security Policy Notice</span>
          </div>
          <p className="leading-relaxed">
            In accordance with university transport governance, boarding officers cannot alter their assigned transport group or elevate privileges. For operation re-assignment, contact the Directorate of University Transport.
          </p>
        </div>
      </div>

      {/* Attribution Footer */}
      <div className="text-center text-xs text-[#526B82] pt-4">
        <p>CosmoRide — Cosmopolitan University, Nigeria</p>
        <p className="mt-0.5">{DEVELOPER_ATTRIBUTION}</p>
      </div>
    </div>
  );
}
