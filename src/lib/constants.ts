/**
 * Application-wide constants for CosmoRide.
 * All operational values are configurable via the database — these are UI/app defaults only.
 */

export const APP_NAME = "COSMORIDE";
export const APP_DESCRIPTION = "University Bus Booking and Mobility Platform";
export const APP_TAGLINE = "Your University. Your Ride.";
export const UNIVERSITY_NAME = "Cosmopolitan University";
export const DEVELOPER_ATTRIBUTION = "Powered by NextGen Technologies";

/**
 * Brand color hex values (per Phase 3 design direction)
 */
export const BRAND_COLORS = {
  midnightNavy: "#102D4A",
  white: "#FFFFFF",
  bgCanvas: "#F6F8FA",
  slate: "#526B82",
  transitGreen: "#20A477",
  warningAmber: "#E5A13B",
  errorRed: "#D9534F",
} as const;

/**
 * User role labels for display purposes.
 */
export const ROLE_LABELS = {
  student: "Student",
  boarding_officer: "Hostel Representative",
  driver: "Driver",
  admin: "Transport Administrator",
} as const;

/**
 * Role-based dashboard paths.
 */
export const ROLE_DASHBOARDS = {
  student: "/student",
  boarding_officer: "/boarding",
  driver: "/driver",
  admin: "/admin",
} as const;

/**
 * Student navigation items (mobile bottom bar + desktop header)
 */
export const STUDENT_NAV_ITEMS = [
  { href: "/student", label: "Home", icon: "home" },
  { href: "/student/departures", label: "Departures", icon: "departures" },
  { href: "/student/trips", label: "My Trips", icon: "trips" },
  { href: "/student/notifications", label: "Alerts", icon: "notifications" },
  { href: "/student/profile", label: "Profile", icon: "profile" },
] as const;

/**
 * Departure Board (FIDS) Status styling
 */
export const DEPARTURE_STATUS_CONFIG = {
  scheduled: {
    label: "SCHEDULED",
    badgeClass: "bg-slate-100 text-[#526B82] border border-slate-200",
    dotClass: "bg-[#526B82]",
  },
  booking_open: {
    label: "BOOKING OPEN",
    badgeClass: "bg-[#20A477]/10 text-[#20A477] border border-[#20A477]/20",
    dotClass: "bg-[#20A477]",
  },
  boarding: {
    label: "BOARDING NOW",
    badgeClass: "bg-[#E5A13B]/10 text-[#E5A13B] border border-[#E5A13B]/20 animate-pulse",
    dotClass: "bg-[#E5A13B]",
  },
  bus_arrived: {
    label: "BUS ARRIVED",
    badgeClass: "bg-cyan-50 text-cyan-700 border border-cyan-200",
    dotClass: "bg-cyan-600",
  },
  boarding_closed: {
    label: "BOARDING CLOSED",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-300",
    dotClass: "bg-amber-700",
  },
  ready_to_depart: {
    label: "READY TO DEPART",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200",
    dotClass: "bg-blue-600",
  },
  delayed: {
    label: "DELAYED",
    badgeClass: "bg-[#E5A13B]/15 text-[#D9534F] border border-[#D9534F]/30",
    dotClass: "bg-[#D9534F]",
  },
  full: {
    label: "FULL (WAITLIST)",
    badgeClass: "bg-purple-50 text-purple-700 border border-purple-200",
    dotClass: "bg-purple-600",
  },
  in_transit: {
    label: "DEPARTED",
    badgeClass: "bg-[#102D4A]/10 text-[#102D4A] border border-[#102D4A]/20",
    dotClass: "bg-[#102D4A]",
  },
  completed: {
    label: "ARRIVED",
    badgeClass: "bg-gray-100 text-gray-600 border border-gray-200",
    dotClass: "bg-gray-400",
  },
  cancelled: {
    label: "CANCELLED",
    badgeClass: "bg-[#D9534F]/10 text-[#D9534F] border border-[#D9534F]/20",
    dotClass: "bg-[#D9534F]",
  },
} as const;

/**
 * Booking status labels and colors for UI display.
 */
export const BOOKING_STATUS = {
  confirmed: { label: "Confirmed", color: "bg-[#20A477]/10 text-[#20A477] border border-[#20A477]/20" },
  checked_in: { label: "Boarded", color: "bg-[#102D4A]/10 text-[#102D4A] border border-[#102D4A]/20" },
  no_show: { label: "No Show", color: "bg-orange-100 text-orange-800 border border-orange-200" },
  cancelled: { label: "Cancelled", color: "bg-[#D9534F]/10 text-[#D9534F] border border-[#D9534F]/20" },
} as const;
