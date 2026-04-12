import { useState, useEffect } from "react";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";

export default function App() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Pick up token from URL after Spotify OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("token", urlToken);
      window.history.replaceState({}, "", "/");
      setToken(urlToken);
      return;
    }
    setToken(localStorage.getItem("token"));
  }, []);

  if (!token) return <Login />;
  return <Dashboard />;
}
