import express from "express";
import path from "path";
import { config } from "./config";
import { router } from "./services/router";
import { requireAuth, handleSpotifyCallback } from "./services/auth.middleware";
import { checkDbConnection, closeDb } from "./db/client";
import { closeRedis } from "./cache/cache";

const app = express();
app.use(express.json());

const isProd = config.env === "production";
const publicDir = path.join(__dirname, "public");

app.get("/api/v1/auth/login", (_req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: config.spotify.scopes,
    redirect_uri: config.spotify.redirectUri,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get("/api/v1/auth/login/cli", (_req, res) => {
  const cliRedirectUri = config.spotify.redirectUri.replace("/callback", "/callback/cli");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: config.spotify.scopes,
    redirect_uri: cliRedirectUri,
  });
  res.json({ url: `https://accounts.spotify.com/authorize?${params}` });
});

// Browser OAuth callback — redirects to frontend with token in URL
app.get("/api/v1/auth/callback", async (req, res, next) => {
  const originalJson = res.json.bind(res);
  const frontendBase = config.env === "production"
    ? ""                         
    : "http://localhost:5173";  

  (res as any).json = (body: any) => {
    const token = body?.token ?? null;
    if (token) {
      return res.redirect(`${frontendBase}/?token=${encodeURIComponent(token)}`);
    }
    return originalJson(body);
  };

  await handleSpotifyCallback(req, res).catch(next);
});

// CLI/curl callback — returns JSON instead of redirecting
app.get("/api/v1/auth/callback/cli", async (req, res, next) => {
  const cliRedirectUri = config.spotify.redirectUri.replace("/callback", "/callback/cli");
  await handleSpotifyCallback(req, res, cliRedirectUri).catch(next);
});

app.get("/health", async (_req, res) => {
  const ok = await checkDbConnection();
  res.json({ status: ok ? "ok" : "degraded", timestamp: new Date().toISOString() });
});

app.use("/api/v1", requireAuth, router);


if (isProd) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}


app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Error]", err.stack ?? err.message);
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

const server = app.listen(config.port, () => {
  console.log(`[Server] running on :${config.port} (${config.env})`);
});

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