import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React strict mode for catching bugs early
  reactStrictMode: true,

  // Image optimization domains (add Supabase storage when configured)
  images: {
    remotePatterns: [
      // Supabase storage — uncomment and set your project ref when ready
      // {
      //   protocol: 'https',
      //   hostname: '*.supabase.co',
      //   pathname: '/storage/v1/object/public/**',
      // },
    ],
  },

  // Headers for PWA and security
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
