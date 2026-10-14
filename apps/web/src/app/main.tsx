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
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.title =
      locale === "zh"
        ? "研討會平台 · 系統狀態"
        : "Conference Platform · System status";
  }, [locale]);
  return (
    <HealthScreen
      {...state}
      onRefresh={state.refresh}
      locale={locale}
      onLocaleChange={() => setLocale(locale === "zh" ? "en" : "zh")}
    />
  );
}
const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
