import { useState } from "react";
import { supabase, supabaseError } from "./lib/supabaseClient";

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
        setMessage("Login successful");
        if (onLogin) onLogin(data.user);
      }
    } catch (err) {
      setMessage("Connection error: " + (err?.message || "Unknown error"));
    }

    setLoading(false);
  };

  return (
    <div style={pageWrap}>
      <div style={leftPanel}>
        <div>
          <h1 style={brandTitle}>FalconMed</h1>
          <p style={brandSub}>Pharmacy Intelligence Platform</p>
        </div>

        <div style={infoCard}>
          <h3 style={infoTitle}>Stable Version</h3>
          <p style={infoText}>
            Secure login connected to Supabase with dashboard access and module
            navigation.
          </p>
        </div>
      </div>

      <div style={rightPanel}>
        <div style={loginCard}>
          <h2 style={loginTitle}>Sign in</h2>
          <p style={loginSub}>Access your FalconMed dashboard</p>

          <form onSubmit={handleLogin}>
            <label style={label}>Email</label>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={input}
            />

            <label style={label}>Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={input}
            />

            <button type="submit" disabled={loading} style={button}>
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>

          {message && (
            <div style={messageBox}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const pageWrap = {
  minHeight: "100vh",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  background: "#f3f6fb",
  fontFamily: "Arial, sans-serif",
};

const leftPanel = {
  background: "linear-gradient(135deg, #0f172a, #1e3a8a)",
  color: "white",
  padding: "60px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const rightPanel = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "40px",
};

const brandTitle = {
  margin: 0,
  fontSize: "54px",
  fontWeight: "bold",
};

const brandSub = {
  marginTop: "12px",
  fontSize: "18px",
  color: "#dbeafe",
};

const infoCard = {
  background: "rgba(255,255,255,0.10)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "18px",
  padding: "24px",
  maxWidth: "420px",
};

const infoTitle = {
  marginTop: 0,
  marginBottom: "10px",
  fontSize: "22px",
};

const infoText = {
  margin: 0,
  lineHeight: 1.7,
  color: "#e2e8f0",
};

const loginCard = {
  width: "100%",
  maxWidth: "460px",
  background: "white",
  borderRadius: "20px",
  padding: "36px",
  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.10)",
};

const loginTitle = {
  margin: 0,
  fontSize: "34px",
  color: "#0f172a",
};

const loginSub = {
  marginTop: "10px",
  marginBottom: "28px",
  color: "#64748b",
  fontSize: "16px",
};

const label = {
  display: "block",
  marginBottom: "8px",
  marginTop: "14px",
  color: "#334155",
  fontSize: "14px",
  fontWeight: "bold",
};

const input = {
  width: "100%",
  padding: "14px 16px",
  fontSize: "16px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  outline: "none",
  boxSizing: "border-box",
};

const button = {
  width: "100%",
  marginTop: "22px",
  padding: "14px 16px",
  fontSize: "18px",
  borderRadius: "12px",
  border: "none",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: "bold",
};

const messageBox = {
  marginTop: "18px",
  padding: "14px 16px",
  borderRadius: "12px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#334155",
  textAlign: "center",
};