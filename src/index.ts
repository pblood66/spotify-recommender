import express from "express";
import { config } from "./config";
import { router } from "./services/router";
import { requireAuth, handleSpotifyCallback } from "./services/auth.middleware";
import { checkDbConnection, closeDb } from "./db/client";
import { closeRedis } from "./cache/cache";

const app = express();
app.use(express.json());

// ─── Auth routes (no JWT required) ────────────────────────────────────────────

app.get("/api/v1/auth/login", (_req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: config.spotify.scopes,
    redirect_uri: config.spotify.redirectUri,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get("/api/v1/auth/callback", handleSpotifyCallback);

app.get("/health", async (_req, res) => {
  const ok = await checkDbConnection();
  res.json({ status: ok ? "ok" : "degraded", timestamp: new Date().toISOString() });
});

// ─── Protected routes ─────────────────────────────────────────────────────────

app.use("/api/v1", requireAuth, router);

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  console.log(`[Server] running on :${config.port} (${config.env})`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`[Server] ${signal} received — shutting down`);
  server.close(async () => {
    await Promise.all([closeDb(), closeRedis()]);
    console.log("[Server] shutdown complete");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));