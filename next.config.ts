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
};

export default withSerwist(nextConfig);
