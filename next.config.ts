
import type { NextConfig } from "next";

const keycloakIssuer = process.env.KEYCLOAK_ISSUER?.replace(/\/+$/, "") ?? "";
const keycloakOrigin = keycloakIssuer ? new URL(keycloakIssuer).origin : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  `form-action 'self'${keycloakOrigin ? ` ${keycloakOrigin}` : ""}`,
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://authjs.dev",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: http: ws: wss:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
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
