/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The /api/*.ts files at the project root remain Vercel serverless
  // functions (configured in vercel.json) and are NOT moved into
  // app/api/. This keeps the existing webhook + OAuth + worker routes
  // untouched while Next.js handles the public-facing pages.
  // Vercel detects both styles and serves each correctly.
};

export default nextConfig;
