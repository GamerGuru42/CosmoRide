"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface GoogleSignInButtonProps {
  label?: string;
  className?: string;
  redirectTo?: string;
}

/**
 * Google Sign-In button for Cosmopolitan University accounts.
 * Requests authentication via Supabase Auth Google OAuth provider
 * with hosted domain hint (hd: cosmopolitan.edu.ng).
 */
export function GoogleSignInButton({
  label = "Continue with Google",
  className = "",
  redirectTo = "/auth/callback",
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const callbackUrl = `${origin}${redirectTo}`;

      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
            hd: "cosmopolitan.edu.ng",
          },
        },
      });

      if (signInError) {
        // Handle common provider misconfiguration or network errors gracefully
        if (
          signInError.message.includes("provider is not enabled") ||
          signInError.message.includes("Unsupported provider") ||
          signInError.message.includes("not found")
        ) {
          setError(
            "Google sign-in is not yet enabled in the Supabase Dashboard. An administrator must configure the Google OAuth client ID and secret."
          );
        } else {
          setError(signInError.message);
        }
        setLoading(false);
      }
    } catch {
      setError("Failed to initialize Google authentication. Please check your internet connection.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed"
        >
          <div className="flex items-start gap-2">
            <span className="font-bold text-amber-800 shrink-0">⚠️ Configuration Notice:</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        className={`w-full flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#102D4A] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-all ${className}`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2 text-slate-500 font-mono text-xs">
            <svg
              className="animate-spin h-4 w-4 text-[#102D4A]"
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
            Connecting to Google...
          </span>
        ) : (
          <>
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>{label}</span>
          </>
        )}
      </button>
    </div>
  );
}
