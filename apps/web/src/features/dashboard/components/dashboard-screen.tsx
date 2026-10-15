export type DashboardSection = {
  title: string;
  href: string;
  rows: { id: string; text: string }[];
  more: boolean;
};
export type DashboardView = {
  loading: boolean;
  expired: boolean;
  error: string;
  email: string;
  sections: DashboardSection[];
  links: { title: string; href: string }[];
  deadlines: { title: string; at: string }[];
  onRetry: () => void;
};
export function DashboardScreen(p: DashboardView) {
  return (
    <main className="layout dashboard">
      <header className="dash-head">
        <p className="eyebrow">Workspace · 工作台</p>
        <h1>我的研討會工作台</h1>
        <p className="dash-meta">
          {p.email && <span className="dash-email">{p.email}</span>}
          <a href="/">官網</a>
          <a href="/auth/account">帳號與安全</a>
          <a href="/program">公開議程</a>
        </p>
        <div className="dash-actions">
          {p.expired ? (
            <a className="button-link" href="/auth/login">
              重新登入
            </a>
          ) : (
            <button onClick={p.onRetry} aria-busy={p.loading}>
              重新整理工作台
            </button>
          )}
        </div>
      </header>
      {p.loading && <p role="status">正在讀取本地帳號資料…</p>}
      {p.error && <p role="alert">{p.error}</p>}
      {!p.expired && (
        <>
          {!!p.links.length && (
            <nav className="dash-tiles" aria-label="可用工作入口">
              <ul>
                {p.links.map((link, index) => (
                  <li key={link.href}>
                    <a href={link.href}>
                      <span className="dash-tiles__index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="dash-tiles__title">{link.title}</span>
                      <span className="dash-tiles__arrow" aria-hidden="true">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {!!p.deadlines.length && (
            <section className="dash-deadlines">
              <h2>相關截止時間</h2>
              <ol>
                {p.deadlines.map((deadline, index) => (
                  <li key={`${deadline.title}-${index}`}>
                    <time dateTime={deadline.at}>{deadline.at}</time>
                    <span>{deadline.title}</span>
                  </li>
                ))}
              </ol>
              <p>時間含時區；是否仍可操作由伺服器依最新設定判定。</p>
            </section>
          )}
          {!!p.sections.length && (
            <div className="dash-grid">
              {p.sections.map((section) => (
                <section key={section.title}>
                  <h2>{section.title}</h2>
                  {section.rows.length ? (
                    <ul>
                      {section.rows.map((row) => (
                        <li key={row.id}>{row.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dash-empty">目前沒有紀錄。</p>
                  )}
                  <a className="dash-more" href={section.href}>
                    {section.more
                      ? "還有更多紀錄，開啟完整清單"
                      : "開啟完整工作區"}
                  </a>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
