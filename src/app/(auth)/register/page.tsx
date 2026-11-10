import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME, UNIVERSITY_NAME, UNIVERSITY_EMAIL_DOMAIN } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Complete Student Registration | CosmoRide",
  description: "Link your Cosmopolitan University Google account to your student profile",
};

interface RegisterPageProps {
  searchParams: Promise<{
    error?: string;
    reason?: string;
  }>;
}

/**
 * Registration page — orchestrates student self-service registration.
 *
 * State 1: Unauthenticated visitor -> Prompts Google Workspace sign-in.
 * State 2: Authenticated with unauthorized domain -> Rejection alert + switch account.
 * State 3: Authenticated with complete profile -> Redirects to /student.
 * State 4: Authenticated with incomplete profile -> Profile completion form (links matriculation number).
 */
export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const reason = params.reason;
  const error = params.error;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // State 1: Not authenticated -> Step 1: Sign in with Google Workspace
  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#102D4A] text-white font-black text-xl shadow-xs">
            C
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#102D4A]">
            Student Registration
          </h1>
          <p className="mt-1 text-xs text-[#526B82] font-medium">{UNIVERSITY_NAME}</p>
        </div>

        {/* Step indicator */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs text-[#526B82] space-y-2">
          <div className="flex items-center gap-2 font-semibold text-[#102D4A]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#102D4A] text-[10px] font-bold text-white">
              1
            </span>
            <span>Step 1: Authenticate with Google Workspace</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[#526B82]">
            CosmoRide uses self-service student registration. Sign in with your official university
            account (<strong className="text-slate-800">@{UNIVERSITY_EMAIL_DOMAIN}</strong>). In the next step,
            you will enter your legal full name and matriculation number.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
          >
            {error}
          </div>
        )}

        {/* Google Sign-in */}
        <div className="space-y-3">
          <GoogleSignInButton label="Sign in with University Google Account" />
          <p className="text-center text-[11px] text-[#526B82]">
            Only <strong className="font-semibold text-slate-700">@{UNIVERSITY_EMAIL_DOMAIN}</strong> accounts are permitted.
          </p>
        </div>

        {/* Already have an account / staff */}
        <div className="pt-4 border-t border-slate-100 text-center text-xs text-[#526B82]">
          Already completed registration or university staff?{" "}
          <Link
            href="/login"
            className="font-semibold text-[#102D4A] hover:underline"
          >
            Sign in here
          </Link>
        </div>
      </div>
    );
  }

  // State 2: Authenticated with unauthorized domain
  const email = (user.email || "").toLowerCase().trim();
  const domain = email.split("@")[1] || "";
  const isCosmopolitanDomain = domain === UNIVERSITY_EMAIL_DOMAIN.toLowerCase();

  if (!isCosmopolitanDomain) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white font-black text-xl shadow-xs">
            ⛔
          </div>
          <h1 className="text-xl font-bold tracking-tight text-rose-900">
            Unsupported Email Domain
          </h1>
          <p className="mt-1 text-xs text-[#526B82] font-medium">{UNIVERSITY_NAME}</p>
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-2">
          <p className="font-semibold">
            CosmoRide student registration requires an official university account.
          </p>
          <p className="text-[11px] leading-relaxed">
            You signed in as <span className="font-mono font-medium text-rose-950">{user.email}</span>. Only email addresses ending in{" "}
            <span className="font-bold font-mono">@{UNIVERSITY_EMAIL_DOMAIN}</span> are eligible for student self-service registration.
          </p>
        </div>

        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Sign Out & Switch Account
          </button>
        </form>
      </div>
    );
  }

  // Query student profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, student_id, role")
    .eq("id", user.id)
    .single();

  // State 3: Already registered with complete profile
  if (profile?.student_id && profile.student_id.trim() !== "") {
    redirect("/student");
  }

  // If user is staff (admin, boarding_officer, driver), redirect to their respective dashboard
  if (profile && profile.role !== "student") {
    if (profile.role === "admin") redirect("/admin");
    if (profile.role === "boarding_officer") redirect("/boarding");
    if (profile.role === "driver") redirect("/driver");
  }

  // State 4: Authenticated student with incomplete profile -> Show completion form
  const prepopulatedName =
    profile?.full_name ||
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#102D4A] text-white font-black text-xl shadow-xs">
          C
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#102D4A]">
          Complete Student Profile
        </h1>
        <p className="mt-1 text-xs text-[#526B82] font-medium">{UNIVERSITY_NAME}</p>
      </div>

      {/* Reason Banner if redirected from booking or trips */}
      {reason === "incomplete_profile" && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold text-amber-950">
            <span>⚠️</span>
            <span>Registration Incomplete</span>
          </div>
          <p className="text-[11px] text-amber-800">
            Please link your official matriculation number below before reserving seats or accessing boarding passes.
          </p>
        </div>
      )}

      {/* Step indicator */}
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 text-xs text-emerald-900 space-y-1">
        <div className="flex items-center gap-2 font-semibold text-emerald-950">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[10px] font-bold text-white">
            ✓
          </span>
          <span>Google Identity Verified</span>
        </div>
        <p className="text-[11px] text-emerald-800 font-mono pl-7">
          {user.email}
        </p>
      </div>

      {/* Step 2: Register Form */}
      <RegisterForm
        initialEmail={user.email ?? ""}
        initialFullName={prepopulatedName}
      />
    </div>
  );
}
