import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
} from "drizzle-orm/pg-core";

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  spotifyId: text("spotify_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  accessToken: text("access_token"),           // encrypted at rest via pgcrypto
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Songs (local cache of Spotify data) ──────────────────────────────────────

export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotifyId: text("spotify_id").notNull().unique(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    album: text("album").notNull(),
    durationMs: integer("duration_ms").notNull(),
    previewUrl: text("preview_url"),
    imageUrl: text("image_url"),
    audioFeatures: jsonb("audio_features"),    // SpotifyAudioFeatures
    vectorId: text("vector_id"),               // Pinecone vector ID
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    spotifyIdIdx: index("songs_spotify_id_idx").on(t.spotifyId),
  })
);

// ─── Playlists ────────────────────────────────────────────────────────────────

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    songIds: jsonb("song_ids").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(0),  // optimistic lock
    isPublic: boolean("is_public").notNull().default(false),
    vectorId: text("vector_id"),               // mean playlist vector in Pinecone
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdIdx: index("playlists_user_id_idx").on(t.userId),
  })
);

// ─── Play history (used to build taste vector) ────────────────────────────────

export const playHistory = pgTable(
  "play_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    songId: uuid("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    playedAt: timestamp("played_at").defaultNow().notNull(),
    durationListenedMs: integer("duration_listened_ms"),
    skipped: boolean("skipped").notNull().default(false),
  },
  (t) => ({
    userIdIdx: index("play_history_user_id_idx").on(t.userId),
    playedAtIdx: index("play_history_played_at_idx").on(t.playedAt),
  })
);
