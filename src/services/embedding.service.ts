import { Pinecone } from "@pinecone-database/pinecone";
import { SpotifyAudioFeatures, SongVector } from "../types/song";
import { cacheService } from "../cache/redis";
import { config } from "../config";

export function featuresToVector(features: SpotifyAudioFeatures): number[] {
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

  for (let i = 0; i < dim; i++) {
    const base = raw[i % raw.length];
    const offset = (i / dim) * 0.1;
    vector[i] = base + offset;
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector.fill(1 / Math.sqrt(dim));
  return vector.map((v) => v / norm);
}

function clamp(v: number, min = 0, max = 1): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

export class EmbeddingService {
  private _pinecone: Pinecone | null = null;

  private get pinecone(): Pinecone {
    if (!this._pinecone) {
      this._pinecone = new Pinecone({ apiKey: config.pinecone.apiKey });
    }
    return this._pinecone;
  }

  private get index() {
    return this.pinecone.index(config.pinecone.index);
  }

  async upsertSong(songVector: SongVector): Promise<void> {
    const hasInvalid = songVector.vector.some((v) => !Number.isFinite(v));
    console.log(`[Embed] upserting id=${songVector.songId} length=${songVector.vector.length} hasInvalid=${hasInvalid}`);

    // Pinecone rejects null/undefined metadata values
    const metadata = {
      title: songVector.metadata.title ?? "",
      artist: songVector.metadata.artist ?? "",
      energy: songVector.metadata.energy ?? 0,
      valence: songVector.metadata.valence ?? 0,
      tempo: songVector.metadata.tempo ?? 0,
    };

    await this.index.upsert([
      {
        id: songVector.songId,
        values: songVector.vector,
        metadata,
      },
    ]);
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
    const cached = await cacheService.getSongVector(songId);
    if (cached) {
      console.log(`[Embed] cache hit songId=${songId}`);
      return cached;
    }

    console.log(`[Embed] fetching from Pinecone songId=${songId}`);
    const result = await this.index.fetch([songId]);
    const record = result.records[songId];
    if (!record?.values) {
      console.log(`[Embed] not found in Pinecone songId=${songId}`);
      return null;
    }

    await cacheService.setSongVector(songId, record.values);
    return record.values;
  }

  async buildTasteVector(songIds: string[], userId: string): Promise<number[]> {
    const cached = await cacheService.getUserTasteVector(userId);
    if (cached && cached.length > 0) return cached;

    console.log(`[Embed] building taste vector, songIds=`, songIds);

    const vectors: number[][] = [];
    for (const id of songIds.slice(-50)) {
      const v = await this.getSongVector(id);
      if (v) vectors.push(v);
    }

    console.log(`[Embed] found ${vectors.length} vectors from ${songIds.length} songIds`);

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