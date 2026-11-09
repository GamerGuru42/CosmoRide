# CosmoRide — Architecture Document

## 1. System Overview & Technology Stack

CosmoRide is the official university-owned transportation and electric bus management platform for Cosmopolitan University, Nigeria. It is built as a production-grade, multi-role progressive web application with zero client-side privilege exposure.

```
┌───────────────────────────────────────────────────────────┐
│                        Vercel CDN                         │
├───────────────────────────────────────────────────────────┤
│                 Next.js 16 (App Router)                   │
│   ┌─────────────────────────────┬─────────────────────┐   │
│   │     React Server Components │    Server Actions   │   │
│   │     (Role Dashboards)       │    (RPC & Mutations)│   │
│   └──────────────┬──────────────┴──────────┬──────────┘   │
│                  │                         │              │
│   ┌──────────────▼──────────────┐ ┌────────▼──────────┐   │
│   │  Supabase SSR (Anon/Cookie) │ │ Supabase Admin    │   │
│   │  RLS-Enforced Session       │ │ (Service Role Key)│   │
│   └──────────────┬──────────────┘ └────────┬──────────┘   │
├──────────────────┼─────────────────────────┼──────────────┤
│                  └─────────────┬───────────┘              │
│                   Supabase Hosted Platform                │
│   ┌───────────────────────────────────────────────────┐   │
│   │ PostgreSQL Database                               │   │
│   │  • 18 Normalized Tables                           │   │
│   │  • Row-Level Security (RLS) on all exposed tables │   │
│   │  • Atomic Stored Procedures with Row Locks        │   │
│   │  • Privilege Escalation Prevention Trigger        │   │
│   │  • Audit Logging & Manual Exception Trail         │   │
│   ├───────────────────────────────────────────────────┤   │
│   │ Auth (JWT + Secure HTTP-only Cookie Sessions)     │   │
│   │ Storage (Avatars, Documents — Access Controlled)  │   │
│   └───────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
CosmoRide/
├── public/
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                      # Service worker (app shell caching)
│   └── icons/                     # Application icons
│
├── src/
│   ├── app/
│   │   ├── (auth)/                # Public authentication routes
│   │   │   ├── layout.tsx         # Centered card layout
│   │   │   ├── login/             # Email/password authentication
│   │   │   └── register/          # Student account creation
│   │   ├── (dashboard)/           # Protected role-based workspaces
│   │   │   ├── layout.tsx         # User profile session loader & guard
│   │   │   ├── student/           # Student interface (rides & booking)
│   │   │   ├── boarding/          # Hostel representative & boarding officer
│   │   │   ├── driver/            # Driver interface (journey updates & manifest)
│   │   │   └── admin/             # Transport administrator interface
│   │   ├── auth/callback/route.ts # Supabase OAuth & email confirmation
│   │   ├── layout.tsx             # Root layout with university branding
│   │   ├── page.tsx               # Public landing page
│   │   └── globals.css            # University color tokens & styles
│   │
│   ├── actions/                   # Server Actions (Mutations & Atomic Procedures)
│   │   ├── bookings.ts            # bookSeat, cancelBooking, verifyAndBoardPass
│   │   └── journeys.ts            # createJourney, updateJourneyStatus, reportJourneyDelay
│   │
│   ├── components/
│   │   ├── layout/dashboard-shell.tsx # Role-aware navigation & header
│   │   └── ui/                    # Reusable components (EmptyState, StatusBadge, PageHeader)
│   │
│   ├── lib/
│   │   ├── constants.ts           # University identity, role labels & UI mappings
│   │   ├── utils.ts               # Date/time formatters, safe seat calculator
│   │   ├── validators/index.ts    # Zod schemas for forms & mutations
│   │   └── supabase/
│   │       ├── client.ts          # Browser client (Anon key)
│   │       ├── server.ts          # Server client (HTTP-only cookies)
│   │       ├── admin.ts           # Service-role admin client (Server only)
│   │       ├── middleware.ts      # Edge session refresher
│   │       └── types.ts           # Database types & RPC signatures
│   │
│   └── middleware.ts              # Route protection middleware
│
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql         # Base entities & initial RLS policies
│       ├── 00002_security_and_operations.sql # Atomic procedures, waitlists, boarding records, settings
│       ├── 00003_boarding_officer_isolation.sql # Transport group corridor isolation & boarding procedures
│       ├── 00004_driver_operations_and_assisted_modes.sql # Mode A/B driver operations & vehicle safety
│       ├── 00005_transport_administration.sql # Schedule generators, journey cancellations & incident desk
│       ├── 00006_security_hardening_and_integrity.sql # Audit log immutability triggers & anti-spoofing
│       ├── 00007_fail_closed_security_and_strict_jwt.sql # Fail-closed policies, strict JWT role checks & explicit grants
│       ├── 00008_service_role_boundaries_and_booking_eligibility.sql # Service-role least privilege & booking eligibility hardening
│       └── 00009_honest_system_actor_and_booking_policy.sql # Honest system actor attribution, dynamic booking cutoff & safe seat counting
│
├── tests/
│   └── security_and_integrity.test.ts # Security, capacity & token validation test suite
│
├── .env.local.example
├── next.config.ts
├── tsconfig.json
├── package.json
├── PROJECT_REQUIREMENTS.md
├── ARCHITECTURE.md
└── README.md
```

