# CosmoRide — Project Requirements

## Product Identity

| Field | Value |
|---|---|
| **Name** | CosmoRide |
| **Owner** | Cosmopolitan University, Nigeria |
| **Description** | University Bus Booking and Mobility Platform |
| **Tagline** | Your University. Your Ride. |
| **Development** | Powered by NextGen Technologies |

---

## 1. Overview

CosmoRide is the official university-owned transportation and electric bus management platform for Cosmopolitan University. It provides booking, scheduling, fleet management, boarding verification, and transport operations across multiple campuses with role-based access for students, hostel representatives, drivers, and transport administrators.

---

## 2. User Roles & Access Boundaries

### 2.1 Student
- View available routes, schedules, and remaining seat counts.
- Book seats on upcoming journeys (with atomic race-condition protection).
- Automatically join waiting lists when a journey is at full safe capacity.
- Receive secure, private QR boarding passes.
- View booking history, status, and cancellation options within the allowed window.
- Receive journey notifications (departure delays, schedule changes, waitlist promotions).

### 2.2 Hostel Representative / Boarding Officer
- View student bookings and manifests for their assigned transport group/hostel.
- Scan and verify student QR boarding passes atomically.
- Prevent duplicate boarding scans and wrong-bus boarding attempts.
- Log auditable manual boarding exceptions (e.g. phone depleted, verified university ID).
- Report boarding counts, no-shows, and capacity bottlenecks.

### 2.3 Driver
- View assigned journeys and routes.
- Mark journey lifecycle states (`boarding`, `in_transit`, `completed`).
- Report manual delay updates with minutes and reason (no GPS requirement).
- View passenger manifest for their assigned vehicle and trip.
- File incident and safety reports.

### 2.4 Transport Administrator / University Administrator
- Full CRUD management over routes, pickup stops, vehicles, schedules, and journeys.
- Manage user roles (promoting students to drivers, officers, or admins).
- Assign drivers and vehicles to journeys with physical capacity enforcement.
- Configure operational variables (`system_settings`) including booking windows and cutoffs.
- View dashboards and reports populated with real data only.

---

## 3. Campus & Route Operations

### 3.1 Campuses
- **Main Campus** — primary academic campus.
- **Kado Campus** — secondary academic campus.

### 3.2 Hostels & Transport Groups
- **Girls' Hostel** (Main Campus) — served by Girls' Transport Group.
- **Main Boys' Hostel** (Main Campus) — served by Boys' Transport Group.
- **Wuye Boys' Hostel** (off-campus) — served by Boys' Transport Group.
- **Inter-Campus Transfer** — serving students moving between Main and Kado Campuses.

### 3.3 Current Operations & Baseline Assumptions
1. **Girls' Operation**:
   - 3 buses and 3 drivers operating simultaneously on the route.
   - Proposed allocation: 30 students per bus per journey.
   - Morning journeys: ~4 on Mondays, ~5 on regular weekdays.
   - Evening journeys: ~5 normally, sometimes 6.
2. **Boys' Operation**:
   - Morning route: Main Boys' Hostel pickup → Wuye Boys' Hostel pickup → Main Campus.
   - Proposed allocation: 30 students per bus per journey.
3. **Inter-Campus Shuttle**:
   - Scheduled shuttle runs between Main Campus and Kado Campus.

---

## 4. Unresolved Operational Assumptions (Non-Hardcoded)

To ensure operational viability, the platform strictly avoids hardcoding the following pending parameters:

| Parameter | Unresolved State | Platform Implementation |
|---|---|---|
| **Girls' Journey Count Meaning** | Unconfirmed whether Monday's 4 journeys and weekday 5 journeys refer to **total fleet trips** or **individual bus trips**. | **Configurable**: Journeys are instantiated individually from schedules. Admin can schedule either model freely. |
| **Boys' Fleet Size** | Total number of buses and drivers assigned to Boys' operations is unconfirmed. | **Configurable**: Fleet size and driver pool are fully dynamic in `vehicles` and `profiles`. |
| **Kado Inter-Campus Frequency** | Specific trip frequencies and times between Main and Kado campuses are unconfirmed. | **Configurable**: Routes and schedules support arbitrary inter-campus timetables. |
| **Allocation vs. Safe Capacity** | Proposed allocation is 30 students, but vehicles may vary in physical safe passenger limits. | **Strict Rule**: Bookable capacity is $\min(\text{proposed\_allocation}, \text{safe\_capacity})$. Safety threshold can never be overridden. |

