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
  const raw = [
    features.danceability,
    features.energy,
    features.key / 11,            // normalise 0-11 → 0-1
    (features.loudness + 60) / 60, // normalise -60..0 dB
    features.mode,
    features.speechiness,
    features.acousticness,
    features.instrumentalness,
    features.liveness,
    features.valence,
    features.tempo / 250,          // normalise ~40-250 BPM
    features.duration_ms / 600_000,
    features.time_signature / 7,
    0,                             // padding to 14 dims
  ];

  const dim = 768;
  const vector = new Array<number>(dim);

  for (let i = 0; i < dim; i++) {
    const featureIdx = i % raw.length;
    // Sinusoidal position encoding mixed with feature value
    const pos = Math.sin((i / dim) * Math.PI * 2);
    vector[i] = raw[featureIdx] * Math.cos(pos) + pos * 0.01;
  }

  // L2 normalise
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / norm);
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
