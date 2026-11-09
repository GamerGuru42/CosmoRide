"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const phoneSchema = z.string().regex(/^\+?[0-9]{10,15}$/, "Please enter a valid phone number (e.g. +2348012345678)");

/**
 * Updates the student's contact telephone number.
 * Strict check: Students CANNOT modify their role, student ID, or hostel assignments.
 */
export async function updateStudentContactPhone(phone: string) {
  try {
    const validatedPhone = phoneSchema.parse(phone.trim());

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ phone: validatedPhone })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/student/profile");
    return { success: true, message: "Contact phone updated successfully." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update phone number.";
    return { success: false, error: message };
  }
}
