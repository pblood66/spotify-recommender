import { db } from "../db/client";
import { songs } from "../db/schema";
import { eq } from "drizzle-orm";
import { SpotifyClient, SpotifyTrack, trackToFeatures } from "./spotify.client";
import { embeddingService, featuresToVector } from "./embedding.service";
import { getValidSpotifyToken } from "./auth.middleware";
import { Song } from "../types/song";

export class IngestionService {
  private async spotifyClient(userId: string): Promise<SpotifyClient> {
    const token = await getValidSpotifyToken(userId);
    return new SpotifyClient(token);
  }

  async ingestTrack(spotifyId: string, userId: string): Promise<Song> {
    const existing = await db
      .select()
      .from(songs)
      .where(eq(songs.spotifyId, spotifyId))
      .limit(1);

    if (existing.length > 0 && existing[0].vectorId) {
      console.log(`[Ingest] ${spotifyId} already ingested, skipping`);
      return existing[0] as Song;
    }

    const client = await this.spotifyClient(userId);
    const track = await client.getTrack(spotifyId);
    return this.ingestTrackObject(track);
  }

  async ingestTrackObjects(tracks: SpotifyTrack[]): Promise<Song[]> {
    // Dedupe by spotifyId
    const unique = Array.from(new Map(tracks.map((t) => [t.id, t])).values());

    // Skip already-ingested tracks
    const existingRows = await db.select({ spotifyId: songs.spotifyId }).from(songs);
    const ingested = new Set(existingRows.map((r) => r.spotifyId));
    const toIngest = unique.filter((t) => !ingested.has(t.id));

    if (toIngest.length === 0) {
      console.log(`[Ingest] all ${unique.length} tracks already ingested`);
      return db.select().from(songs) as Promise<Song[]>;
    }

    console.log(`[Ingest] ingesting ${toIngest.length} new tracks`);

    const results: Song[] = [];
    for (const track of toIngest) {
      try {
        const song = await this.ingestTrackObject(track);
        results.push(song);
      } catch (err) {
        console.error(`[Ingest] failed on ${track.id} (${track.name}):`, err);
      }
    }

    console.log(`[Ingest] done — ${results.length} ingested`);
    return results;
  }


  private async ingestTrackObject(track: SpotifyTrack): Promise<Song> {
    const features = trackToFeatures(track);
    const vector = featuresToVector(features);

    const [song] = await db
      .insert(songs)
      .values({
        spotifyId: track.id,
        title: track.name,
        artist: track.artists.map((a) => a.name).join(", "),
        album: track.album.name,
        durationMs: track.duration_ms,
        previewUrl: track.preview_url,
        imageUrl: track.album.images[0]?.url ?? null,
        audioFeatures: features,
        vectorId: track.id,
      })
      .onConflictDoUpdate({
        target: songs.spotifyId,
        set: { audioFeatures: features, vectorId: track.id, updatedAt: new Date() },
      })
      .returning();

    await embeddingService.upsertSong({
      songId: song.id,
      vector,
      metadata: {
        title: song.title,
        artist: song.artist,
        energy: features.energy,
        valence: features.valence,
        tempo: features.tempo,
      },
    });

    console.log(`[Ingest] "${song.title}" by ${song.artist}`);
    return song as Song;
  }

  async importRecentlyPlayed(userId: string): Promise<Song[]> {
    const client = await this.spotifyClient(userId);
    const tracks = await client.getRecentlyPlayed(50);
    console.log(`[Ingest] importing ${tracks.length} recently played tracks`);
    return this.ingestTrackObjects(tracks);
  }


  async importTopTracks(
    userId: string,
    timeRange: "short_term" | "medium_term" | "long_term" = "medium_term"
  ): Promise<Song[]> {
    const client = await this.spotifyClient(userId);
    const tracks = await client.getTopTracks(timeRange, 50);
    console.log(`[Ingest] importing ${tracks.length} top tracks (${timeRange})`);
    return this.ingestTrackObjects(tracks);
  }

  async ingestSearch(query: string, userId: string, limit = 20): Promise<Song[]> {
    const client = await this.spotifyClient(userId);
    console.log("Found client, searching Spotify for", query);
    const tracks = await client.searchTracks(query, limit);
    console.log(`[Ingest] ingesting ${tracks.length} tracks for query "${query}"`);
    return this.ingestTrackObjects(tracks);
  }
}

export const ingestionService = new IngestionService();