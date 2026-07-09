import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { TimelinePage } from "./pages/TimelinePage";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading archive…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage onLogin={setUser} />
          )
        }
      />
      <Route
        path="/"
        element={
          user ? (
            <TimelinePage
              user={user}
              onLogout={async () => {
                await api.logout();
                setUser(null);
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}
