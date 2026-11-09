import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StudentNotificationsView, type StudentNotification } from "@/components/student/student-notifications-view";

export const metadata: Metadata = {
  title: "Notifications & Alerts | CosmoRide",
  description: "Operational transit alerts and journey notices for Cosmopolitan University",
};

export default async function StudentNotificationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: rawNotifications } = await supabase
    .from("notifications")
    .select("id, title, message, type, related_journey_id, is_read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const notifications: StudentNotification[] = (rawNotifications || []).map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    relatedJourneyId: n.related_journey_id,
    isRead: n.is_read,
    createdAt: n.created_at,
  }));

  return <StudentNotificationsView notifications={notifications} />;
}

