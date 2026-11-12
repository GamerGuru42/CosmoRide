import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { getRoleHome, isAllowedAdminSubRole } from "@/lib/role-routing";

/**
 * Updates the Supabase auth session from middleware.
 * Ensures cookies stay fresh on every request and enforces route access controls.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and supabase.auth.getUser().
  // A simple mistake could make it very hard to debug issues with users
  // being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Define public routes that don't require authentication
  const publicPaths = ["/", "/login", "/register"];
  const isPublicPath =
    publicPaths.some((path) => pathname === path) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth/");

  const redirectWithCookies = (destinationUrl: URL | string) => {
    const redirectResponse = NextResponse.redirect(destinationUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  };

  if (!user && !isPublicPath) {
    // Not authenticated and trying to access protected route
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return redirectWithCookies(url);
  }

  if (user) {
    const isLogin = pathname === "/login";
    const isRegister = pathname === "/register";
    const isStudentRoute = pathname.startsWith("/student");
    const isBoardingRoute = pathname.startsWith("/boarding");
    const isDriverRoute = pathname.startsWith("/driver");
    const isAdminRoute = pathname.startsWith("/admin");

    if (
      isLogin ||
      isRegister ||
      isStudentRoute ||
      isBoardingRoute ||
      isDriverRoute ||
      isAdminRoute
    ) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, admin_role, student_id, is_active")
        .eq("id", user.id)
        .single();

      if (profile && profile.is_active === false) {
        await supabase.auth.signOut();
        const url = new URL("/login", request.url);
        url.searchParams.set("error", "account_inactive");
        return redirectWithCookies(url);
      }

      if (profile) {
        const isStudent = profile.role === "student";
        const hasCompleteProfile = Boolean(
          profile.student_id && profile.student_id.trim() !== ""
        );
        const roleHome = isStudent
          ? hasCompleteProfile
            ? "/student"
            : "/register"
          : getRoleHome(profile.role, profile.admin_role);

        // If accessing /login while already logged in
        if (isLogin) {
          return redirectWithCookies(new URL(roleHome, request.url));
        }

        // If accessing /register while already possessing a complete profile or non-student role
        if (isRegister) {
          if ((isStudent && hasCompleteProfile) || !isStudent) {
            return redirectWithCookies(new URL(roleHome, request.url));
          }
        }

        // Enforce strict role-group isolation across protected routes
        if (isStudentRoute) {
          if (!isStudent) {
            return redirectWithCookies(new URL(roleHome, request.url));
          }
          if (!hasCompleteProfile) {
            const url = new URL("/register", request.url);
            url.searchParams.set("reason", "incomplete_profile");
            return redirectWithCookies(url);
          }
        }

        if (isAdminRoute && profile.role !== "admin") {
          return redirectWithCookies(new URL(roleHome, request.url));
        }

        const isSupervisoryAdmin =
          profile.role === "admin" && isAllowedAdminSubRole(profile.admin_role);

        if (isBoardingRoute && profile.role !== "boarding_officer" && !isSupervisoryAdmin) {
          return redirectWithCookies(new URL(roleHome, request.url));
        }

        if (isDriverRoute && profile.role !== "driver" && !isSupervisoryAdmin) {
          return redirectWithCookies(new URL(roleHome, request.url));
        }
      }
    }
  }

  return supabaseResponse;
}
