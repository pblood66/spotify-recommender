import { db } from "../db/client";
import { playlists, songs } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { cacheService } from "../cache/redis";
import { embeddingService } from "./embedding.service";
import {
  Playlist,
  CreatePlaylistDTO,
  UpdatePlaylistDTO,
  PlaylistConflictError,
} from "../types/playlist";

export class PlaylistService {
  async create(userId: string, dto: CreatePlaylistDTO): Promise<Playlist> {
    const [created] = await db
      .insert(playlists)
      .values({
        userId,
        name: dto.name,
        description: dto.description ?? null,
        songIds: dto.songIds ?? [],
        isPublic: dto.isPublic ?? false,
        version: 0,
      })
      .returning();

    const playlist = created as Playlist;

    // Write-through: populate cache immediately
    await cacheService.setPlaylist(playlist);

    // If songs were provided, compute and upsert the playlist mean vector
    if (playlist.songIds.length > 0) {
      void this.refreshPlaylistVector(playlist);
    }

    return playlist;
  }

  async getById(playlistId: string, userId: string): Promise<Playlist | null> {
    // Cache-aside read
    const cached = await cacheService.getPlaylist(playlistId);
    if (cached) {
      // Security: even on a cache hit, verify ownership
      if (cached.userId !== userId && !cached.isPublic) return null;
      return cached;
    }

    const [row] = await db
      .select()
      .from(playlists)
      .where(eq(playlists.id, playlistId));

    if (!row) return null;
    if (row.userId !== userId && !row.isPublic) return null;

    const playlist = row as Playlist;
    await cacheService.setPlaylist(playlist);
    return playlist;
  }

  /**
   * Optimistic concurrency update.
   *
   * The UPDATE WHERE version = dto.version will match 0 rows if another
   * writer already incremented the version, returning a 409 to the caller.
   * No distributed lock needed — the DB atomically enforces the check.
   */
  async update(
    playlistId: string,
    userId: string,
    dto: UpdatePlaylistDTO
  ): Promise<Playlist | PlaylistConflictError> {
    const result = await db
      .update(playlists)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.songIds !== undefined && { songIds: dto.songIds }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        version: dto.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(playlists.id, playlistId),
          eq(playlists.userId, userId),
          eq(playlists.version, dto.version)  // ← the optimistic lock check
        )
      )
      .returning();

    if (result.length === 0) {
      // Either the playlist doesn't exist or version mismatch — fetch to distinguish
      const [current] = await db
        .select({ version: playlists.version })
        .from(playlists)
        .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)));

      if (!current) {
        throw new Error("Playlist not found or access denied");
      }

      // Version mismatch — return conflict so client can re-fetch and retry
      return {
        type: "CONFLICT",
        message: "Playlist was modified by another request. Please re-fetch and retry.",
        currentVersion: current.version,
      };
    }

    const updated = result[0] as Playlist;

    // Write-through: update cache and invalidate stale recommendations
    await cacheService.setPlaylist(updated);
    await cacheService.invalidateRecommendations(userId);

    // Async: recompute playlist vector in background (don't block response)
    if (dto.songIds !== undefined) {
      void this.refreshPlaylistVector(updated);
    }

    return updated;
  }

  async delete(playlistId: string, userId: string): Promise<void> {
    await db
      .delete(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)));

    await cacheService.invalidatePlaylist(playlistId);
  }

  private async refreshPlaylistVector(playlist: Playlist): Promise<void> {
    try {
      const songRecords = await db
        .select({ id: songs.id })
        .from(songs)
        .where(
          // Only songs that have been embedded
          eq(songs.vectorId, songs.id)
        );

      const vectors = await Promise.all(
        songRecords.map((s) => embeddingService.getSongVector(s.id))
      );

      const validVectors = vectors.filter((v): v is number[] => v !== null);
      if (validVectors.length > 0) {
        await embeddingService.upsertPlaylist(playlist.id, validVectors);
      }
    } catch (err) {
      console.error("[PlaylistService] Failed to refresh playlist vector:", err);
    }
  }
}

export const playlistService = new PlaylistService();
