/**
 * Database type definitions for CosmoRide.
 *
 * Generated/defined for Supabase JS v2 client compatibility.
 * Includes security, waitlist, boarding verification, and auditing schemas.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "student" | "boarding_officer" | "driver" | "admin";
export type Gender = "male" | "female" | "mixed";
export type JourneyStatus =
  | "scheduled"
  | "boarding"
  | "in_transit"
  | "completed"
  | "cancelled";
export type BookingStatus =
  | "confirmed"
  | "checked_in"
  | "no_show"
  | "cancelled";
export type RouteDirection = "outbound" | "inbound";
export type WaitlistStatus = "waiting" | "promoted" | "expired" | "cancelled";
export type BoardingMethod = "qr_scan" | "manual_override" | "nfc_tap";
export type NotificationType =
  | "delay_alert"
  | "booking_confirmed"
  | "booking_cancelled"
  | "waitlist_promoted"
  | "schedule_change"
  | "announcement";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "reported"
  | "investigating"
  | "resolved"
  | "dismissed";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          hostel_id: string | null;
          assigned_transport_group_id: string | null;
          student_id: string | null;
          phone: string | null;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role?: UserRole;
          hostel_id?: string | null;
          assigned_transport_group_id?: string | null;
          student_id?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: UserRole;
          hostel_id?: string | null;
          assigned_transport_group_id?: string | null;
          student_id?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_assigned_transport_group_id_fkey";
            columns: ["assigned_transport_group_id"];
            isOneToOne: false;
            referencedRelation: "transport_groups";
            referencedColumns: ["id"];
          }
        ];
      };
      campuses: {
        Row: {
          id: string;
          name: string;
          code: string;
          address: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          address?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          address?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      hostels: {
        Row: {
          id: string;
          name: string;
          campus_id: string;
          transport_group_id: string | null;
          gender: Gender;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          campus_id: string;
          transport_group_id?: string | null;
          gender: Gender;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          campus_id?: string;
          transport_group_id?: string | null;
          gender?: Gender;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hostels_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostels_transport_group_id_fkey";
            columns: ["transport_group_id"];
            isOneToOne: false;
            referencedRelation: "transport_groups";
            referencedColumns: ["id"];
          }
        ];
      };
      transport_groups: {
        Row: {
          id: string;
          name: string;
          code: string;
          description: string | null;
          gender_group: Gender;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          description?: string | null;
          gender_group?: Gender;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          description?: string | null;
          gender_group?: Gender;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      routes: {
        Row: {
          id: string;
          name: string;
          code: string;
          description: string | null;
          gender_group: Gender;
          transport_group_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          description?: string | null;
          gender_group?: Gender;
          transport_group_id?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          description?: string | null;
          gender_group?: Gender;
          transport_group_id?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "routes_transport_group_id_fkey";
            columns: ["transport_group_id"];
            isOneToOne: false;
            referencedRelation: "transport_groups";
            referencedColumns: ["id"];
          }
        ];
      };
      stops: {
        Row: {
          id: string;
          name: string;
          campus_id: string | null;
          address: string | null;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          campus_id?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          campus_id?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stops_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          }
        ];
      };
      route_stops: {
        Row: {
          id: string;
          route_id: string;
          stop_id: string;
          stop_order: number;
          estimated_minutes_from_start: number;
        };
        Insert: {
          id?: string;
          route_id: string;
          stop_id: string;
          stop_order: number;
          estimated_minutes_from_start?: number;
        };
        Update: {
          id?: string;
          route_id?: string;
          stop_id?: string;
          stop_order?: number;
          estimated_minutes_from_start?: number;
        };
        Relationships: [
          {
            foreignKeyName: "route_stops_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_stops_stop_id_fkey";
            columns: ["stop_id"];
            isOneToOne: false;
            referencedRelation: "stops";
            referencedColumns: ["id"];
          }
        ];
      };
      vehicles: {
        Row: {
          id: string;
          registration_number: string;
          name: string | null;
          safe_capacity: number;
          vehicle_type: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          registration_number: string;
          name?: string | null;
          safe_capacity: number;
          vehicle_type?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          registration_number?: string;
          name?: string | null;
          safe_capacity?: number;
          vehicle_type?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      schedules: {
        Row: {
          id: string;
          route_id: string;
          day_of_week: number;
          departure_time: string;
          direction: RouteDirection;
          proposed_allocation: number;
          is_active: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          route_id: string;
          day_of_week: number;
          departure_time: string;
          direction?: RouteDirection;
          proposed_allocation: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          route_id?: string;
          day_of_week?: number;
          departure_time?: string;
          direction?: RouteDirection;
          proposed_allocation?: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedules_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "routes";
            referencedColumns: ["id"];
          }
        ];
      };
      journeys: {
        Row: {
          id: string;
          schedule_id: string | null;
          route_id: string;
          vehicle_id: string;
          driver_id: string;
          journey_date: string;
          scheduled_departure: string;
          actual_departure: string | null;
          estimated_arrival: string | null;
          proposed_allocation: number;
          status: JourneyStatus;
          delay_minutes: number;
          delay_reason: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          schedule_id?: string | null;
          route_id: string;
          vehicle_id: string;
          driver_id: string;
          journey_date: string;
          scheduled_departure: string;
          actual_departure?: string | null;
          estimated_arrival?: string | null;
          proposed_allocation: number;
          status?: JourneyStatus;
          delay_minutes?: number;
          delay_reason?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          schedule_id?: string | null;
          route_id?: string;
          vehicle_id?: string;
          driver_id?: string;
          journey_date?: string;
          scheduled_departure?: string;
          actual_departure?: string | null;
          estimated_arrival?: string | null;
          proposed_allocation?: number;
          status?: JourneyStatus;
          delay_minutes?: number;
          delay_reason?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journeys_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journeys_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journeys_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journeys_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journeys_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      bookings: {
        Row: {
          id: string;
          journey_id: string;
          student_id: string;
          boarding_stop_id: string;
          status: BookingStatus;
          ticket_token: string | null;
          boarding_pass_issued_at: string | null;
          booked_at: string;
          cancelled_at: string | null;
          checked_in_at: string | null;
          checked_in_by: string | null;
        };
        Insert: {
          id?: string;
          journey_id: string;
          student_id: string;
          boarding_stop_id: string;
          status?: BookingStatus;
          ticket_token?: string | null;
          boarding_pass_issued_at?: string | null;
          booked_at?: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          checked_in_by?: string | null;
        };
        Update: {
          id?: string;
          journey_id?: string;
          student_id?: string;
          boarding_stop_id?: string;
          status?: BookingStatus;
          ticket_token?: string | null;
          boarding_pass_issued_at?: string | null;
          booked_at?: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          checked_in_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_journey_id_fkey";
            columns: ["journey_id"];
            isOneToOne: false;
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_boarding_stop_id_fkey";
            columns: ["boarding_stop_id"];
            isOneToOne: false;
            referencedRelation: "stops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_checked_in_by_fkey";
            columns: ["checked_in_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      waitlists: {
        Row: {
          id: string;
          journey_id: string;
          student_id: string;
          boarding_stop_id: string;
          position: number;
          status: WaitlistStatus;
          created_at: string;
          promoted_at: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          journey_id: string;
          student_id: string;
          boarding_stop_id: string;
          position: number;
          status?: WaitlistStatus;
          created_at?: string;
          promoted_at?: string | null;
          cancelled_at?: string | null;
        };
        Update: {
          id?: string;
          journey_id?: string;
          student_id?: string;
          boarding_stop_id?: string;
          position?: number;
          status?: WaitlistStatus;
          created_at?: string;
          promoted_at?: string | null;
          cancelled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "waitlists_journey_id_fkey";
            columns: ["journey_id"];
            isOneToOne: false;
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "waitlists_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "waitlists_boarding_stop_id_fkey";
            columns: ["boarding_stop_id"];
            isOneToOne: false;
            referencedRelation: "stops";
            referencedColumns: ["id"];
          }
        ];
      };
      boarding_records: {
        Row: {
          id: string;
          booking_id: string;
          journey_id: string;
          student_id: string;
          vehicle_id: string;
          scanned_by: string;
          scanned_at: string;
          boarding_method: BoardingMethod;
          exception_reason: string | null;
          is_verified: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          journey_id: string;
          student_id: string;
          vehicle_id: string;
          scanned_by: string;
          scanned_at?: string;
          boarding_method?: BoardingMethod;
          exception_reason?: string | null;
          is_verified?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          journey_id?: string;
          student_id?: string;
          vehicle_id?: string;
          scanned_by?: string;
          scanned_at?: string;
          boarding_method?: BoardingMethod;
          exception_reason?: string | null;
          is_verified?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "boarding_records_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "boarding_records_journey_id_fkey";
            columns: ["journey_id"];
            isOneToOne: false;
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "boarding_records_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "boarding_records_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "boarding_records_scanned_by_fkey";
            columns: ["scanned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      announcements: {
        Row: {
          id: string;
          title: string;
          content: string;
          target_role: UserRole | null;
          route_id: string | null;
          transport_group_id: string | null;
          is_active: boolean;
          created_by: string;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          target_role?: UserRole | null;
          route_id?: string | null;
          transport_group_id?: string | null;
          is_active?: boolean;
          created_by: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          target_role?: UserRole | null;
          route_id?: string | null;
          transport_group_id?: string | null;
          is_active?: boolean;
          created_by?: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_transport_group_id_fkey";
            columns: ["transport_group_id"];
            isOneToOne: false;
            referencedRelation: "transport_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          message: string;
          type: NotificationType;
          related_journey_id: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          message: string;
          type?: NotificationType;
          related_journey_id?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          message?: string;
          type?: NotificationType;
          related_journey_id?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_related_journey_id_fkey";
            columns: ["related_journey_id"];
            isOneToOne: false;
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          }
        ];
      };
      incident_reports: {
        Row: {
          id: string;
          journey_id: string | null;
          vehicle_id: string | null;
          reported_by: string;
          category: string;
          severity: IncidentSeverity;
          description: string;
          status: IncidentStatus;
          resolution_notes: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          journey_id?: string | null;
          vehicle_id?: string | null;
          reported_by: string;
          category: string;
          severity?: IncidentSeverity;
          description: string;
          status?: IncidentStatus;
          resolution_notes?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          journey_id?: string | null;
          vehicle_id?: string | null;
          reported_by?: string;
          category?: string;
          severity?: IncidentSeverity;
          description?: string;
          status?: IncidentStatus;
          resolution_notes?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_reports_journey_id_fkey";
            columns: ["journey_id"];
            isOneToOne: false;
            referencedRelation: "journeys";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_reports_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_reports_reported_by_fkey";
            columns: ["reported_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_reports_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      system_settings: {
        Row: {
          key: string;
          value: Json;
          description: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          description?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          description?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          details: Json | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          details?: Json | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      book_journey_seat: {
        Args: {
          p_journey_id: string;
          p_student_id: string;
          p_boarding_stop_id: string;
        };
        Returns: Json;
      };
      cancel_booking_and_promote: {
        Args: {
          p_booking_id: string;
          p_student_id: string;
        };
        Returns: Json;
      };
      verify_and_board_passenger: {
        Args: {
          p_ticket_token: string;
          p_officer_id: string;
          p_journey_id: string;
          p_boarding_method?: BoardingMethod;
          p_exception_reason?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      user_role: UserRole;
      gender: Gender;
      journey_status: JourneyStatus;
      booking_status: BookingStatus;
      route_direction: RouteDirection;
      waitlist_status: WaitlistStatus;
      boarding_method: BoardingMethod;
      notification_type: NotificationType;
      incident_severity: IncidentSeverity;
      incident_status: IncidentStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
