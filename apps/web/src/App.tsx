import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./lib/api";
import { AlbumsPage } from "./pages/AlbumsPage";
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

  async function onLogout() {
    await api.logout();
    setUser(null);
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/photos" replace />
          ) : (
            <LoginPage onLogin={setUser} />
          )
        }
      />
      <Route
        path="/"
        element={<Navigate to={user ? "/photos" : "/login"} replace />}
      />
      <Route
        path="/photos"
        element={
          user ? (
            <TimelinePage user={user} view="photos" onLogout={onLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/albums"
        element={
          user ? (
            <AlbumsPage user={user} onLogout={onLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/trash"
        element={
          user ? (
            <TimelinePage user={user} view="trash" onLogout={onLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="*"
        element={<Navigate to={user ? "/photos" : "/login"} replace />}
      />
    </Routes>
  );
}
