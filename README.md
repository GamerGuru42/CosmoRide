# CosmoRide

**Your University. Your Ride.**

CosmoRide is the official university-owned transportation and electric bus management platform for Cosmopolitan University, Nigeria.

> Powered by NextGen Technologies.

## Technology Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL, Auth, Storage, RLS)
- **PWA**: Service worker + web manifest
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- A Supabase project ([supabase.com](https://supabase.com))

### Setup

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd CosmoRide
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.local.example .env.local
   ```

4. Fill in your Supabase credentials in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY` — Your Supabase service role key (server only)

5. Apply the database schema:
   - Open `supabase/migrations/00001_initial_schema.sql` in the Supabase SQL Editor and run it

6. Run the development server:
   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/               # Next.js App Router pages
│   ├── (auth)/        # Login, register (public)
│   ├── (dashboard)/   # Protected role-based pages
│   │   ├── student/   # Student interface
│   │   ├── boarding/  # Hostel representative
│   │   ├── driver/    # Driver interface
│   │   └── admin/     # Transport administrator
│   └── auth/          # Auth callbacks
├── components/        # Reusable React components
├── lib/               # Utilities, Supabase clients, validators
└── middleware.ts       # Auth protection middleware
```

## User Roles

| Role | Interface | Access |
|------|-----------|--------|
| Student | `/student` | Book rides, view journeys |
| Boarding Officer | `/boarding` | Check-in passengers |
| Driver | `/driver` | Manage journey status |
| Admin | `/admin` | Full system management |

## License

Proprietary — Cosmopolitan University. All rights reserved.
