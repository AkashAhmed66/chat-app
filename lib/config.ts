// Backend (REST + Socket.IO). Baked in at build time (see Dockerfile build arg).
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
