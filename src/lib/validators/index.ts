import { z } from "zod";

/**
 * Validation schemas for CosmoRide.
 * Used for both client-side form validation and server-side request validation.
 */

// ============================================================
// Auth
// ============================================================

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  fullName: z.string().min(2, "Full name is required"),
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/, "Please enter a valid phone number")
    .optional()
    .or(z.literal("")),
  studentId: z
    .string()
    .min(1, "Student ID is required")
    .optional()
    .or(z.literal("")),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// ============================================================
// Campus & Hostel
// ============================================================

export const campusSchema = z.object({
  name: z.string().min(2, "Campus name is required"),
  code: z
    .string()
    .min(2, "Campus code is required")
    .max(10)
    .toUpperCase(),
  address: z.string().optional(),
});

export const hostelSchema = z.object({
  name: z.string().min(2, "Hostel name is required"),
  campusId: z.string().uuid("Invalid campus"),
  gender: z.enum(["male", "female", "mixed"]),
});

// ============================================================
// Routes & Stops
// ============================================================

export const routeSchema = z.object({
  name: z.string().min(2, "Route name is required"),
  code: z.string().min(2, "Route code is required").max(20).toUpperCase(),
  description: z.string().optional(),
  genderGroup: z.enum(["male", "female", "all"]),
});

export const stopSchema = z.object({
  name: z.string().min(2, "Stop name is required"),
  campusId: z.string().uuid().optional().nullable(),
  address: z.string().optional(),
});

// ============================================================
// Vehicles
// ============================================================

export const vehicleSchema = z.object({
  registrationNumber: z
    .string()
    .min(3, "Registration number is required"),
  name: z.string().optional(),
  safeCapacity: z
    .number()
    .int()
    .min(1, "Capacity must be at least 1")
    .max(200, "Capacity seems too high"),
  vehicleType: z.string().default("electric_bus"),
});

// ============================================================
// Schedules
// ============================================================

export const scheduleSchema = z.object({
  routeId: z.string().uuid("Invalid route"),
  dayOfWeek: z.number().int().min(0).max(6),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM format"),
  direction: z.enum(["outbound", "inbound"]),
  proposedAllocation: z
    .number()
    .int()
    .min(1, "Allocation must be at least 1"),
  notes: z.string().optional(),
});

// ============================================================
// Journeys
// ============================================================

export const createJourneySchema = z.object({
  routeId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
  scheduledDeparture: z.string().datetime(),
  proposedAllocation: z.number().int().min(1),
  scheduleId: z.string().uuid().optional().nullable(),
});

export const updateJourneyStatusSchema = z.object({
  journeyId: z.string().uuid(),
  status: z.enum(["scheduled", "boarding", "in_transit", "completed", "cancelled"]),
  delayMinutes: z.number().int().min(0).optional(),
  delayReason: z.string().optional(),
});

// ============================================================
// Bookings
// ============================================================

export const createBookingSchema = z.object({
  journeyId: z.string().uuid(),
  boardingStopId: z.string().uuid(),
});

export const cancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
});

export const checkInBookingSchema = z.object({
  bookingId: z.string().uuid(),
});

// ============================================================
// Type exports for form usage
// ============================================================

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CampusInput = z.infer<typeof campusSchema>;
export type HostelInput = z.infer<typeof hostelSchema>;
export type RouteInput = z.infer<typeof routeSchema>;
export type StopInput = z.infer<typeof stopSchema>;
export type VehicleInput = z.infer<typeof vehicleSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type CreateJourneyInput = z.infer<typeof createJourneySchema>;
export type UpdateJourneyStatusInput = z.infer<typeof updateJourneyStatusSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

