import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Login from "./Login";

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const getSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!error) {
        setUser(data.session?.user ?? null);
      }
      setCheckingSession(false);
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (checkingSession) {
    return <p style={{ textAlign: "center", marginTop: "50px" }}>Loading...</p>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div style={{ padding: "30px" }}>
      <h1>Welcome to FalconMed</h1>
      <p>Logged in as: {user.email}</p>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}