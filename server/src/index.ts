import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { config } from "./config";
import { migrate, pool, waitForDb } from "./db";
import authRoutes from "./routes/auth";
import callRoutes from "./routes/calls";
import chatLockRoutes from "./routes/chat-lock";
import friendRoutes from "./routes/friends";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import uploadRoutes, { UPLOADS_ROOT } from "./routes/upload";
import userRoutes from "./routes/users";
import { initSocket } from "./socket";
import { HttpError } from "./utils";

async function main() {
  await waitForDb();
  await migrate();

  // Calls left "ringing"/"accepted" by a previous crash can never finish.
  await pool.query(
    `UPDATE calls SET status = 'ended', ended_at = now() WHERE status IN ('ringing', 'accepted')`
  );

  if (!fs.existsSync(UPLOADS_ROOT)) fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // Static files for media and avatars
  app.use("/uploads", express.static(UPLOADS_ROOT));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/friends", friendRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/calls", callRoutes);
  app.use("/api/chat-lock", chatLockRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.port, () => {
    console.log(`Backend listening on :${config.port}`);
  });

  const shutdown = () => {
    console.log("Shutting down...");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Failed to start backend", err);
  process.exit(1);
});
