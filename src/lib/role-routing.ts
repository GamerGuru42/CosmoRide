import type { AdminRoleType, UserRole } from "@/lib/supabase/types";

export const ALLOWED_ADMIN_SUB_ROLES: readonly AdminRoleType[] = [
  "super_admin",
  "bus_manager",
  "hostel_manager",
];

export type AdminDomain =
  | "overview"
  | "operations"
  | "dispatch"
  | "oversight"
  | "users"
  | "routes"
  | "schedules"
  | "vehicles"
  | "drivers"
  | "journeys"
  | "journey_create"
  | "incidents"
  | "announcements"
  | "reports"
  | "audit"
  | "settings";

const ADMIN_DOMAIN_ROLES: Record<AdminDomain, readonly AdminRoleType[]> = {
  overview: ["super_admin", "hostel_manager"],
  operations: ["super_admin", "bus_manager", "hostel_manager"],
  dispatch: ["super_admin", "bus_manager", "hostel_manager"],
  oversight: ["super_admin", "hostel_manager"],
  users: ["super_admin"],
  routes: ["super_admin"],
  schedules: ["super_admin", "bus_manager"],
  vehicles: ["super_admin", "bus_manager"],
  drivers: ["super_admin", "bus_manager"],
  journeys: ["super_admin", "bus_manager", "hostel_manager"],
  journey_create: ["super_admin", "bus_manager"],
  incidents: ["super_admin", "bus_manager", "hostel_manager"],
  announcements: ["super_admin", "bus_manager", "hostel_manager"],
  reports: ["super_admin", "hostel_manager"],
  audit: ["super_admin", "hostel_manager"],
  settings: ["super_admin"],
};

export function isAllowedAdminSubRole(
  adminRole: AdminRoleType | string | null | undefined
): adminRole is AdminRoleType {
  if (!adminRole) return false;
  return (ALLOWED_ADMIN_SUB_ROLES as readonly string[]).includes(adminRole);
}

export function canAccessAdminDomain(
  adminRole: AdminRoleType | string | null | undefined,
  domain: AdminDomain
): boolean {
  if (!adminRole) return false;
  return (ADMIN_DOMAIN_ROLES[domain] as readonly string[]).includes(adminRole);
}

export function getDefaultAdminHome(
  adminRole: AdminRoleType | string | null | undefined
): string {
  if (adminRole === "bus_manager") return "/admin/dispatch";
  return "/admin";
}

export function getRoleHome(
  role: UserRole | string | null | undefined,
  adminRole?: AdminRoleType | string | null
): string {
  if (role === "admin") return getDefaultAdminHome(adminRole);
  if (role === "boarding_officer") return "/boarding";
  if (role === "driver") return "/driver";
  if (role === "student") return "/student";
  return "/login";
}

