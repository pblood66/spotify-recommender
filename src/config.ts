function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function buildConfig() {
  return {
    env: optional("NODE_ENV", "development"),
    port: parseInt(optional("PORT", "3000")),

    db: {
      url: getEnv("DATABASE_URL"),
      poolMin: parseInt(optional("DB_POOL_MIN", "2")),
      poolMax: parseInt(optional("DB_POOL_MAX", "20")),
      idleTimeoutMs: parseInt(optional("DB_IDLE_TIMEOUT_MS", "30000")),
      connectionTimeoutMs: parseInt(optional("DB_CONN_TIMEOUT_MS", "5000")),
    },

    redis: {
      host: optional("REDIS_HOST", "localhost"),
      port: parseInt(optional("REDIS_PORT", "6379")),
      password: process.env.REDIS_PASSWORD,
    },

    pinecone: {
      apiKey: getEnv("PINECONE_API_KEY"),
      index: optional("PINECONE_INDEX", "songs"),
    },

    jwt: {
      secret: getEnv("JWT_SECRET"),
      expiresIn: optional("JWT_EXPIRES_IN", "24h"),
    },

    spotify: {
      clientId: getEnv("SPOTIFY_CLIENT_ID"),
      clientSecret: getEnv("SPOTIFY_CLIENT_SECRET"),
      redirectUri: optional(
        "SPOTIFY_REDIRECT_URI",
        "http://127.0.0.1:3000/api/v1/auth/callback"
      ),
      scopes: [
        "user-read-email",
        "user-read-recently-played",
        "user-top-read",
        "playlist-read-private",
        "playlist-modify-private",
        "playlist-modify-public",
      ].join(" "),
    },
  };
}

type Config = ReturnType<typeof buildConfig>;
let _config: Config | null = null;

// Proxy defers all property reads until first access, by which point
// bootstrap.ts has already called dotenv.config() and populated process.env.
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    if (!_config) _config = buildConfig();
    return _config[prop as keyof Config];
  },
});