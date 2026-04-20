import styles from "./Login.module.css";

export default function Login() {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.wave}>~</span>
          <span className={styles.name}>Groovy</span>
        </div>
        <p className={styles.tagline}>
          Spotify Recommendations
        </p>
        <a href="/api/v1/auth/login" className={styles.btn}>
          connect spotify
        </a>
      </div>
    </div>
  );
}
