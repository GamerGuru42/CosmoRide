import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

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

    // Perform profile check only on routes where routing or profile completeness matters
    if (isLogin || isRegister || isStudentRoute) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, student_id")
        .eq("id", user.id)
        .single();

      if (profile) {
        const isStudent = profile.role === "student";
        const hasCompleteProfile = Boolean(
          profile.student_id && profile.student_id.trim() !== ""
        );

        // If accessing /login while already logged in
        if (isLogin) {
          if (isStudent) {
            return redirectWithCookies(
              new URL(hasCompleteProfile ? "/student" : "/register", request.url)
            );
          } else {
            const dest =
              profile.role === "admin"
                ? "/admin"
                : profile.role === "boarding_officer"
                ? "/boarding"
                : "/driver";
            return redirectWithCookies(new URL(dest, request.url));
          }
        }

        // If accessing /register while already possessing a complete profile
        if (isRegister) {
          if (isStudent && hasCompleteProfile) {
            return redirectWithCookies(new URL("/student", request.url));
          } else if (!isStudent) {
            const dest =
              profile.role === "admin"
                ? "/admin"
                : profile.role === "boarding_officer"
                ? "/boarding"
                : "/driver";
            return redirectWithCookies(new URL(dest, request.url));
          }
        }

        // If accessing /student or /student/* with incomplete profile
        if (isStudentRoute && isStudent && !hasCompleteProfile) {
          const url = new URL("/register", request.url);
          url.searchParams.set("reason", "incomplete_profile");
          return redirectWithCookies(url);
        }
      }
    }
  }

  return supabaseResponse;
}
