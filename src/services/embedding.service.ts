import { Pinecone } from "@pinecone-database/pinecone";
import { SpotifyAudioFeatures, SongVector } from "../types/song";
import { cacheService } from "../cache/redis";

/**
 * Projects Spotify audio features into a 768-dim vector.
 *
 * In production you'd use a trained model (e.g. fine-tuned MusicBERT,
 * or a simple MLP trained on user engagement data). This baseline uses
 * a deterministic projection so the system is immediately runnable.
 *
 * The 14 raw features → tiled into 768 dims with sinusoidal position encoding,
 * then L2-normalised. Cosine similarity in Pinecone is then equivalent to
 * dot product on normalised vectors.
 */
export function featuresToVector(features: SpotifyAudioFeatures): number[] {
  // Normalise all 14 raw features to [0, 1]
  const raw = [
    clamp(features.danceability),
    clamp(features.energy),
    clamp(features.key / 11),
    clamp((features.loudness + 60) / 60),
    clamp(features.mode),
    clamp(features.speechiness),
    clamp(features.acousticness),
    clamp(features.instrumentalness),
    clamp(features.liveness),
    clamp(features.valence),
    clamp(features.tempo / 250),
    clamp(features.duration_ms / 600_000),
    clamp(features.time_signature / 7),
    0,
  ];

  const dim = 768;
  const vector = new Array<number>(dim);

  // Tile the 14 features across 768 dims, mixing in a deterministic
  // per-position offset so adjacent tiles aren't identical.
  for (let i = 0; i < dim; i++) {
    const base = raw[i % raw.length];
    const offset = (i / dim) * 0.1; // small linear drift 0..0.1
    vector[i] = base + offset;
  }

  // L2 normalise — guaranteed safe because raw values are all finite
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector.fill(1 / Math.sqrt(dim)); // degenerate fallback
  return vector.map((v) => v / norm);
}

function clamp(v: number, min = 0, max = 1): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

export class EmbeddingService {
  private pinecone: Pinecone;
  private indexName: string;

  constructor() {
    this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    this.indexName = process.env.PINECONE_INDEX ?? "songs";
  }

  private get index() {
    return this.pinecone.index(this.indexName);
  }

  async upsertSong(songVector: SongVector): Promise<void> {
    const sample = songVector.vector.slice(0, 5);
    const hasInvalid = songVector.vector.some((v) => !Number.isFinite(v));
    console.log(`[Embed] vector sample: ${sample}, hasInvalid: ${hasInvalid}, length: ${songVector.vector.length}`);
    await this.index.upsert([
      {
        id: songVector.songId,
        values: songVector.vector,
        metadata: songVector.metadata,
      },
    ]);
    // Warm the Redis cache immediately after upsert
    await cacheService.setSongVector(songVector.songId, songVector.vector);
  }

  async upsertPlaylist(playlistId: string, songVectors: number[][]): Promise<void> {
    if (songVectors.length === 0) return;
    const mean = meanVector(songVectors);
    await this.index.upsert([
      { id: `playlist:${playlistId}`, values: mean, metadata: { type: "playlist" } },
    ]);
  }

  async getSongVector(songId: string): Promise<number[] | null> {
    // Cache-aside: check Redis first
    const cached = await cacheService.getSongVector(songId);
    if (cached) return cached;

    const result = await this.index.fetch([songId]);
    const record = result.records[songId];
    if (!record?.values) return null;

    // Populate cache on miss
    await cacheService.setSongVector(songId, record.values);
    return record.values;
  }

  /**
   * Compute the user's taste vector as the mean of their last N played song vectors.
   * Cached aggressively since this is the hot path for recommendations.
   */
  async buildTasteVector(
    songIds: string[],
    userId: string
  ): Promise<number[]> {
    const cached = await cacheService.getUserTasteVector(userId);
    if (cached) return cached;

    const vectors: number[][] = [];
    for (const id of songIds.slice(-50)) {
      const v = await this.getSongVector(id);
      if (v) vectors.push(v);
    }

    if (vectors.length === 0) {
      throw new Error("No song vectors found to build taste vector");
    }

    const taste = meanVector(vectors);
    await cacheService.setUserTasteVector(userId, taste);
    return taste;
  }
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  const mean = sum.map((s) => s / vectors.length);
  const norm = Math.sqrt(mean.reduce((acc, v) => acc + v * v, 0));
  return mean.map((v) => v / norm);
}

export const embeddingService = new EmbeddingService();