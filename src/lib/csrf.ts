import { NextRequest } from "next/server";

export function checkOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true; // Allow requests without origin (same-origin, curl)
  const originHost = new URL(origin).host;
  return originHost === host;
}
