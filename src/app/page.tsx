import Link from "next/link";
import {
  APP_NAME,
  APP_TAGLINE,
  UNIVERSITY_NAME,
  DEVELOPER_ATTRIBUTION,
} from "@/lib/constants";

/**
 * CosmoRide Landing Page
 * Public page — no authentication required.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white font-bold text-lg">
              C
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--color-primary)]">
                {APP_NAME}
              </h1>
              <p className="text-xs text-gray-500">{UNIVERSITY_NAME}</p>
            </div>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-primary)] hover:bg-gray-100 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-light)] transition-colors"
            >
              Register
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 inline-flex items-center rounded-full bg-[var(--color-secondary)]/10 px-4 py-1.5 text-sm font-medium text-[var(--color-secondary-dark)]">
            {UNIVERSITY_NAME} Official Transport Platform
          </div>
          <h2 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            {APP_TAGLINE}
          </h2>
          <p className="mb-8 text-lg text-gray-600">
            Book your campus bus rides, track schedules, and manage university
            transportation — all in one platform.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="w-full rounded-lg bg-[var(--color-primary)] px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-[var(--color-primary-light)] transition-colors sm:w-auto"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="w-full rounded-lg border border-gray-300 bg-white px-8 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors sm:w-auto"
            >
              Sign In
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mx-auto mt-20 grid max-w-4xl gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <h3 className="mb-2 font-semibold text-gray-900">
              View Schedules
            </h3>
            <p className="text-sm text-gray-600">
              See real departure times for all campus bus routes across Main Campus and Kado Campus.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <h3 className="mb-2 font-semibold text-gray-900">
              Book Your Seat
            </h3>
            <p className="text-sm text-gray-600">
              Reserve your spot on the next bus journey. No queues, no guesswork.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h3 className="mb-2 font-semibold text-gray-900">
              Real-Time Updates
            </h3>
            <p className="text-sm text-gray-600">
              Get notified about delays and schedule changes as they happen.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center">
        <p className="text-sm text-gray-500">
          © {new Date().getFullYear()} {UNIVERSITY_NAME}. All rights reserved.
        </p>
        <p className="mt-1 text-xs text-gray-400">{DEVELOPER_ATTRIBUTION}</p>
      </footer>
    </div>
  );
}
