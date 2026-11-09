import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

/**
 * Auth route group layout.
 * Provides a centered card layout for login and registration pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}