---

## 3. Database Schema Specification

### 3.1 Entities

| Table | Purpose | Primary Constraints & Protections |
|---|---|---|
| `profiles` | Extended user account linked to `auth.users` | Trigger prevents self-escalation of `role` or `is_active` |
| `campuses` | University campuses (Main Campus, Kado Campus) | Unique `code`, managed by administrators |
| `transport_groups` | Operational units (Girls' Fleet, Main Boys', Wuye Boys', Inter-Campus) | Unique `code`, configurable groups |
| `hostels` | Student residential hostels linked to campuses & transport groups | Foreign keys to `campuses` & `transport_groups` |
| `routes` | Transport corridors | Unique `code`, linked to transport groups & gender classification |
| `stops` | Specific pickup and drop-off points | Geocoding ready (lat/long), optional campus linkage |
| `route_stops` | Ordered sequence of stops on a route | `UNIQUE(route_id, stop_order)` |
| `vehicles` | Fleet inventory (electric buses & shuttles) | Unique `registration_number`, mandatory `safe_capacity > 0` |
| `schedules` | Recurring timetable templates per day of week | `day_of_week BETWEEN 0 AND 6`, `direction` ('outbound'/'inbound') |
| `journeys` | Concrete trip instances for a specific date and time | Linked to vehicle, route & driver; manual delay tracking |
| `bookings` | Student trip reservations | `UNIQUE(journey_id, student_id)`, unique opaque `ticket_token` |
| `waitlists` | Queue for full journeys | Ordered `position > 0`, `UNIQUE(journey_id, student_id)` |
| `boarding_records` | Immutable log of verified boardings | `booking_id UNIQUE`, captures scanner identity & manual exception reason |
| `announcements` | Role- and route-targeted broadcasts | Role, route or transport group scoping |
| `notifications` | Direct alerts to students/staff | Read status tracking, linked to journeys |
| `incident_reports` | Driver/officer incident logging | Severity levels, categories, resolution tracking |
| `system_settings` | Operational configurations | Key-value store (booking windows, default allocations) |
| `audit_logs` | Security and operational audit trail | Immutable ledger of administrative actions and overrides |

---

## 4. Security Architecture

### 4.1 Privilege Escalation Prevention
- **Trigger `protect_profile_privileges`**: Attached to `public.profiles`.
- Any `UPDATE` attempting to change `role`, `is_active`, or `assigned_transport_group_id` will be immediately aborted with an exception unless the calling session possesses `role = 'admin'` or is the Supabase internal service role.
- Public registration (`signUp`) sets `role = 'student'` unconditionally via a `SECURITY DEFINER` function with clean `search_path`.

### 4.2 Booking & Safe Capacity Integrity
- **Capacity Formula**:
  $$\text{Effective Capacity} = \min(\text{journey.proposed\_allocation}, \text{vehicle.safe\_capacity})$$
- The proposed allocation of 30 passengers never overrides the approved vehicle safe limit.
- **Race Condition Prevention**: The stored procedure `book_journey_seat` issues a `SELECT ... FOR UPDATE OF j` row-level lock on the `journeys` table. Concurrent booking attempts are serialized; the final seat can never be double-booked.
- When full, attempts are safely placed on the `waitlists` table with an incremented queue `position`.
- When a booking is cancelled via `cancel_booking_and_promote`, the top-ranked waitlisted student is automatically issued a confirmed booking and notified.

### 4.3 QR Boarding Security & Privacy
- **Opaque Tokens**: Each booking is assigned a 48-character cryptographically secure token (`ticket_token`).
- **Zero Sensitive Data in QR**: QR payloads contain only `{ token: ticket_token, booking_id: id }`. Student names, IDs, phones, and emails are never encoded into the visual barcode.
- **Duplicate Scan Prevention**: `verify_and_board_passenger` checks `bookings.status`. If already `checked_in`, the scan is rejected.
- **Cross-Journey Validation**: The procedure verifies `booking.journey_id = p_journey_id`. Boarding passes presented on the wrong bus or wrong time are rejected.
- **Auditable Manual Overrides**: If a student is without their device, boarding officers can perform a manual override with an auditable reason recorded in `boarding_records` and `audit_logs`.

### 4.4 Service-Role Key Isolation
- `createAdminClient()` strictly uses `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- The key is never exposed via `NEXT_PUBLIC_` and is inaccessible to client bundles.

---

## 5. Operational Configurability

The platform enforces that no fleet counts or journey counts are hardcoded:
- **Fleet Size**: Configured dynamically in `vehicles`.
- **Driver Assignments**: Assigned per concrete journey instance.
- **Timetables & Departures**: Defined via `schedules` and instantiated into `journeys`.
- **Operational Variables**: Stored in `system_settings`:
  - `default_proposed_allocation`: 30
  - `booking_window_hours_ahead`: 48 (advisory display window for student departures)
  - `booking_cutoff_minutes`: 15 (validated integer within 0–120 minutes)
  - `cancellation_cutoff_minutes`: 30
  - `allow_manual_boarding_override`: true
  - `girls_operation_simultaneous_buses`: 3

---

## 6. Institutional Journey Patterns & Fleet Configuration

### 6.1 Boys' Corridor Patterns (Monday–Friday)
1. **Pattern 1 (Morning 07:30 via Wuye)**: `BOYS_AM_ROUTE` — Main Boys' Hostel (Kado) → Wuye Boys' Hostel → Main Campus Central Bus Park.
2. **Pattern 2 (Morning 08:30 Direct)**: `BOYS_AM_DIRECT` — Main Boys' Hostel (Kado) → Main Campus Central Bus Park directly (express run, bypasses Wuye).
3. **Pattern 3 (Evening 16:00 Direct)**: `BOYS_PM_DIRECT` — Main Campus Central Bus Park → Main Boys' Hostel (Kado) directly (express run, bypasses Wuye).
4. **Pattern 4 (Evening 16:50 planned / 17:00 latest)**: `BOYS_PM_ROUTE` — Main Campus Central Bus Park → Wuye Boys' Hostel → Main Boys' Hostel (Kado). Single journey with operational departure window, not two separate trips.

### 6.2 Girls' Fleet Configuration
- 3 simultaneous operating electric buses (`CU-EB-01`, `CU-EB-02`, `CU-EB-03`) with certified 30-seat safe capacity each (configurable within safe limits: 1–100 seats).
- 3 dedicated drivers (`DRV-CU-01`, `DRV-CU-02`, `DRV-CU-03`) assigned to respective fleet buses, supporting both smartphone-enabled (Mode A) and assisted (Mode B) operations.
- Independent morning and evening departure dispatching configured through weekly timetable templates.

### 6.3 System Attribution & Scheduled-Job Boundaries
- Scheduled timetable generation via `admin_generate_journeys_from_schedules` honestly records `created_by = NULL` and `user_id = NULL` with `actor_type = 'scheduled_system_job'`.
- Interactive administrator generation strictly derives actor identity from `auth.uid()`, preventing browser-supplied impersonation.
- Anti-spoofing controls ensure that authenticated sessions cannot forge automated system job audit records.
