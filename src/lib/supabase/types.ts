/**
 * Database type definitions for CosmoRide.
 *
 * Generated/defined for Supabase JS v2 client compatibility.
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

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          hostel_id: string | null;
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
          gender: Gender;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          campus_id: string;
          gender: Gender;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          campus_id?: string;
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
          }
        ];
      };
      routes: {
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      user_role: UserRole;
      gender: Gender;
      journey_status: JourneyStatus;
      booking_status: BookingStatus;
      route_direction: RouteDirection;
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
