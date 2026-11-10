"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface CompleteStudentProfileResponse {
  success: boolean;
  code?: string;
  error?: string;
  message?: string;
  studentId?: string;
  fullName?: string;
}

/**
 * Server action to link a student's Google identity to their self-declared student identity
 * (full name and matriculation number).
 *
 * Normalizes matriculation number, enforces university domain restriction,
 * and ensures 1-to-1 uniqueness at the database level atomically.
 */
export async function completeStudentProfileAction(formData: {
  fullName: string;
  studentId: string;
}): Promise<CompleteStudentProfileResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        code: "UNAUTHORIZED",
        error: "Your session has expired. Please sign in again with your Google account.",
      };
    }

    const email = user.email?.toLowerCase() ?? "";

    // Domain validation: must be @cosmopolitan.edu.ng
    if (!email.endsWith("@cosmopolitan.edu.ng")) {
      return {
        success: false,
        code: "INVALID_DOMAIN",
        error:
          "Student registration is restricted to official Cosmopolitan University Google Workspace accounts (@cosmopolitan.edu.ng).",
      };
    }

    const trimmedName = formData.fullName?.trim();
    if (!trimmedName || trimmedName.length < 2) {
      return {
        success: false,
        code: "INVALID_NAME",
        error: "Please enter your full legal name (minimum 2 characters).",
      };
    }

    const rawStudentId = formData.studentId?.trim();
    if (!rawStudentId || rawStudentId.length < 3) {
      return {
        success: false,
        code: "INVALID_MATRIC",
        error: "Please enter a valid matriculation / student ID number (minimum 3 characters).",
      };
    }

    // Call atomic database procedure
    const { data: result, error: rpcError } = await supabase.rpc(
      "complete_student_profile",
      {
        p_full_name: trimmedName,
        p_student_id: rawStudentId,
      }
    );

    if (rpcError) {
      return {
        success: false,
        code: "RPC_ERROR",
        error: rpcError.message || "Failed to complete student registration.",
      };
    }

    const parsed = result as {
      success: boolean;
      code?: string;
      error?: string;
      message?: string;
      student_id?: string;
      full_name?: string;
    };

    if (!parsed.success) {
      return {
        success: false,
        code: parsed.code || "REGISTRATION_FAILED",
        error: parsed.error || "Registration could not be completed.",
      };
    }

    revalidatePath("/student");
    revalidatePath("/register");
    revalidatePath("/student/profile");

    return {
      success: true,
      code: parsed.code,
      message: parsed.message,
      studentId: parsed.student_id,
      fullName: parsed.full_name,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return {
      success: false,
      code: "SERVER_ERROR",
      error: message,
    };
  }
}
