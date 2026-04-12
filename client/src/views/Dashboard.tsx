import { useState, useEffect, useCallback } from "react";
import { api, Recommendation, HistoryEntry, Song } from "../api";
import SongCard from "../components/SongCard";
import styles from "./Dashboard.module.css";

type Tab = "recs" | "ingest" | "history";

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("recs");
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadRecs = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const data = await api.recommendations();
      setRecs(data.recommendations);
      if (data.recommendations.length === 0) {
        setStatus("No recommendations yet — ingest some songs and record a few plays first.");
      }
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getHistory();
      setHistory(data.history);
    } catch {}
  }, []);

  useEffect(() => { loadRecs(); }, [loadRecs]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  async function ingest(fn: () => Promise<{ count: number; songs: Song[] }>) {
    setLoading(true);
    setStatus("");
    try {
      const data = await fn();
      setStatus(`✓ ingested ${data.count} tracks`);
    } catch (e: any) {
      setStatus(`✗ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function recordPlay(spotifyId: string, skipped: boolean) {
    try {
      await api.recordPlay(spotifyId, skipped);
      // Refresh recommendations after recording a play
      await loadRecs();
    } catch {}
  }

  function logout() {
    localStorage.removeItem("token");
    window.location.reload();
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.wave}>~</span>
          <span className={styles.name}>wavefinder</span>
        </div>
        <nav className={styles.nav}>
          {(["recs", "ingest", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${styles.navBtn} ${tab === t ? styles.active : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "recs" ? "for you" : t === "ingest" ? "import" : "history"}
            </button>
          ))}
        </nav>
        <button className={styles.logout} onClick={logout}>sign out</button>
      </header>

      <main className={styles.main}>
        {status && (
          <div className={`${styles.status} ${status.startsWith("✗") ? styles.error : ""}`}>
            {status}
          </div>
        )}

        {tab === "recs" && (
          <section>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>recommended for you</h2>
              <button className={styles.refreshBtn} onClick={loadRecs} disabled={loading}>
                {loading ? "loading…" : "refresh"}
              </button>
            </div>
            {recs.length === 0 && !loading && !status && (
              <p className={styles.empty}>
                import your music first, then record a few plays to train your taste vector.
              </p>
            )}
            <div className={styles.grid}>
              {recs.map((r) => (
                <SongCard
                  key={r.song.id}
                  song={r.song}
                  score={r.score}
                  reason={r.reason}
                  onPlay={() => recordPlay(r.song.spotifyId, false)}
                  onSkip={() => recordPlay(r.song.spotifyId, true)}
                />
              ))}
            </div>
          </section>
        )}

        {tab === "ingest" && (
          <section>
            <h2 className={styles.sectionTitle}>import your music</h2>
            <p className={styles.subtitle}>
              pull tracks into the recommender so it can learn your taste.
            </p>
            <div className={styles.ingestGrid}>
              <div className={styles.ingestCard}>
                <div className={styles.ingestLabel}>recently played</div>
                <p className={styles.ingestDesc}>your last 50 Spotify plays</p>
                <button
                  className={styles.ingestBtn}
                  onClick={() => ingest(api.ingestRecentlyPlayed)}
                  disabled={loading}
                >
                  import
                </button>
              </div>
              <div className={styles.ingestCard}>
                <div className={styles.ingestLabel}>top tracks</div>
                <p className={styles.ingestDesc}>your all-time favourites</p>
                <button
                  className={styles.ingestBtn}
                  onClick={() => ingest(() => api.ingestTopTracks("medium_term"))}
                  disabled={loading}
                >
                  import
                </button>
              </div>
              <div className={styles.ingestCard}>
                <div className={styles.ingestLabel}>search</div>
                <p className={styles.ingestDesc}>find tracks by genre, artist, or mood</p>
                <div className={styles.searchRow}>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. indie folk 2023"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && searchQuery.trim()) {
                        ingest(() => api.ingestSearch(searchQuery.trim()));
                      }
                    }}
                  />
                  <button
                    className={styles.ingestBtn}
                    onClick={() => ingest(() => api.ingestSearch(searchQuery.trim()))}
                    disabled={loading || !searchQuery.trim()}
                  >
                    search
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "history" && (
          <section>
            <h2 className={styles.sectionTitle}>play history</h2>
            <p className={styles.subtitle}>
              these plays shape your taste vector and drive recommendations.
            </p>
            {history.length === 0 ? (
              <p className={styles.empty}>no plays recorded yet.</p>
            ) : (
              <div className={styles.historyList}>
                {[...history].reverse().map((h, i) => (
                  <div key={i} className={`${styles.historyRow} ${h.skipped ? styles.skipped : ""}`}>
                    <div className={styles.historyTrack}>
                      <span className={styles.historyTitle}>{h.title}</span>
                      <span className={styles.historyArtist}>{h.artist}</span>
                    </div>
                    <div className={styles.historyMeta}>
                      <span className={styles.historyTag}>{h.skipped ? "skipped" : "played"}</span>
                      <span className={styles.historyTime}>
                        {new Date(h.playedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
