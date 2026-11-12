import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoleHome } from "@/lib/role-routing";

/**
 * Auth callback handler for Supabase.
 * Handles the redirect after Google OAuth sign-in or email confirmation.
 *
 * Security & Domain Policy:
 * 1. Exchanges OAuth code for verified session.
 * 2. Authenticates email server-side via Supabase Auth identity (never client input).
 * 3. Enforces @cosmopolitan.edu.ng domain for student self-service registrations.
 * 4. Preserves existing staff and administrator accounts.
 * 5. Directs incomplete student profiles to registration completion.
 * 6. Directs completed profiles to role-appropriate dashboards.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/student";
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (errorParam || errorDescription) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // Retrieve verified authenticated user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const email = (user.email ?? "").toLowerCase().trim();

  // Retrieve user profile to check existing role, active status, and profile completeness
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, admin_role, student_id, full_name, is_active")
    .eq("id", user.id)
    .single();

  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=account_inactive`);
  }

  // If user is already an authorized staff or administrator, redirect to role-appropriate dashboard
  if (profile && ["admin", "boarding_officer", "driver"].includes(profile.role)) {
    return NextResponse.redirect(`${origin}${getRoleHome(profile.role, profile.admin_role)}`);
  }

  // Student accounts: Validate Cosmopolitan University domain (@cosmopolitan.edu.ng)
  const isCosmopolitanDomain = email.endsWith("@cosmopolitan.edu.ng");

  if (!isCosmopolitanDomain) {
    // Invalidate the session immediately so unauthorized domains cannot persist
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_restricted`);
  }

  // Student profile completeness check: requires student_id (matriculation number)
  const isProfileComplete = Boolean(
    profile && profile.student_id && profile.student_id.trim().length >= 3
  );

  if (!isProfileComplete) {
    // Redirect to profile completion page
    return NextResponse.redirect(`${origin}/register`);
  }

  // Completed student profile -> proceed to student dashboard
  const destination = next.startsWith("/student") ? next : "/student";
  return NextResponse.redirect(`${origin}${destination}`);
}
