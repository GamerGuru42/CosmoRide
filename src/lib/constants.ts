/**
 * Application-wide constants for CosmoRide.
 * All operational values are configurable via the database — these are UI/app defaults only.
 */

export const APP_NAME = "CosmoRide";
export const APP_DESCRIPTION = "University Bus Booking and Mobility Platform";
export const APP_TAGLINE = "Your University. Your Ride.";
export const UNIVERSITY_NAME = "Cosmopolitan University";
export const DEVELOPER_ATTRIBUTION = "Powered by NextGen Technologies";

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
 * Journey status labels and colors for UI display.
 */
export const JOURNEY_STATUS = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800" },
  boarding: { label: "Boarding", color: "bg-yellow-100 text-yellow-800" },
  in_transit: { label: "In Transit", color: "bg-green-100 text-green-800" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-800" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800" },
} as const;

/**
 * Booking status labels and colors for UI display.
 */
export const BOOKING_STATUS = {
  confirmed: { label: "Confirmed", color: "bg-green-100 text-green-800" },
  checked_in: { label: "Checked In", color: "bg-blue-100 text-blue-800" },
  no_show: { label: "No Show", color: "bg-orange-100 text-orange-800" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800" },
} as const;

