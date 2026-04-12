import { Song } from "../api";
import styles from "./SongCard.module.css";

interface Props {
  song: Song;
  score?: number;
  reason?: string;
  onPlay?: () => void;
  onSkip?: () => void;
}

export default function SongCard({ song, score, reason, onPlay, onSkip }: Props) {
  const pct = score != null ? Math.round(score * 100) : null;

  return (
    <div className={styles.card}>
      {song.imageUrl ? (
        <img src={song.imageUrl} alt={song.album} className={styles.art} />
      ) : (
        <div className={styles.artFallback}>
          <span>~</span>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.title}>{song.title}</div>
        <div className={styles.artist}>{song.artist}</div>
        {reason && <div className={styles.reason}>{reason}</div>}
        <div className={styles.footer}>
          {pct != null && (
            <div className={styles.score}>
              <div className={styles.scoreBar} style={{ width: `${pct}%` }} />
              <span className={styles.scorePct}>{pct}%</span>
            </div>
          )}
          <div className={styles.actions}>
            {onPlay && (
              <button className={styles.playBtn} onClick={onPlay} title="Mark as played">
                ▶
              </button>
            )}
            {onSkip && (
              <button className={styles.skipBtn} onClick={onSkip} title="Skip">
                ✕
              </button>
            )}
            <a
              href={`https://open.spotify.com/track/${song.spotifyId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.spotifyLink}
              title="Open in Spotify"
            >
              ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
