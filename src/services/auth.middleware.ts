import { Request, Response, NextFunction } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { config } from "../config";
import { JwtPayload, AuthenticatedUser, SpotifyTokenResponse } from "../types/user";

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  spotifyToken?: string;
}

// ─── JWT verification middleware ──────────────────────────────────────────────

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    console.log("[Auth] JWT payload =", payload);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else {
      res.status(401).json({ error: "Invalid token" });
    }
    return;
  }

  req.user = {
    id: payload.sub,
    spotifyId: payload.spotifyId,
    displayName: "",   // not stored in JWT — fetch from DB if needed
    email: payload.email,
  };

  next();
}

// ─── OAuth callback handler — exchanges code for tokens, upserts user ─────────

export async function handleSpotifyCallback(
  req: Request,
  res: Response
): Promise<void> {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code" });
    return;
  }

  // Exchange code for tokens
  let tokenData: SpotifyTokenResponse;
  try {
    tokenData = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[Auth] token exchange failed:", err);
    res.status(502).json({ error: "Failed to exchange token with Spotify" });
    return;
  }

  // Fetch user profile from Spotify
  let profile: { id: string; display_name: string; email: string };
  try {
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Spotify profile fetch: ${profileRes.status}`);
    profile = await profileRes.json();
  } catch (err) {
    console.error("[Auth] Spotify profile fetch failed:", err);
    res.status(502).json({ error: "Failed to fetch Spotify profile" });
    return;
  }

  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // Upsert user — insert on first login, update tokens on subsequent logins
  const [user] = await db
    .insert(users)
    .values({
      spotifyId: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
    })
    .onConflictDoUpdate({
      target: users.spotifyId,
      set: {
        accessToken: tokenData.access_token,
        ...(tokenData.refresh_token && { refreshToken: tokenData.refresh_token }),
        tokenExpiresAt,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Issue our own JWT so clients don't need to pass Spotify tokens
  const appToken = jwt.sign(
    {
      sub: user.id,
      spotifyId: user.spotifyId,
      email: user.email,
    } satisfies Omit<JwtPayload, "iat" | "exp">,
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as SignOptions["expiresIn"] }
  );

  res.json({ token: appToken, user: { id: user.id, displayName: user.displayName, email: user.email } });
}

// ─── Token refresh — called automatically when Spotify returns 401 ────────────

export async function refreshSpotifyToken(userId: string): Promise<string> {
  const [user] = await db
    .select({ refreshToken: users.refreshToken })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.refreshToken) {
    throw new Error("No refresh token available — user must re-authenticate");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: user.refreshToken,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64"),
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as SpotifyTokenResponse;
  const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db
    .update(users)
    .set({
      accessToken: data.access_token,
      ...(data.refresh_token && { refreshToken: data.refresh_token }),
      tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return data.access_token;
}

// ─── Helper: get a valid Spotify access token, refreshing if needed ───────────

export async function getValidSpotifyToken(userId: string): Promise<string> {
  const [user] = await db
    .select({
      accessToken: users.accessToken,
      tokenExpiresAt: users.tokenExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.accessToken) {
    throw new Error("User has no Spotify token — re-authentication required");
  }

  const isExpired =
    !user.tokenExpiresAt || user.tokenExpiresAt.getTime() < Date.now() + 60_000;

  if (isExpired) {
    return refreshSpotifyToken(userId);
  }

  return user.accessToken;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function exchangeCodeForTokens(code: string): Promise<SpotifyTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.spotify.redirectUri,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64"),
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token exchange ${res.status}: ${body}`);
  }

  return res.json() as Promise<SpotifyTokenResponse>;
}