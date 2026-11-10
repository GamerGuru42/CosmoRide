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
// Campus, Hostel & Transport Groups
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
  campusId: z.string().uuid("Invalid campus").optional().nullable(),
  transportGroupId: z.string().uuid().optional().nullable(),
  gender: z.enum(["male", "female", "mixed"]),
});

export const transportGroupSchema = z.object({
  name: z.string().min(2, "Transport group name is required"),
  code: z.string().min(2, "Transport group code is required").max(20).toUpperCase(),
  description: z.string().optional(),
  genderGroup: z.enum(["male", "female", "mixed"]),
});

// ============================================================
// Routes & Stops
// ============================================================

export const routeSchema = z.object({
  name: z.string().min(2, "Route name is required"),
  code: z.string().min(2, "Route code is required").max(20).toUpperCase(),
  description: z.string().optional(),
  genderGroup: z.enum(["male", "female", "all"]),
  transportGroupId: z.string().uuid().optional().nullable(),
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
  status: z.enum([
    "scheduled",
    "bus_arrived",
    "boarding",
    "boarding_closed",
    "ready_to_depart",
    "in_transit",
    "completed",
    "cancelled",
  ]),
  delayMinutes: z.number().int().min(0).optional(),
  delayReason: z.string().optional(),
});

// ============================================================
// Bookings & QR Boarding
// ============================================================

export const createBookingSchema = z.object({
  journeyId: z.string().uuid(),
  boardingStopId: z.string().uuid(),
});

export const cancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
});

export const verifyBoardingPassSchema = z.object({
  ticketToken: z.string().min(16, "Invalid boarding token length"),
  journeyId: z.string().uuid(),
  boardingMethod: z.enum(["qr_scan", "manual_override", "nfc_tap"]).default("qr_scan"),
  exceptionReason: z.string().optional(),
});

// ============================================================
// Announcements & Incidents
// ============================================================

export const announcementSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  content: z.string().min(5, "Content is required"),
  targetRole: z.enum(["student", "boarding_officer", "driver", "admin"]).optional().nullable(),
  routeId: z.string().uuid().optional().nullable(),
  transportGroupId: z.string().uuid().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const incidentReportSchema = z.object({
  journeyId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  category: z.string().min(2, "Category is required"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().min(10, "Please provide more details on the incident"),
});

// ============================================================
// Type exports for form usage
// ============================================================

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CampusInput = z.infer<typeof campusSchema>;
export type HostelInput = z.infer<typeof hostelSchema>;
export type TransportGroupInput = z.infer<typeof transportGroupSchema>;
export type RouteInput = z.infer<typeof routeSchema>;
export type StopInput = z.infer<typeof stopSchema>;
export type VehicleInput = z.infer<typeof vehicleSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type CreateJourneyInput = z.infer<typeof createJourneySchema>;
export type UpdateJourneyStatusInput = z.infer<typeof updateJourneyStatusSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type VerifyBoardingPassInput = z.infer<typeof verifyBoardingPassSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type IncidentReportInput = z.infer<typeof incidentReportSchema>;
