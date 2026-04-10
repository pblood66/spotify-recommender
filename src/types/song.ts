export interface SpotifyAudioFeatures {
  id: string;
  danceability: number;
  energy: number;
  key: number;
  loudness: number;
  mode: number;
  speechiness: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  valence: number;
  tempo: number;
  duration_ms: number;
  time_signature: number;
}

export interface Song {
  id: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  previewUrl: string | null;
  imageUrl: string | null;
  audioFeatures: SpotifyAudioFeatures | null;
  vectorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SongVector {
  songId: string;
  vector: number[];  // 768-dim
  metadata: {
    title: string;
    artist: string;
    energy: number;
    valence: number;
    tempo: number;
  };
}

export interface RecommendationResult {
  song: Song;
  score: number;
  reason: string;
}
