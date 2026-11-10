import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StudentProfileView, type StudentProfileData } from "@/components/student/student-profile-view";

export const metadata: Metadata = {
  title: "Student Profile & Credentials | CosmoRide",
  description: "View verified university student credentials and transit preferences",
};

export default async function StudentProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch full student profile with hostel and transport group relations
  const { data: profile } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      student_id,
      phone,
      role,
      created_at,
      hostel:hostels (
        name,
        campus:campuses ( name )
      ),
      transport_group:transport_groups ( name )
    `)
    .eq("id", user.id)
    .single();

  if (!profile?.student_id || profile.student_id.trim() === "") {
    redirect("/register?reason=incomplete_profile");
  }

  const hostelInfo = profile?.hostel as unknown as {
    name: string;
    campus?: { name: string } | null;
  } | null;

  const transportGroupInfo = profile?.transport_group as unknown as {
    name: string;
  } | null;

  const profileData: StudentProfileData = {
    id: user.id,
    fullName: profile?.full_name || "Student",
    email: user.email || "",
    studentId: profile?.student_id || null,
    phone: profile?.phone || null,
    role: profile?.role || "student",
    hostelName: hostelInfo?.name || null,
    campusName: hostelInfo?.campus?.name || null,
    transportGroupName: transportGroupInfo?.name || null,
    createdAt: profile?.created_at || new Date().toISOString(),
  };

  return <StudentProfileView profile={profileData} />;
}

