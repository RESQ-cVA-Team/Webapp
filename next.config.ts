
import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  isDevelopment ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  // Next's own require-hook resolves @swc/helpers' ESM interop files
  // (esm/_interop_require_default.js etc.) at runtime, but the standalone
  // build's file tracer only follows the CJS branch of @swc/helpers'
  // conditional exports -- the ESM files never get copied into
  // .next/standalone, so the container crashes with MODULE_NOT_FOUND on
  // startup. Force the whole package in regardless of what static tracing
  // determines is needed.
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/@swc/helpers/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
