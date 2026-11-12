import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AdminRoleType, UserRole } from "@/lib/supabase/types";
import {
  ALLOWED_ADMIN_SUB_ROLES,
  canAccessAdminDomain,
  getDefaultAdminHome,
  getRoleHome,
  isAllowedAdminSubRole,
  type AdminDomain,
} from "@/lib/role-routing";

export {
  ALLOWED_ADMIN_SUB_ROLES,
  canAccessAdminDomain,
  getDefaultAdminHome,
  getRoleHome,
  isAllowedAdminSubRole,
  type AdminDomain,
};

export interface VerifiedAdminPageContext {
  userId: string;
  fullName: string;
  adminRole: AdminRoleType | null;
  unassignedAdminRole: boolean;
}

/**
 * Enforces fail-closed administrative authentication and admin_role authorization in SSR pages.
 * Redirects non-admins and out-of-scope sub-roles safely without creating redirect loops.
 */
export async function requireAdminPageAccess(
  domain: AdminDomain
): Promise<VerifiedAdminPageContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, admin_role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || profile.is_active === false) {
    redirect("/login?error=account_inactive");
  }

  if (profile.role !== "admin") {
    redirect(getRoleHome(profile.role, profile.admin_role));
  }

  if (!profile.admin_role) {
    if (domain === "overview") {
      return {
        userId: user.id,
        fullName: profile.full_name || "Administrator",
        adminRole: null,
        unassignedAdminRole: true,
      };
    }
    redirect("/admin");
  }

  if (!canAccessAdminDomain(profile.admin_role, domain)) {
    redirect(getDefaultAdminHome(profile.admin_role));
  }

  return {
    userId: user.id,
    fullName: profile.full_name || "Administrator",
    adminRole: profile.admin_role as AdminRoleType,
    unassignedAdminRole: false,
  };
}

export interface VerifiedOperationalStaffContext {
  userId: string;
  email: string;
  profile: {
    id: string;
    full_name: string;
    phone: string | null;
    role: UserRole;
    admin_role: AdminRoleType | null;
    is_active: boolean;
    assigned_transport_group_id: string | null;
    hostel_id: string | null;
    avatar_url: string | null;
    created_at: string;
  };
}

/**
 * Enforces fail-closed active authentication and role isolation for /boarding and /driver SSR pages.
 * Allows active assigned primary role staff or supervisory admins with a valid admin_role.
 */
export async function requireOperationalStaffPageAccess(
  allowedPrimaryRole: "boarding_officer" | "driver"
): Promise<VerifiedOperationalStaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, role, admin_role, is_active, assigned_transport_group_id, hostel_id, avatar_url, created_at"
    )
    .eq("id", user.id)
    .single();

  if (!profile || profile.is_active === false) {
    redirect("/login?error=account_inactive");
  }

  const isAuthorizedAdmin =
    profile.role === "admin" && isAllowedAdminSubRole(profile.admin_role);

  if (profile.role !== allowedPrimaryRole && !isAuthorizedAdmin) {
    redirect(getRoleHome(profile.role, profile.admin_role));
  }

  return {
    userId: user.id,
    email: user.email || "",
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      phone: profile.phone,
      role: profile.role as UserRole,
      admin_role: profile.admin_role as AdminRoleType | null,
      is_active: profile.is_active,
      assigned_transport_group_id: profile.assigned_transport_group_id,
      hostel_id: profile.hostel_id,
      avatar_url: profile.avatar_url,
      created_at: profile.created_at,
    },
  };
}
