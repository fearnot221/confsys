import { Button, Layout, Status } from "@confsys/ui";
export type HealthView = {
  conferenceName: string;
  phase: "loading" | "error" | "ready" | "degraded";
  dependencies:
    | { postgres: "up" | "down"; redis: "up" | "down"; worker: "up" | "down" }
    | undefined;
  busy: boolean;
  onRefresh: () => void;
  locale: "zh" | "en";
  onLocaleChange: () => void;
};
const copy = {
  zh: {
    brand: "研討會平台",
    label: "工程底座 · PHASE 0",
    title: "系統服務狀態",
    intro: "本研討會使用獨立部署；帳號與資料僅屬於本場會議。",
    loading: "正在檢查服務…",
    error: "無法取得服務狀態，請確認 API 已啟動後重試。",
    ready: "所有基礎服務已就緒",
    degraded: "部分服務尚未就緒",
    refresh: "重新檢查",
    busy: "檢查中…",
    up: "已連線",
    down: "未就緒",
    pending: "等待檢查",
    scope: "目前可使用",
    scopeText:
      "即時檢查 API、PostgreSQL、Redis 與背景 worker 的連線狀態。每 15 秒更新，也可手動重試。",
    next: "下一階段 · 等待確認",
    nextText:
      "帳號生命週期可由登入入口使用。本研討會權限、內容、報名、付款與投稿仍待後續階段。",
    db: "權威資料儲存",
    redis: "背景佇列與開發快取",
    worker: "獨立背景處理程序",
    footer: "開發環境使用合成資料；不寄真信、不觸發真實金流。",
  },
  en: {
    brand: "Conference Platform",
    label: "FOUNDATION · PHASE 0",
    title: "System status",
    intro: "This conference runs independently with its own accounts and data.",
    loading: "Checking services…",
    error: "Unable to load status. Check that the API is running and retry.",
    ready: "All infrastructure services are ready",
    degraded: "Some services are not ready",
    refresh: "Check again",
    busy: "Checking…",
    up: "Connected",
    down: "Not ready",
    pending: "Pending",
    scope: "Available now",
    scopeText:
      "Live connectivity checks for the API, PostgreSQL, Redis, and background worker. Refreshes every 15 seconds, with manual retry.",
    next: "Next phase · Awaiting approval",
    nextText:
      "Account lifecycle is available from the sign-in link. Conference permissions, content, payments, and submissions await later phases.",
    db: "Authoritative data storage",
    redis: "Job queue and development cache",
    worker: "Independent background process",
    footer: "Development uses synthetic data. No real mail or payment effects.",
  },
};
export function HealthScreen(props: HealthView) {
  const t = copy[props.locale];
  return (
    <Layout className="status-page">
      <header>
        <a href="#main-content" className="brand">
          {props.conferenceName}
        </a>
        <a className="status-page__signin" href="/auth/login">
          {props.locale === "zh" ? "登入" : "Sign in"}
        </a>
        <Button
          onClick={props.onLocaleChange}
          aria-label={
            props.locale === "zh" ? "Switch to English" : "切換繁體中文"
          }
        >
          {props.locale === "zh" ? "English" : "繁體中文"}
        </Button>
      </header>
      <section className="intro">
        <p className="eyebrow">{t.label}</p>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </section>
      <section className="health" aria-label={t.title} aria-busy={props.busy}>
        <div className="health-heading">
          <p role="status" aria-live="polite">
            {t[props.phase]}
          </p>
          <Button onClick={props.onRefresh} disabled={props.busy}>
            {props.busy ? t.busy : t.refresh}
          </Button>
        </div>
        <dl>
          {(["postgres", "redis", "worker"] as const).map((key) => (
            <div className="service" key={key}>
              <dt>
                {key === "postgres"
                  ? "PostgreSQL"
                  : key === "redis"
                    ? "Redis"
                    : "Worker"}
                <small>
                  {key === "postgres"
                    ? t.db
                    : key === "redis"
                      ? t.redis
                      : t.worker}
                </small>
              </dt>
              <dd>
                <Status
                  healthy={
                    props.phase !== "error" &&
                    props.dependencies?.[key] === "up"
                  }
                  label={
                    props.phase === "error"
                      ? t.down
                      : props.dependencies
                        ? props.dependencies[key] === "up"
                          ? t.up
                          : t.down
                        : t.pending
                  }
                />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="scope">
        <article>
          <h2>{t.scope}</h2>
          <p>{t.scopeText}</p>
        </article>
        <article>
          <h2>{t.next}</h2>
          <p>{t.nextText}</p>
        </article>
      </section>
      <footer>{t.footer}</footer>
    </Layout>
  );
}
