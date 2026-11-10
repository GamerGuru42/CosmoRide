"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateStudentContactPhone } from "@/actions/users";
import { formatDate } from "@/lib/utils";
import { APP_NAME, UNIVERSITY_NAME, DEVELOPER_ATTRIBUTION } from "@/lib/constants";
import { UserIcon, CheckCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";

export interface StudentProfileData {
  id: string;
  fullName: string;
  email: string;
  studentId: string | null;
  phone: string | null;
  role: string;
  hostelName: string | null;
  campusName: string | null;
  transportGroupName: string | null;
  createdAt: string;
}

interface StudentProfileViewProps {
  profile: StudentProfileData;
}

export function StudentProfileView({ profile }: StudentProfileViewProps) {
  const router = useRouter();
  const [phone, setPhone] = useState(profile.phone || "");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    startTransition(async () => {
      const res = await updateStudentContactPhone(phone);
      if (res.success) {
        setSuccessMsg(res.message || "Contact phone updated.");
      } else {
        setErrorMsg(res.error || "Failed to update phone.");
      }
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Title Header */}
      <div className="border-b border-slate-200/80 pb-5">
        <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#102D4A]">
          CREDENTIALS & SETTINGS
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-[#102D4A] tracking-tight mt-1">
          Student Profile
        </h1>
        <p className="text-xs text-[#526B82] mt-0.5">
          Official identity and transport group assignment for Cosmopolitan University
        </p>
      </div>

      {/* User Hero Identity Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#102D4A] text-white flex items-center justify-center font-black text-xl font-mono shadow-sm">
            {profile.fullName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[#102D4A]">
                {profile.fullName}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#20A477]/10 text-[#20A477] border border-[#20A477]/20">
                Verified Student
              </span>
            </div>
            <p className="text-xs text-[#526B82] font-mono mt-0.5">
              ID: {profile.studentId || "PENDING REGISTRAR ASSIGNMENT"}
            </p>
            <p className="text-xs text-[#526B82]">
              {profile.email}
            </p>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="self-start sm:self-auto px-4 py-2 rounded-xl text-xs font-bold text-[#D9534F] hover:bg-red-50 border border-red-200 transition-colors"
        >
          Sign Out
        </button>
      </div>

      {/* Institutional Assignments (Strictly Read-Only) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A] uppercase tracking-wider font-mono">
            INSTITUTIONAL ASSIGNMENTS
          </h3>
          <p className="text-xs text-[#526B82] mt-0.5">
            Campus and transport group allocations are configured by the university administration.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="p-3.5 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-semibold text-[#526B82] uppercase tracking-wider block">
              PRIMARY CAMPUS
            </span>
            <p className="text-xs font-bold text-[#102D4A] mt-0.5">
              {profile.campusName || "Main Campus"}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-semibold text-[#526B82] uppercase tracking-wider block">
              RESIDENTIAL HOSTEL
            </span>
            <p className="text-xs font-bold text-[#102D4A] mt-0.5">
              {profile.hostelName || "University Residence"}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-semibold text-[#526B82] uppercase tracking-wider block">
              AUTHORIZED TRANSPORT FLEET
            </span>
            <p className="text-xs font-bold text-[#102D4A] mt-0.5">
              {profile.transportGroupName || "Standard Student Fleet"}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-semibold text-[#526B82] uppercase tracking-wider block">
              PLATFORM ROLE
            </span>
            <p className="text-xs font-bold text-[#102D4A] mt-0.5 uppercase font-mono">
              {profile.role} (Locked)
            </p>
          </div>
        </div>
      </div>

      {/* Editable Contact Information */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A] uppercase tracking-wider font-mono">
            COMMUNICATION PREFERENCES
          </h3>
          <p className="text-xs text-[#526B82] mt-0.5">
            Your phone number is used for urgent departure notifications and driver boarding verification.
          </p>
        </div>

        {successMsg && (
          <div className="p-3 rounded-lg bg-[#20A477]/10 border border-[#20A477]/30 text-xs font-semibold text-[#102D4A] flex items-center gap-2">
            <CheckCircleIcon className="w-4 h-4 text-[#20A477]" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-lg bg-[#D9534F]/10 border border-[#D9534F]/30 text-xs font-semibold text-[#D9534F] flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-[#D9534F]" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePhoneSubmit} className="space-y-3 pt-1">
          <div>
            <label htmlFor="student-phone" className="block text-xs font-semibold text-[#102D4A] mb-1">
              Contact Telephone Number
            </label>
            <input
              id="student-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+234 800 000 0000"
              className="w-full p-2.5 text-xs font-mono bg-white border border-slate-300 rounded-xl text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="px-5 py-2.5 rounded-xl bg-[#102D4A] hover:bg-[#18426C] text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {isPending ? "Updating..." : "Save Phone Number"}
          </button>
        </form>
      </div>

      {/* System Attributions & Security Notice */}
      <div className="text-center pt-4 pb-8 space-y-1 text-xs text-[#526B82]">
        <p className="font-semibold text-[#102D4A]">
          {APP_NAME} — {UNIVERSITY_NAME}
        </p>
        <p className="text-[11px] text-slate-400">
          Member since {formatDate(profile.createdAt)} • {DEVELOPER_ATTRIBUTION}
        </p>
      </div>
    </div>
  );
}

