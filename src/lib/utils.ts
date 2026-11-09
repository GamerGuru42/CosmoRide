/**
 * Merge CSS class names, filtering out falsy values.
 * A lightweight implementation without external dependencies.
 * When ready, install clsx + tailwind-merge for conflict resolution.
 */
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

/**
 * Format a date for display in Nigerian locale.
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
  }).format(new Date(date));
}

/**
 * Format a time for display.
 */
export function formatTime(time: string | Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeStyle: "short",
  }).format(new Date(time));
}

/**
 * Format a datetime for display.
 */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
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