---

## 5. Booking, Capacity & Boarding Integrity

### 5.1 Atomic Seat Reservation
- Atomic stored procedure `book_journey_seat` serializes bookings using PostgreSQL row-level locks (`SELECT ... FOR UPDATE`).
- Eliminates race conditions for final available seats.
- One active booking per student per journey (`UNIQUE(journey_id, student_id)`).

### 5.2 Waiting List & Automatic Promotion
- When a journey reaches capacity, students are safely queued in `waitlists` with explicit position ordering.
- When an existing booking is cancelled via `cancel_booking_and_promote`, the top-ranked waitlisted student is automatically issued a confirmed ticket, re-indexing remaining waitlist positions and sending a notification.

### 5.3 QR Boarding Security & Privacy
- **Opaque Token**: Tickets use a 48-character cryptographically random token (`ticket_token`).
- **Zero Sensitive Data**: Student names, contact details, and student IDs are not encoded in the QR barcode.
- **Validation**:
  - Rejects cancelled tickets.
  - Rejects duplicate scans (already checked in).
  - Rejects wrong journey / wrong vehicle scans.
  - Rejects scans exceeding authorized capacity.
- **Manual Overrides**: Allowed with mandatory audit justification recorded in `boarding_records` and `audit_logs`.

---

## 6. Authentication & Privilege Escalation Defenses

- **Roles**: `student`, `boarding_officer`, `driver`, `admin`.
- **Privilege Escalation Defense**: PostgreSQL trigger `protect_profile_privileges` intercepts all updates to `profiles.role`, `is_active`, and transport group assignments, raising an exception if attempted by non-admin sessions.
- **Service Role Key**: Confined to server-side executions (`createAdminClient`); never exposed in `NEXT_PUBLIC_` variables or client bundles.
- **Row-Level Security**: Comprehensive RLS policies on all 18 tables using `(SELECT auth.uid())` subqueries for performance and security invoker isolation.

---

## 7. Environment Variables Required

| Variable | Scope | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client & Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client & Server | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Only | Supabase service-role key (bypasses RLS) |

---

## 8. Implementation Status & Phase Deliverables

