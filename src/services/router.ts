import { Router, Response, NextFunction } from "express";
import { recommendService } from "./recommend.service";
import { playlistService } from "./playlist.service";
import { PlaylistConflictError } from "../types/playlist";
import { AuthRequest } from "./auth.middleware";
import { IngestionService } from "./ingestion.service";

export const router = Router();
export const ingestionService = new IngestionService();

function userId(req: AuthRequest): string {
  console.log("[Router] req.user =", req.user);
  if (!req.user?.id) throw new Error("Unauthenticated");
  return req.user.id;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

router.get("/recommendations", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const recs = await recommendService.getRecommendations(userId(req), limit);
    res.json({ recommendations: recs });
  } catch (err) {
    next(err);
  }
});

// ─── Playlists ────────────────────────────────────────────────────────────────

router.post("/playlists", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const playlist = await playlistService.create(userId(req), req.body);
    res.status(201).json({ playlist });
  } catch (err) {
    next(err);
  }
});

router.get("/playlists/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const playlist = await playlistService.getById(req.params.id, userId(req));
    if (!playlist) return res.status(404).json({ error: "Not found" });
    res.json({ playlist });
  } catch (err) {
    next(err);
  }
});

router.put("/playlists/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await playlistService.update(req.params.id, userId(req), req.body);

    if ("type" in result && (result as PlaylistConflictError).type === "CONFLICT") {
      const conflict = result as PlaylistConflictError;
      return res.status(409).json({
        error: conflict.message,
        currentVersion: conflict.currentVersion,
      });
    }

    res.json({ playlist: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/playlists/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await playlistService.delete(req.params.id, userId(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Ingestion ────────────────────────────────────────────────────────────────

// Ingest a single track by Spotify track ID
router.post("/ingest/track/:spotifyId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const song = await ingestionService.ingestTrack(req.params.spotifyId, userId(req));
    res.status(201).json({ song });
  } catch (err) {
    next(err);
  }
});

// Ingest results of a search query
router.post("/ingest/search", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { query, limit } = req.body as { query: string; limit?: number };
    if (!query) return res.status(400).json({ error: "query is required" });
    const songs = await ingestionService.ingestSearch(query, userId(req), limit);
    res.status(201).json({ count: songs.length, songs });
  } catch (err) {
    next(err);
  }
});

// Import user's recently played tracks from Spotify
router.post("/ingest/recently-played", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const songs = await ingestionService.importRecentlyPlayed(userId(req));
    res.status(201).json({ count: songs.length, songs });
  } catch (err) {
    next(err);
  }
});

// Import user's top tracks from Spotify
router.post("/ingest/top-tracks", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { timeRange } = req.body as { timeRange?: "short_term" | "medium_term" | "long_term" };
    const songs = await ingestionService.importTopTracks(userId(req), timeRange);
    res.status(201).json({ count: songs.length, songs });
  } catch (err) {
    next(err);
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});