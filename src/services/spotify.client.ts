import { SpotifyAudioFeatures } from "../types/song";

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string; id: string }>;
  album: {
    name: string;
    images: Array<{ url: string }>;
    release_date: string;
    album_type: string;
  };
  duration_ms: number;
  preview_url: string | null;
  explicit: boolean;
  popularity: number;
  track_number: number;
  disc_number: number;
}

export class SpotifyClient {
  private readonly baseUrl = "https://api.spotify.com/v1";

  constructor(private accessToken: string) {}

  private async fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 401) throw new Error("SPOTIFY_TOKEN_EXPIRED");
    if (!res.ok) throw new Error(`Spotify API error: ${res.status} on ${path}`);
    return res.json() as Promise<T>;
  }

  async getTrack(spotifyId: string): Promise<SpotifyTrack> {
    return this.fetch<SpotifyTrack>(`/tracks/${spotifyId}`);
  }

  async searchTracks(query: string, limit = 20): Promise<SpotifyTrack[]> {
    const res = await this.fetch<{ tracks: { items: SpotifyTrack[] } }>(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
    );
    return res.tracks.items;
  }

  async getRecentlyPlayed(limit = 50): Promise<SpotifyTrack[]> {
    const res = await this.fetch<{ items: Array<{ track: SpotifyTrack }> }>(
      `/me/player/recently-played?limit=${limit}`
    );
    return res.items.map((i) => i.track);
  }

  async getTopTracks(
    timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
    limit = 50
  ): Promise<SpotifyTrack[]> {
    const res = await this.fetch<{ items: SpotifyTrack[] }>(
      `/me/top/tracks?time_range=${timeRange}&limit=${limit}`
    );
    return res.items;
  }
}

/**
 * Derives a pseudo audio-features object from a plain track response.
 * Spotify deprecated /audio-features for apps created after Nov 2024.
 * We approximate from fields still available: popularity, duration,
 * explicit flag, release year, and a stable per-artist hash so songs
 * by the same artist cluster together in vector space.
 */
export function trackToFeatures(track: SpotifyTrack): SpotifyAudioFeatures {
  const pop = clampF(track.popularity / 100);
  const releaseYear = parseInt(track.album?.release_date?.slice(0, 4) ?? "2000");
  const era = clampF((releaseYear - 1950) / 80);
  const explicit = track.explicit ? 1 : 0;
  const trackNumNorm = clampF(track.track_number / 20);
  const artistHash =
    (track.artists?.[0]?.id ?? "")
      .split("")
      .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0) / 0xffff;

  return {
    id: track.id,
    danceability: clampF(pop * 0.7 + era * 0.2 + artistHash * 0.1),
    energy: clampF(pop * 0.6 + explicit * 0.3 + artistHash * 0.1),
    key: Math.floor(clampF(artistHash) * 11),
    loudness: -60 + clampF(pop) * 55,
    mode: era > 0.5 ? 1 : 0,
    speechiness: clampF(explicit * 0.3 + pop * 0.1),
    acousticness: clampF(1 - pop * 0.7 - explicit * 0.2),
    instrumentalness: clampF(0.5 - pop * 0.5 - explicit * 0.3),
    liveness: clampF(trackNumNorm * 0.2 + artistHash * 0.1),
    valence: clampF(pop * 0.5 + era * 0.3 + artistHash * 0.2),
    tempo: 80 + clampF(pop) * 100,
    duration_ms: track.duration_ms ?? 0,
    time_signature: 4,
  };
}

function clampF(v: number, min = 0, max = 1): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}