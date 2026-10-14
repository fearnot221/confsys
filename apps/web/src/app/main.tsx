import {useSubmissions} from "../features/submissions/hooks/use-submissions.js";
import {SubmissionsScreen} from "../features/submissions/components/submissions-screen.js";
import { useFiles } from "../features/files/hooks/use-files.js";
import { FilesScreen } from "../features/files/components/files-screen.js";
import { useRegistration } from "../features/registration/hooks/use-registration.js";
import { RegistrationScreen } from "../features/registration/components/registration-screen.js";
import { useInvitations } from "../features/invitations/hooks/use-invitations.js";
import { useInvitationAcceptance } from "../features/invitations/hooks/use-invitation-acceptance.js";
import { InvitationsScreen } from "../features/invitations/components/invitations-screen.js";
import { InvitationAcceptanceScreen } from "../features/invitations/components/invitation-acceptance-screen.js";
import { useSite } from "../features/site/hooks/use-site.js";
import { SiteScreen } from "../features/site/components/site-screen.js";
import { useAccess } from "../features/access/hooks/use-access.js";
import { AccessScreen } from "../features/access/components/access-screen.js";
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
function AccessApp() {
  const state = useAccess();
  const instance = useInstance();
  useEffect(() => {
    document.documentElement.lang = "zh-Hant";
    document.title = `${instance.data?.conferenceName ?? "研討會"} · 帳號管理`;
  }, [instance.data]);
  if (!instance.data)
    return (
      <main>
        <p role={instance.error ? "alert" : "status"}>
          {instance.error ? "無法取得研討會設定。" : "載入研討會…"}
        </p>
        <button onClick={() => void instance.refetch()}>重試</button>
      </main>
    );
  return (
    <AccessScreen {...state} conferenceName={instance.data.conferenceName} />
  );
}
function SiteApp() {
  const state = useSite();
  return <SiteScreen {...state} />;
}
function SubmissionsApp({admin=false}:{admin?:boolean}) {return <SubmissionsScreen {...useSubmissions(admin)}/>;}
function FilesApp() {return <FilesScreen {...useFiles()}/>;}
function RegistrationApp({admin=false}:{admin?:boolean}) { return <RegistrationScreen {...useRegistration(admin)} />; }
function InvitationsApp() { return <InvitationsScreen {...useInvitations()} />; }
function InvitationAcceptApp() { return <InvitationAcceptanceScreen {...useInvitationAcceptance()} />; }
const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {window.location.pathname === "/submissions" ? <SubmissionsApp /> : window.location.pathname === "/admin/submissions" ? <SubmissionsApp admin /> : window.location.pathname === "/account/files" ? <FilesApp /> : window.location.pathname === "/registration" ? <RegistrationApp /> : window.location.pathname === "/admin/registration" ? <RegistrationApp admin /> : window.location.pathname === "/admin/invitations" ? <InvitationsApp /> : window.location.pathname === "/auth/invitation" ? <InvitationAcceptApp /> : window.location.pathname === "/admin/site" ? (
          <SiteApp />
        ) : window.location.pathname.startsWith("/access/") ? (
          <AccessApp />
        ) : window.location.pathname.startsWith("/auth/") ? (
          <AuthApp />
        ) : (
          <App />
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
