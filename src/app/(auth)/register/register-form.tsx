"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeStudentProfileAction } from "@/actions/student-auth";
import { createClient } from "@/lib/supabase/client";

interface RegisterFormProps {
  initialEmail: string;
  initialFullName: string;
}

/**
 * Profile completion form for authenticated students.
 * Links the verified Google identity to self-declared student identity
 * (full name and matriculation number).
 */
export function RegisterForm({ initialEmail, initialFullName }: RegisterFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = fullName.trim();
    const rawMatric = studentId.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError("Please enter your full legal name (minimum 2 characters).");
      return;
    }

    if (!rawMatric || rawMatric.length < 3) {
      setError("Please enter your official university matriculation / student ID number.");
      return;
    }

    setLoading(true);

    try {
      const result = await completeStudentProfileAction({
        fullName: trimmedName,
        studentId: rawMatric,
      });

      if (!result.success) {
        if (result.code === "DUPLICATE_MATRIC") {
          setError(
            "This matriculation number is already linked to another student account. If you believe this is an error, please contact university transport administration."
          );
        } else if (result.code === "INVALID_DOMAIN") {
          setError(
            "Student registration requires an official Cosmopolitan University Google account (@cosmopolitan.edu.ng)."
          );
        } else if (result.code === "MATRIC_IMMUTABLE") {
          setError("Your matriculation number has already been registered and cannot be altered.");
        } else {
          setError(result.error || "Failed to complete student registration. Please try again.");
        }
        setLoading(false);
        return;
      }

      // Registration successful: proceed to student dashboard
      router.push("/student");
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please check your connection and try again.");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 leading-relaxed"
        >
          <div className="flex items-start gap-2">
            <span className="font-bold text-rose-900 shrink-0">✕</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Verified Google Account (Read-Only) */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#526B82] font-mono">
            Verified University Identity
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <span>✓</span> Verified Google Account
          </span>
        </div>
        <div className="text-xs font-mono font-bold text-[#102D4A] break-all">
          {initialEmail}
        </div>
        <div className="text-[10px] text-[#526B82]">
          Authentication provided by Google Workspace. Account ownership is securely anchored.
        </div>
      </div>

      {/* Full Name */}
      <div>
        <label
          htmlFor="fullName"
          className="block text-xs font-bold text-[#102D4A] uppercase tracking-wider mb-1"
        >
          Full Legal Name *
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#102D4A] focus:outline-none focus:ring-1 focus:ring-[#102D4A]"
          placeholder="Firstname Middlename Surname"
        />
        <p className="mt-1 text-[10px] text-[#526B82]">
          Pre-populated from Google. Please verify and correct if necessary to match university records.
        </p>
      </div>

      {/* Student ID / Matriculation Number */}
      <div>
        <label
          htmlFor="studentId"
          className="block text-xs font-bold text-[#102D4A] uppercase tracking-wider mb-1"
        >
          Student ID / Matriculation Number *
        </label>
        <input
          id="studentId"
          name="studentId"
          type="text"
          required
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-mono uppercase text-slate-900 placeholder:text-slate-400 focus:border-[#102D4A] focus:outline-none focus:ring-1 focus:ring-[#102D4A]"
          placeholder="e.g. CU/2024/0012 or CU-2023-1042"
        />
        <p className="mt-1 text-[10px] text-[#526B82]">
          Must be unique. Once linked to your Google identity, your matriculation number cannot be altered without administrative approval.
        </p>
      </div>

      {/* Self-Declaration Disclaimer */}
      <div className="rounded-xl bg-blue-50/60 border border-blue-200/80 p-3 text-[11px] text-blue-950 space-y-1">
        <div className="font-bold text-[#102D4A] flex items-center gap-1.5">
          <span>ℹ️</span> Self-Declared Student Identity
        </div>
        <p className="leading-relaxed text-[#526B82]">
          Your name and matriculation number are self-declared at this stage and will appear on your digital boarding passes and bus passenger manifests for campus transit verification.
        </p>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-[#102D4A] px-4 py-3 text-xs font-bold text-white shadow-xs hover:bg-[#18426C] focus:outline-none focus:ring-2 focus:ring-[#102D4A] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin h-3.5 w-3.5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Linking Identity & Activating Account...
          </span>
        ) : (
          "Complete Registration & Link Identity"
        )}
      </button>

      {/* Sign Out Option */}
      <div className="text-center pt-2">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-[11px] text-[#526B82] hover:text-[#102D4A] hover:underline"
        >
          Sign in with a different Google account
        </button>
      </div>
    </form>
  );
}
