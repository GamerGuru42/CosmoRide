import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, UNIVERSITY_NAME } from "@/lib/constants";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Register",
};

/**
 * Registration page — creates a new student account via Supabase Auth.
 */
export default function RegisterPage() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-primary)] text-white font-bold text-xl">
          C
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          Create your {APP_NAME} account
        </h1>
        <p className="mt-1 text-sm text-gray-500">{UNIVERSITY_NAME}</p>
      </div>

      {/* Register Form (Client Component) */}
      <RegisterForm />

      {/* Login Link */}
      <p className="mt-6 text-center text-sm text-gray-600">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--color-primary)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