| Phase | Title | Status | Scope & Deliverables |
|---|---|---|---|
| **Phase 1** | Project Foundation & Architecture | ✅ Completed (`30e1d7f`) | Base Next.js 16 App Router, TypeScript, Tailwind CSS, Supabase SSR client, PWA configuration, requirements document. |
| **Phase 2** | Database, Auth & Security Validation | ✅ Completed (`089d4f4`) | 18 normalized tables, RLS policies, atomic race-condition-free stored procedures with row-level locks, capacity tests. |
| **Phase 3** | Student Experience & Premium UI | ✅ Completed (`0304ca8`) | Aviation-inspired FIDS departure board, digital boarding pass with SVG QR, waitlist display, booking cancellation, trip history. |
| **Phase 4** | Hostel Rep & Boarding Officer Experience | ✅ Completed (`255ec20`) | Transport group corridor isolation, camera QR scanner via `jsQR`, boarding verification with status codes, auditable manual overrides, manifest print view. |
| **Phase 5** | Driver Management & Trip Execution | ✅ Completed (`2b4cabe`) | Decoupled drivers roster accommodating non-smartphone drivers, Mode A direct smartphone access, Mode B assisted operations, pre-departure safety gate, delay management. |
| **Phase 6** | Transport Administration Control Centre | ✅ Completed (`0456b1c`) | Operational Control Centre, fleet management with certified safe capacities, route and stop itineraries, weekly timetable templates, bulk journey generation, cancellation governance, live milestone monitor, incident desk, announcements, user directory, performance analytics, and CSV exports. |
| **Phase 6.1** | Integration, Timezone & Security Hardening Audit | ✅ Completed (`131d9e2`) | Comprehensive system audit, resolved PostgreSQL enum violation in migration 00001, added audit_logs INSERT RLS policy, hardened all SECURITY DEFINER RPCs against caller spoofing, revoked unauthenticated anon execution, synchronized WAT (Africa/Lagos) operational dates and time formatting, zero mock records, 45/45 passing unit & integration tests, clean production build across 33 routes. |
| **Phase 6.2** | Final Database Security Review | ✅ Completed (`2215518`) | In-depth PostgreSQL security review, eliminated permissive OR RLS bypass on journeys/boarding/waitlists, enforced zero admin impersonation exceptions in all 13 RPCs, revoked broad function grants, established audit_logs immutability triggers, verified against real in-memory PostgreSQL engine (pg-mem), 62/62 passing unit & security tests. |
| **Phase 6.3** | Security Edge-Case & Fail-Closed Corridor Review | ✅ Completed (`0492088`) | Fail-closed boarding officer corridor isolation (rejects NULL/invalid transport group), strict JWT claim role handling rejecting anon/missing/unknown roles in all 13 RPCs, removed all blanket grants to service_role, explicit function-by-function execution grants, immutable audit log protection, 80/80 passing unit & security tests. |
| **Phase 6.4** | Service-Role Trust Boundary & Final Security Audit | ✅ Completed (`16b23b7`) | Hardened service-role boundaries by revoking `service_role` execution from all 12 user-initiated RPCs and retaining it strictly for automated background timetable dispatch (`admin_generate_journeys_from_schedules`), validated that 100% of server actions derive actor identities from server sessions with zero browser UUID parameters, corrected parameter type alignment on `record_journey_stop_update`, implemented comprehensive database-level student booking eligibility checks in `book_journey_seat` (verifying active student role, route status, boarding stop route membership, gender corridor separation, and transport group isolation), replaced table-wide unique constraint with stateful partial index on active bookings (`WHERE status IN ('confirmed', 'checked_in')`) to ensure rebooking resilience, 104/104 passing tests across 30 test suites, zero TypeScript errors, clean production build across 33 routes. |
| **Phase 6.5** | System Actor Attribution, Booking Policy & Verification | ✅ Completed (`4fe092c`) | Implemented honest system actor attribution model distinguishing human administrator actions (`ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE`, `created_by = admin_id`) from automated scheduled cron jobs (`SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE`, `user_id = NULL`, `created_by = NULL`, `actor_type = 'scheduled_system_job'`), eliminated human admin impersonation by background workers, anchored journey departures explicitly to Africa/Lagos (WAT / UTC+1), upgraded `book_journey_seat` to dynamically fetch configurable `booking_cutoff_minutes` from `public.system_settings` (default 15 mins), hardened safe seat occupancy calculation to count both `confirmed` and `checked_in` passengers preventing capacity overselling during boarding, inspected PostgreSQL environment and documented unverified remote infrastructure checks, 129/129 passing tests across 37 test suites, 0 TypeScript errors, clean Turbopack build across 33 routes. |
| **Phase 6.6** | Operational Configuration & Data-Integrity Audit | ✅ Completed (`07f5c57`) | Audited nullable system-generated journeys (`created_by = NULL`) across RLS policies, queries, actions, cancellation/closure workflows, and updated TypeScript database types; conducted honest entry point audit establishing zero unauthenticated cron routes and anti-spoofing audit contracts; implemented migration `00010` adding strict input validation on `booking_cutoff_minutes` (0–120 minutes) and `booking_window_hours_ahead` (1–168 hours) in `admin_update_system_setting` with defensive fallback and clamping in `book_journey_seat`; audited and registered the four confirmed Boys' journey patterns (07:30 via Wuye, 08:30 express direct, 16:00 express direct, 16:50/17:00 single journey with departure window) and Girls' fleet 3-bus configuration (CU-EB-01 to 03, 30 safe seats, 3 drivers); 150/150 passing tests across 44 test suites, zero TypeScript errors, clean Turbopack build across 33 routes. |
| **Phase 6.7** | Recurring Schedule Provisioning & Operational Data Integrity | ✅ Completed | Provisioned Monday–Friday (days 1 to 5) schedule templates for the four confirmed Boys' recurring patterns in `seed.sql` and migration `00011_recurring_schedules_and_departure_window.sql`; extended `schedules` with `latest_departure_time TIME` and `journeys` with `latest_permitted_departure TIMESTAMPTZ` with validation constraints; modeled Pattern 4 (16:50 planned / 17:00 latest) as a single continuous trip with an operational departure window; implemented overdue telemetry rules (surfacing late warnings past latest permitted departure without auto-cancelling or marking no-shows); hardened seat booking RPC with capacity fail-safe (`CAPACITY_NOT_CONFIGURED`) rejecting bookings if vehicle safe capacity is unverified; removed hardcoded `|| 30` fallbacks across admin, boarding, and driver views; clarified staging fixture nature of vehicles and drivers; 164/164 passing tests across 50 test suites, zero TypeScript errors, clean Turbopack build across 33 routes. |


