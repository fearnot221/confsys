import { useInstance } from "../features/instance/hooks/use-instance.js";
import { useAuth } from "../features/auth/hooks/use-auth.js";
import { AuthScreen } from "../features/auth/components/auth-screen.js";
import React, { Component, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHealth } from "../features/health/hooks/use-health.js";
import { HealthScreen } from "../features/health/components/health-screen.js";
import "../design/styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="layout">
        <h1>畫面發生錯誤 / Something went wrong</h1>
        <p>請重新載入頁面。 / Please reload the page.</p>
        <button onClick={() => window.location.reload()}>
          重新載入 / Reload
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const state = useHealth();
  const instance = useInstance();
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.title =
      locale === "zh"
        ? `${instance.data?.conferenceName ?? "研討會"} · 系統狀態`
        : `${instance.data?.conferenceName ?? "Conference"} · System status`;
  }, [locale, instance.data]);
  return (
    <HealthScreen
      {...state}
      conferenceName={instance.data?.conferenceName ?? "研討會"}
      onRefresh={state.refresh}
      locale={locale}
      onLocaleChange={() => setLocale(locale === "zh" ? "en" : "zh")}
    />
  );
}
function AuthApp() {
  const mode = window.location.pathname.split("/")[2] ?? "login";
  const state = useAuth(mode);
  const instance = useInstance();
  useEffect(() => {
    document.documentElement.lang = "zh-Hant";
    document.title = instance.data
      ? `${instance.data.conferenceName} · 帳號與安全`
      : "載入研討會";
  }, [instance.data]);
  if (!instance.data)
    return (
      <main className="layout">
        <p role={instance.error ? "alert" : "status"}>
          {instance.error ? "無法取得研討會設定。" : "載入研討會…"}
        </p>
        {instance.error && (
          <button onClick={() => void instance.refetch()}>重試</button>
        )}
      </main>
    );
  return (
    <AuthScreen {...state} conferenceName={instance.data.conferenceName} />
  );
}
const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {window.location.pathname.startsWith("/auth/") ? <AuthApp /> : <App />}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
