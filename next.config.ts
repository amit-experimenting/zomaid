import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Empty Turbopack config silences Next 16's warning about Serwist's webpack hook.
  // Serwist is disabled in dev (see withSerwistInit above) and only runs at build time.
  turbopack: {},
  images: {
    // Allow recipe photos served from any Supabase storage bucket on this
    // project (URL host varies per env, so we match the *.supabase.co shape).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
};

export default withSerwist(nextConfig);
