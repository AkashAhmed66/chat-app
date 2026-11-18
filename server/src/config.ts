function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://localhost:5000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Set COOKIE_SECURE=true when the site is served over HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === "true",
  livekit: {
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
    // URL the *browser* uses to reach LiveKit.
    publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? "ws://localhost:7880",
  },
  ringTimeoutMs: Number(process.env.RING_TIMEOUT_MS ?? 30000),
  offlineGraceMs: 5000,
};
