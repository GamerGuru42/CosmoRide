# CosmoRide — Project Requirements

## Product Identity

| Field | Value |
|-------|-------|
| **Name** | CosmoRide |
| **Owner** | Cosmopolitan University, Nigeria |
| **Description** | University Bus Booking and Mobility Platform |
| **Tagline** | Your University. Your Ride. |
| **Development** | Powered by NextGen Technologies |

---

## 1. Overview

CosmoRide is the official university-owned transportation and electric bus management platform for Cosmopolitan University. It provides booking, scheduling, fleet management, and transport operations across multiple campuses with role-based access for students, hostel representatives, drivers, and transport administrators.

---

## 2. User Roles

### 2.1 Student
- View available routes and schedules
- Book seats on upcoming journeys
- View booking history and status
- Receive journey notifications (departure, delays)
- Cancel bookings within allowed window

### 2.2 Hostel Representative / Boarding Officer
- View student bookings for their hostel
- Manage student boarding (check-in passengers)
- Report boarding counts and no-shows
- Communicate with transport admin about capacity needs

### 2.3 Driver
- View assigned journeys and routes
- Mark journey status (started, arrived at stop, departed, completed)
- Report delays with manual time updates
- View passenger manifest for current journey

### 2.4 Transport Administrator / University Administrator
- Full CRUD on routes, stops, schedules, and fleet
- Assign drivers and vehicles to journeys
- Configure bus capacities (respecting safe limits)
- View dashboards with real data only
- Manage user roles and permissions
- Generate reports (bookings, utilisation, delays)

---

## 3. Campus & Route Information

### 3.1 Campuses
- **Main Campus** — primary academic campus
- **Kado Campus** — secondary campus

### 3.2 Hostels
- Girls' Hostel (Main Campus)
- Main Boys' Hostel (Main Campus)
- Wuye Boys' Hostel (off-campus)

### 3.3 Current Operations

#### Girls' Operation
- 3 buses, 3 drivers operating simultaneously on the same route
- Proposed allocation: 30 students per bus per journey
- Morning journeys: ~4 on Mondays, ~5 on regular weekdays
- Evening journeys: ~5 normally, sometimes 6
- **Note**: Whether journey counts are per-bus or fleet-total is unconfirmed — system must not hardcode this assumption

#### Boys' Operation
- Main Boys' Hostel pickup → Wuye Boys' Hostel pickup → Main Campus
- Proposed allocation: 30 students per bus per journey
- Number of buses and drivers: **to be confirmed**

#### Inter-Campus
- Some students require Main Campus ↔ Kado Campus transportation

### 3.4 Configurability Requirements
All of the following must be configurable (not hardcoded):
- Routes and stops
- Departure times
- Fleet assignments (which buses on which routes)
- Schedule patterns (per day-of-week)
- Bus capacity (proposed allocation ≤ safe vehicle capacity)
- Number of journeys per route/day
- Driver assignments

---

## 4. Journey & Booking Rules

### 4.1 Journey Model
- A journey is a single trip by a vehicle on a route at a scheduled time
- The same vehicle and driver can make repeated journeys
- Journeys have states: `scheduled` → `boarding` → `in_transit` → `completed` / `cancelled`

### 4.2 Capacity Rules
- Each journey has a `proposed_allocation` (e.g., 30)
- Each vehicle has a `safe_capacity` (actual approved limit)
- Bookable seats = min(proposed_allocation, safe_capacity)
- Overbooking is not permitted

### 4.3 Timing Display
- Scheduled departure time
- Expected pickup time per stop
- Manual delay updates from drivers (no live GPS)

### 4.4 Booking Rules
- Students book specific journeys
- One booking per student per journey
- Booking confirmed only if capacity available
- Cancellation allowed within configurable window
- No waitlist in initial release

---

## 5. Non-Functional Requirements

### 5.1 Technology Stack
- **Framework**: Next.js 16+ with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL, Auth, Storage, RLS)
- **PWA**: Service worker, manifest, offline-capable shell
- **Deployment**: Vercel-compatible

### 5.2 Data Integrity
- No fake/seed data in production views
- Empty databases show honest empty states
- All controls must be functional — no decorative UI
- Server-side validation for all mutations

### 5.3 Security
- Supabase service-role key: server-side only, never exposed to browser
- Row Level Security (RLS) on all public tables
- Role-based access control enforced at database level
- Input validation with Zod schemas
- CSRF protection via Next.js defaults

### 5.4 Accessibility & Responsiveness
- WCAG 2.1 AA compliance target
- Mobile-first responsive design
- Works on low-bandwidth connections (common in Nigeria)

---

## 6. Environment Variables Required

| Variable | Purpose | Side |
|----------|---------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Server only |

---

## 7. Out of Scope (Initial Release)

- Live GPS tracking
- Payment processing
- Push notifications (email/SMS only later)
- Student ID card integration
- Automated schedule generation
- Multi-language support
- Real-time bus location map

