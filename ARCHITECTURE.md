# CosmoRide — Architecture Document

## Technology Stack

```
┌─────────────────────────────────────────────┐
│                  Vercel CDN                  │
├─────────────────────────────────────────────┤
│          Next.js 16 (App Router)            │
│    ┌──────────────┬──────────────────┐      │
│    │  React RSC   │  Server Actions  │      │
│    │  (Pages)     │  (Mutations)     │      │
│    └──────┬───────┴────────┬─────────┘      │
│           │                │                │
│    ┌──────▼───────┐ ┌──────▼─────────┐      │
│    │ Supabase SSR │ │ Supabase Admin │      │
│    │ (anon key)   │ │ (service role) │      │
│    └──────┬───────┘ └──────┬─────────┘      │
├───────────┼────────────────┼────────────────┤
│           └────────┬───────┘                │
│              Supabase Platform              │
│    ┌───────────────────────────────────┐    │
│    │  PostgreSQL  │  Auth  │  Storage  │    │
│    │              │        │           │    │
│    │  RLS Policies│  JWT   │  Avatars  │    │
│    └───────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## Project Structure

```
cosmoride/
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker (shell caching)
│   └── icons/                 # App icons
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── (auth)/            # Auth route group (login, register)
│   │   │   ├── login/
│   │   │   └── register/
│   │   │
│   │   ├── (dashboard)/       # Protected route group
│   │   │   ├── student/       # Student interface
│   │   │   ├── boarding/      # Hostel rep interface
│   │   │   ├── driver/        # Driver interface
│   │   │   └── admin/         # Transport admin interface
│   │   │
│   │   ├── api/               # API routes (if needed)
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Landing page
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                # Reusable UI primitives
│   │   ├── forms/             # Form components
│   │   ├── layout/            # Layout components (nav, sidebar)
│   │   └── shared/            # Cross-role shared components
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts      # Browser Supabase client
│   │   │   ├── server.ts      # Server Supabase client (cookies)
│   │   │   ├── admin.ts       # Service-role client (server only)
│   │   │   ├── middleware.ts   # Auth middleware helper
│   │   │   └── types.ts       # Generated database types
│   │   │
│   │   ├── validators/        # Zod schemas
│   │   ├── constants.ts       # App constants
│   │   └── utils.ts           # Utility functions
│   │
│   ├── hooks/                 # Custom React hooks
│   ├── types/                 # TypeScript type definitions
│   └── middleware.ts          # Next.js middleware (auth guard)
│
├── supabase/
│   ├── migrations/            # SQL migration files
│   ├── seed.sql               # Development seed data (dev only)
│   └── config.toml            # Supabase local config
│
├── .env.local.example         # Environment variable template
├── next.config.ts
├── tailwind.config.ts         # (if custom config needed beyond CSS)
├── tsconfig.json
├── package.json
├── PROJECT_REQUIREMENTS.md
├── ARCHITECTURE.md
└── README.md
```

---

## Database Schema

### Core Tables

#### `profiles`
Extended user profile linked to Supabase Auth.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, FK → auth.users) | |
| full_name | text | |
| role | enum | student, boarding_officer, driver, admin |
| hostel_id | uuid (FK) | nullable, for students/boarding officers |
| student_id | text | university student ID, nullable |
| phone | text | |
| avatar_url | text | |
| is_active | boolean | default true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `campuses`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | e.g., "Main Campus", "Kado Campus" |
| code | text (unique) | e.g., "MAIN", "KADO" |
| address | text | |
| is_active | boolean | |

#### `hostels`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | e.g., "Girls' Hostel", "Main Boys' Hostel" |
| campus_id | uuid (FK) | |
| gender | enum | male, female, mixed |
| is_active | boolean | |

#### `routes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | e.g., "Girls Morning Route" |
| code | text (unique) | |
| description | text | |
| gender_group | enum | male, female, all |
| is_active | boolean | |

#### `stops`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | e.g., "Girls' Hostel", "Wuye Hostel" |
| campus_id | uuid (FK) | nullable |
| address | text | |
| latitude | numeric | nullable (future use) |
| longitude | numeric | nullable (future use) |

