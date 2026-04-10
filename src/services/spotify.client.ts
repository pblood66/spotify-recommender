import { SpotifyAudioFeatures } from "../types/song";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; images: Array<{ url: string }> };
  duration_ms: number;
  preview_url: string | null;
}

export class SpotifyClient {
  private readonly baseUrl = "https://api.spotify.com/v1";

  constructor(private accessToken: string) {}

  private async fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (res.status === 401) {
      throw new Error("SPOTIFY_TOKEN_EXPIRED");
    }
    if (!res.ok) {
      throw new Error(`Spotify API error: ${res.status} on ${path}`);
    }
    return res.json() as Promise<T>;
  }

  async getTrack(spotifyId: string): Promise<SpotifyTrack> {
    return this.fetch<SpotifyTrack>(`/tracks/${spotifyId}`);
  }

  async getAudioFeatures(spotifyId: string): Promise<SpotifyAudioFeatures> {
    return this.fetch<SpotifyAudioFeatures>(`/audio-features/${spotifyId}`);
  }

  // Batch fetch up to 100 tracks at once
  async getAudioFeaturesBatch(
    spotifyIds: string[]
  ): Promise<SpotifyAudioFeatures[]> {
    const chunks = chunkArray(spotifyIds, 100);
    const results: SpotifyAudioFeatures[] = [];

    for (const chunk of chunks) {
      const res = await this.fetch<{ audio_features: SpotifyAudioFeatures[] }>(
        `/audio-features?ids=${chunk.join(",")}`
      );
      results.push(...res.audio_features.filter(Boolean));
    }

    return results;
  }

  // Search for songs to seed the recommender
  async searchTracks(
    query: string,
    limit = 20
  ): Promise<SpotifyTrack[]> {
    const res = await this.fetch<{
      tracks: { items: SpotifyTrack[] };
    }>(`/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);
    return res.tracks.items;
  }

  // Get the user's recently played tracks (for taste vector)
  async getRecentlyPlayed(limit = 50): Promise<SpotifyTrack[]> {
    const res = await this.fetch<{
      items: Array<{ track: SpotifyTrack }>;
    }>(`/me/player/recently-played?limit=${limit}`);
    return res.items.map((i) => i.track);
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
