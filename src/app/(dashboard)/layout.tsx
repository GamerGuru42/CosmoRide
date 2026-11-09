import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";

/**
 * Protected dashboard layout.
 * Verifies authentication and loads the user's profile.
 * Wraps all role-based dashboard pages.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // If no profile exists yet (e.g., trigger hasn't fired), show a loading state
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-[#102D4A]" />
          <p className="text-sm text-[#526B82]">Setting up your profile…</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell
      user={{
        id: user.id,
        email: user.email ?? "",
        fullName: profile.full_name,
        role: profile.role,
        avatarUrl: profile.avatar_url,
        studentId: profile.student_id,
      }}
    >
      {children}
    </DashboardShell>
  );
}
