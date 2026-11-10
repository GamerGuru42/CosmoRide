"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side login form component for authorized staff and administrators.
 * Handles email/password sign-in via Supabase Auth with role-based routing.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, student_id")
          .eq("id", data.user.id)
          .single();

        if (profile?.role === "admin") {
          router.push("/admin");
        } else if (profile?.role === "boarding_officer") {
          router.push("/boarding");
        } else if (profile?.role === "driver") {
          router.push("/driver");
        } else if (!profile?.student_id) {
          router.push("/register");
        } else {
          router.push("/student");
        }
        router.refresh();
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-xs font-semibold text-slate-700"
        >
          Staff Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-xs shadow-2xs placeholder:text-slate-400 focus:border-[#102D4A] focus:outline-none focus:ring-1 focus:ring-[#102D4A]"
          placeholder="staff.member@cosmopolitan.edu.ng"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs font-semibold text-slate-700"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-xs shadow-2xs placeholder:text-slate-400 focus:border-[#102D4A] focus:outline-none focus:ring-1 focus:ring-[#102D4A]"
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#102D4A] focus:outline-none focus:ring-2 focus:ring-[#102D4A] focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? "Signing in…" : "Sign In with Password"}
      </button>
    </form>
  );
}
