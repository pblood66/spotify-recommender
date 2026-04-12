const BASE = "/api/v1";

function getToken(): string | null {
  return localStorage.getItem("token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.reload();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  recommendations: () =>
    request<{ recommendations: Recommendation[] }>("/recommendations"),

  ingestRecentlyPlayed: () =>
    request<{ count: number; songs: Song[] }>("/ingest/recently-played", { method: "POST" }),

  ingestTopTracks: (timeRange = "medium_term") =>
    request<{ count: number; songs: Song[] }>("/ingest/top-tracks", {
      method: "POST",
      body: JSON.stringify({ timeRange }),
    }),

  ingestSearch: (query: string) =>
    request<{ count: number; songs: Song[] }>("/ingest/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: 20 }),
    }),

  recordPlay: (spotifyId: string, skipped = false, durationListenedMs?: number) =>
    request<{ recorded: boolean }>("/history", {
      method: "POST",
      body: JSON.stringify({ spotifyId, skipped, durationListenedMs }),
    }),

  getHistory: () =>
    request<{ history: HistoryEntry[] }>("/history"),
};

export interface Song {
  id: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  imageUrl: string | null;
  previewUrl: string | null;
}

export interface Recommendation {
  song: Song;
  score: number;
  reason: string;
}

export interface HistoryEntry {
  songId: string;
  spotifyId: string;
  title: string;
  artist: string;
  playedAt: string;
  skipped: boolean;
  durationListenedMs: number | null;
}
