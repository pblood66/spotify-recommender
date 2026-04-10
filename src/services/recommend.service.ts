import { Pinecone } from "@pinecone-database/pinecone";
import { db } from "../db/client";
import { songs, playHistory } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { cacheService } from "../cache/redis";
import { embeddingService } from "./embedding.service";
import { RecommendationResult, Song } from "../types/song";

export class RecommendService {
  private pinecone: Pinecone;

  constructor() {
    this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }

  private get index() {
    return this.pinecone.index(process.env.PINECONE_INDEX ?? "songs");
  }

  async getRecommendations(
    userId: string,
    limit = 20
  ): Promise<RecommendationResult[]> {
    // 1. Check Redis cache first (cache-aside read)
    const cached = await cacheService.getRecommendations(userId);
    if (cached) return cached;

    // 2. Fetch user's recent play history (last 50 songs)
    const history = await db
      .select({ songId: playHistory.songId })
      .from(playHistory)
      .where(eq(playHistory.userId, userId))
      .orderBy(playHistory.playedAt)
      .limit(50);

    if (history.length === 0) {
      return this.getPopularFallback(limit);
    }

    const playedIds = history.map((h) => h.songId);

    // 3. Build taste vector from play history
    const tasteVector = await embeddingService.buildTasteVector(playedIds, userId);

    // 4. Query Pinecone for top-K nearest neighbours
    const queryResult = await this.index.query({
      vector: tasteVector,
      topK: limit + playedIds.length, // over-fetch then filter already-heard
      includeMetadata: true,
      filter: { type: { $ne: "playlist" } }, // exclude playlist mean vectors
    });

    // 5. Filter out already-played songs
    const playedSet = new Set(playedIds);
    const candidates = queryResult.matches
      .filter((m) => !playedSet.has(m.id))
      .slice(0, limit);

    if (candidates.length === 0) return [];

    // 6. Hydrate from Postgres for full song data
    const songRecords = await db
      .select()
      .from(songs)
      .where(inArray(songs.id, candidates.map((c) => c.id)));

    const songMap = new Map(songRecords.map((s) => [s.id, s]));

    const results: RecommendationResult[] = candidates
      .map((c) => {
        const song = songMap.get(c.id);
        if (!song) return null;
        return {
          song: song as Song,
          score: c.score ?? 0,
          reason: scoreToReason(c.score ?? 0),
        };
      })
      .filter((r): r is RecommendationResult => r !== null);

    // 7. Populate Redis cache (write-through on read miss)
    await cacheService.setRecommendations(userId, results);

    return results;
  }

  private async getPopularFallback(limit: number): Promise<RecommendationResult[]> {
    const popularSongs = await db
      .select()
      .from(songs)
      .limit(limit);

    return popularSongs.map((song) => ({
      song: song as Song,
      score: 1,
      reason: "Popular on the platform",
    }));
  }
}

function scoreToReason(score: number): string {
  if (score > 0.95) return "Nearly identical vibe to your recent listening";
  if (score > 0.85) return "Very similar energy and mood";
  if (score > 0.75) return "Matches your taste profile";
  return "Something a bit different you might enjoy";
}

export const recommendService = new RecommendService();
