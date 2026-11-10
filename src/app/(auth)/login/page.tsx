import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, UNIVERSITY_NAME } from "@/lib/constants";
import { LoginForm } from "./login-form";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export const metadata: Metadata = {
  title: "Sign In | CosmoRide",
  description: "Official Cosmopolitan University Transportation Portal",
};

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    registered?: string;
    reason?: string;
  }>;
}

/**
 * Login page — handles Google OAuth for students and credential sign-in for staff.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = params.error;
  const registered = params.registered;
  const reason = params.reason;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#102D4A] text-white font-black text-xl shadow-xs">
          C
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#102D4A]">
          Sign in to {APP_NAME}
        </h1>
        <p className="mt-1 text-xs text-[#526B82] font-medium">{UNIVERSITY_NAME}</p>
      </div>

      {/* Dynamic Status / Error Alerts */}
      {error === "domain_restricted" && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold text-rose-900">
            <span>⛔</span>
            <span>University Email Required</span>
          </div>
          <p className="leading-relaxed">
            Student access is strictly restricted to official Cosmopolitan University Google Workspace
            accounts (<span className="font-mono font-bold">@cosmopolitan.edu.ng</span>). Personal accounts
            (such as @gmail.com or @yahoo.com) cannot be registered.
          </p>
        </div>
      )}

      {error === "auth_callback_failed" && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold text-amber-800">
            <span>⚠️</span>
            <span>Authentication Failed</span>
          </div>
          <p className="leading-relaxed">
            Your Google authentication could not be completed or the session expired. Please try signing in again.
          </p>
        </div>
      )}

      {reason === "incomplete_profile" && (
        <div
          role="alert"
          className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900 space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold text-blue-800">
            <span>ℹ️</span>
            <span>Profile Incomplete</span>
          </div>
          <p className="leading-relaxed">
            Please sign in with your Google account to finish linking your student matriculation number.
          </p>
        </div>
      )}

      {registered === "true" && (
        <div
          role="alert"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 space-y-1"
        >
          <div className="flex items-center gap-1.5 font-bold text-emerald-800">
            <span>✓</span>
            <span>Registration Successful</span>
          </div>
          <p className="leading-relaxed">
            Your student profile has been registered and linked. You may now access the transport portal.
          </p>
        </div>
      )}

      {/* Primary: Student Google Sign In */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#102D4A] uppercase tracking-wider font-mono">
            Student Portal
          </span>
          <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full border border-blue-200">
            @cosmopolitan.edu.ng
          </span>
        </div>

        <GoogleSignInButton
          label="Sign in with University Google Account"
          redirectTo="/auth/callback"
        />

        <p className="text-[11px] text-[#526B82] text-center leading-relaxed">
          Students must use their official Cosmopolitan University Google Workspace account to sign in and book electric bus seats.
        </p>
      </div>

      {/* Divider */}
      <div className="relative my-4 flex items-center justify-center">
        <div className="w-full border-t border-slate-200"></div>
        <span className="bg-white px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono absolute">
          Or Staff Login
        </span>
      </div>

      {/* Secondary: Staff & Administration Credentials */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-1">
          <span className="text-xs font-bold text-[#526B82] uppercase tracking-wider font-mono">
            Staff & Operational Admin
          </span>
          <span className="text-[10px] text-slate-400">Drivers & Officers</span>
        </div>

        <LoginForm />
      </div>

      {/* Footer Navigation */}
      <p className="text-center text-xs text-[#526B82] pt-2 border-t border-slate-100">
        New student at Cosmopolitan University?{" "}
        <Link
          href="/register"
          className="font-bold text-[#102D4A] hover:underline"
        >
          Self-register here
        </Link>
      </p>
    </div>
  );
}
