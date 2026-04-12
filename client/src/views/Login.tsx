import styles from "./Login.module.css";

export default function Login() {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.wave}>~</span>
          <span className={styles.name}>wavefinder</span>
        </div>
        <p className={styles.tagline}>
          music that moves with you
        </p>
        <a href="/api/v1/auth/login" className={styles.btn}>
          connect spotify
        </a>
        <p className={styles.note}>
          we'll never post or modify anything without your action
        </p>
      </div>
    </div>
  );
}
