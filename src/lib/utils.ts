/**
 * Merge CSS class names, filtering out falsy values.
 * A lightweight implementation without external dependencies.
 * When ready, install clsx + tailwind-merge for conflict resolution.
 */
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

/**
 * Standard operating timezone for Cosmopolitan University, Nigeria.
 */
export const APP_TIMEZONE = "Africa/Lagos";

/**
 * Format a date for display in Nigerian locale (Africa/Lagos).
 */
export function formatDate(date: string | Date): string {
  const d =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? new Date(`${date.trim()}T12:00:00+01:00`)
      : new Date(date);

  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeZone: APP_TIMEZONE,
  }).format(d);
}

/**
 * Format a time for display in Nigerian locale (Africa/Lagos).
 * Robustly parses plain time strings ('07:30:00', '14:00') as well as full ISO datetime strings.
 */
export function formatTime(time: string | Date): string {
  if (typeof time === "string") {
    const trimmed = time.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const [h, m] = trimmed.split(":").map(Number);
      const period = h >= 12 ? "pm" : "am";
      const hour12 = h % 12 || 12;
      return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
    }
  }

  return new Intl.DateTimeFormat("en-NG", {
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(new Date(time));
}

/**
 * Format a datetime for display in Nigerian locale (Africa/Lagos).
 */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(new Date(date));
}

/**
 * Returns today's operating date formatted as YYYY-MM-DD in the Nigerian timezone (Africa/Lagos).
 */
export function getTodayDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
  }).format(date);
}

/**
 * Calculate available seats for a journey.
 * Bookable seats = min(proposed_allocation, vehicle safe_capacity) - booked_count
 */
export function calculateAvailableSeats(
  proposedAllocation: number,
  safeCapacity: number,
  bookedCount: number
): number {
  const maxSeats = Math.min(proposedAllocation, safeCapacity);
  return Math.max(0, maxSeats - bookedCount);
}

/**
 * Get day of week name from number (0=Sunday).
 */
export function getDayName(dayOfWeek: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[dayOfWeek] ?? "Unknown";
}