#### `route_stops`
Ordered stops within a route.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| route_id | uuid (FK) | |
| stop_id | uuid (FK) | |
| stop_order | integer | |
| estimated_minutes_from_start | integer | |
| unique(route_id, stop_order) | | |

#### `vehicles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| registration_number | text (unique) | |
| name | text | nickname/label |
| safe_capacity | integer | actual approved safe limit |
| vehicle_type | text | e.g., "electric_bus" |
| is_active | boolean | |

#### `schedules`
Template for recurring journey patterns.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| route_id | uuid (FK) | |
| day_of_week | integer | 0=Sun, 1=Mon, ... 6=Sat |
| departure_time | time | |
| direction | enum | outbound, inbound |
| proposed_allocation | integer | ≤ vehicle safe_capacity |
| is_active | boolean | |
| notes | text | |

#### `journeys`
Concrete instances of a scheduled trip.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| schedule_id | uuid (FK) | nullable (ad-hoc journeys) |
| route_id | uuid (FK) | |
| vehicle_id | uuid (FK) | |
| driver_id | uuid (FK → profiles) | |
| journey_date | date | |
| scheduled_departure | timestamptz | |
| actual_departure | timestamptz | nullable |
| estimated_arrival | timestamptz | nullable |
| proposed_allocation | integer | |
| status | enum | scheduled, boarding, in_transit, completed, cancelled |
| delay_minutes | integer | default 0, manual update |
| delay_reason | text | |
| created_by | uuid (FK → profiles) | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `bookings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| journey_id | uuid (FK) | |
| student_id | uuid (FK → profiles) | |
| boarding_stop_id | uuid (FK → stops) | |
| status | enum | confirmed, checked_in, no_show, cancelled |
| booked_at | timestamptz | |
| cancelled_at | timestamptz | nullable |
| checked_in_at | timestamptz | nullable |
| checked_in_by | uuid (FK → profiles) | boarding officer |

---

## Authentication Flow

```
Browser                    Next.js Server              Supabase Auth
  │                              │                          │
  │  POST /login                 │                          │
  │─────────────────────────────>│                          │
  │                              │  signInWithPassword()    │
  │                              │─────────────────────────>│
  │                              │     JWT + refresh token  │
  │                              │<─────────────────────────│
  │                              │                          │
  │  Set-Cookie (httpOnly)       │                          │
  │<─────────────────────────────│                          │
  │                              │                          │
  │  GET /dashboard/student      │                          │
  │─────────────────────────────>│                          │
  │                              │  Verify JWT from cookie  │
  │                              │  Check profile.role      │
  │                              │  → Render or redirect    │
  │  HTML (role-specific page)   │                          │
  │<─────────────────────────────│                          │
```

## Middleware Strategy

Next.js middleware intercepts all requests to `/(dashboard)/*`:
1. Read Supabase session from cookies
2. If no session → redirect to `/login`
3. If session exists → extract user role from profile
4. If role doesn't match route prefix → redirect to correct dashboard
5. Pass through to page

---

## Row Level Security Strategy

Every table in the `public` schema has RLS enabled. Policies follow this pattern:

| Role | Can Read | Can Write |
|------|----------|-----------|
| Student | Own profile, own bookings, active routes/schedules/journeys | Own bookings (insert/cancel) |
| Boarding Officer | Own hostel students, journey passengers | Check-in bookings |
| Driver | Own profile, assigned journeys, journey passengers | Update journey status/delays |
| Admin | Everything | Everything |

All policies use `(select auth.uid())` wrapped in a subquery for performance per Supabase best practices.

---

## PWA Configuration

- `manifest.json` with app name, theme color, icons
- Service worker for app shell caching (offline landing page)
- `<meta>` tags for iOS/Android install prompts
- No background sync in v1

---

## Deployment

- **Platform**: Vercel
- **Environment variables**: Set via Vercel dashboard (never committed)
- **Build**: `next build` (static + server components)
- **Database**: Supabase hosted PostgreSQL
- **Domain**: To be configured by university IT

