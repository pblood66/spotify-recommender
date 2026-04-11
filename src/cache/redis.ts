import { RecommendationResult } from "../types/song";
import { Playlist } from "../types/playlist";
import { getRedisClient } from "./cache";

const TTL = {
  RECOMMENDATIONS: 5 * 60,    // 5 minutes — recommendations go stale quickly
  SONG_VECTOR: 30 * 60,        // 30 minutes — audio features rarely change
  PLAYLIST: 2 * 60,            // 2 minutes — playlists change more often
  USER_TASTE_VECTOR: 10 * 60,  // 10 minutes — recalculate as plays accumulate
};

export class CacheService {
  private get client() {
    return getRedisClient();
  }

  // ─── Recommendations ─────────────────────────────────────────────────────

  async getRecommendations(userId: string): Promise<RecommendationResult[] | null> {
    const raw = await this.client.get(`recs:${userId}`);
    return raw ? (JSON.parse(raw) as RecommendationResult[]) : null;
  }

  async setRecommendations(userId: string, recs: RecommendationResult[]): Promise<void> {
    await this.client.setex(`recs:${userId}`, TTL.RECOMMENDATIONS, JSON.stringify(recs));
  }

  async invalidateRecommendations(userId: string): Promise<void> {
    await this.client.del(`recs:${userId}`);
  }

  // ─── Song vectors (hot path) ──────────────────────────────────────────────

  async getSongVector(songId: string): Promise<number[] | null> {
    const raw = await this.client.get(`vec:song:${songId}`);
    return raw ? (JSON.parse(raw) as number[]) : null;
  }

  async setSongVector(songId: string, vector: number[]): Promise<void> {
    await this.client.setex(`vec:song:${songId}`, TTL.SONG_VECTOR, JSON.stringify(vector));
  }

  // ─── User taste vector ────────────────────────────────────────────────────

  async getUserTasteVector(userId: string): Promise<number[] | null> {
    const raw = await this.client.get(`vec:taste:${userId}`);
    return raw ? (JSON.parse(raw) as number[]) : null;
  }

  async setUserTasteVector(userId: string, vector: number[]): Promise<void> {
    await this.client.setex(`vec:taste:${userId}`, TTL.USER_TASTE_VECTOR, JSON.stringify(vector));
  }

  async invalidateUserTasteVector(userId: string): Promise<void> {
    await this.client.del(`vec:taste:${userId}`);
  }

  // ─── Playlists ────────────────────────────────────────────────────────────

  async getPlaylist(playlistId: string): Promise<Playlist | null> {
    const raw = await this.client.get(`playlist:${playlistId}`);
    return raw ? (JSON.parse(raw) as Playlist) : null;
  }

  // Write-through: called on every successful DB write so cache stays warm
  async setPlaylist(playlist: Playlist): Promise<void> {
    await this.client.setex(
      `playlist:${playlist.id}`,
      TTL.PLAYLIST,
      JSON.stringify(playlist)
    );
  }

  async invalidatePlaylist(playlistId: string): Promise<void> {
    await this.client.del(`playlist:${playlistId}`);
  }

  // ─── Health check ─────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}

export const cacheService = new CacheService();