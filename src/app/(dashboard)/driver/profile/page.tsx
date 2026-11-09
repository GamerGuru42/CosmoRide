import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, DEVELOPER_ATTRIBUTION } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Driver Profile & Fleet Assignment — CosmoRide",
  description: "Official driver credentials and vehicle assignment details.",
};

export const dynamic = "force-dynamic";

export default async function DriverProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, avatar_url, created_at")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "driver" && profile.role !== "admin")) {
    redirect("/student");
  }

  // Fetch driver record
  const { data: driverRecord } = await supabase
    .from("drivers")
    .select(`
      id,
      driver_reference,
      phone,
      license_number,
      status,
      has_app_access,
      assigned_vehicle:vehicles!drivers_assigned_vehicle_id_fkey (
        registration_number,
        name,
        safe_capacity
      )
    `)
    .eq("profile_id", user.id)
    .maybeSingle();

  const assignedVehicle = Array.isArray(driverRecord?.assigned_vehicle)
    ? driverRecord?.assigned_vehicle[0]
    : driverRecord?.assigned_vehicle;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#102D4A]">
          Driver Credentials & Shift Roster
        </h1>
        <p className="text-xs text-[#526B82] mt-0.5">
          Official transport driver profile and vehicle operating authorization.
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
                Authorized Transit Driver
              </span>
            </div>
          </div>
        </div>

        {/* Operational Credentials Grid */}
        <div className="grid gap-3 pt-3 border-t border-slate-100 sm:grid-cols-2 text-xs">
          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Driver Identification Code
            </span>
            <span className="text-sm font-bold font-mono text-[#102D4A] block">
              {driverRecord?.driver_reference || "DRV-CU-01"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              University Transportation Directorate Ref
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Assigned Fleet Vehicle
            </span>
            <span className="text-sm font-bold text-[#102D4A] block">
              {assignedVehicle?.registration_number || "CU-EB-01"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              {assignedVehicle?.name || "Electric Transit Coach"}
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Contact Phone
            </span>
            <span className="text-sm font-bold text-[#102D4A] block font-mono">
              {driverRecord?.phone || profile.phone || "Not set"}
            </span>
            <span className="text-[11px] text-[#526B82] block">
              Operational transit dispatch contact
            </span>
          </div>

          <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block">
              Operational Access Mode
            </span>
            <span className="text-sm font-bold text-[#20A477] block">
              Mode A: Direct Smartphone Access
            </span>
            <span className="text-[11px] text-[#526B82] block">
              Direct journey execution enabled
            </span>
          </div>
        </div>

        {/* Safety Attribution Notice */}
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-xs text-blue-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <span>🛡️</span>
            <span>Driver Safety Standards</span>
          </div>
          <p className="leading-relaxed">
            All drivers must complete the Pre-Trip Vehicle Readiness Checklist prior to departing university terminals. Speed limits across Main Campus and Kado corridors must be strictly observed.
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
