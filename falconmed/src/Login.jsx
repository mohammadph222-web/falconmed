import { useState } from "react";
import { supabase, supabaseError, envDebug } from "./lib/supabaseClient";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@falconmed.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (supabaseError) {
      setMessage("Supabase init error: " + supabaseError);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
      } else {
        setMessage("Login Success: " + data.user.email);
        if (onLogin) onLogin(data.user);
      }
    } catch (err) {
      setMessage("Connection error: " + (err?.message || "Unknown error"));
    }

    setLoading(false);
  };

  return (
    <div style={{ maxWidth: "520px", margin: "60px auto", padding: "20px" }}>
      <h2 style={{ textAlign: "center" }}>FalconMed Login</h2>

      <div
        style={{
          background: "#f5f5f5",
          padding: "12px",
          marginBottom: "16px",
          border: "1px solid #ddd",
          fontSize: "14px",
        }}
      >
        <div><strong>Supabase URL:</strong> {envDebug.url || "MISSING"}</div>
        <div><strong>Anon Key Found:</strong> {envDebug.hasKey ? "YES" : "NO"}</div>
        <div><strong>Init Error:</strong> {supabaseError || "NONE"}</div>
      </div>

      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "12px",
            fontSize: "16px",
          }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "12px",
            fontSize: "16px",
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "18px",
            cursor: "pointer",
          }}
        >
          {loading ? "Loading..." : "Login"}
        </button>
      </form>

      {message && (
        <p style={{ textAlign: "center", marginTop: "16px", color: "#444" }}>
          {message}
        </p>
      )}
    </div>
  );
}