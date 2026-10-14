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
    <main className="layout">
      <h1>我的研討會工作台</h1>
      <p>
        <a href="/">官網</a> · <a href="/auth/account">帳號與安全</a> ·{" "}
        <a href="/program">公開議程</a>
      </p>
      {p.email && <p>{p.email}</p>}
      {p.loading && <p role="status">正在讀取本地帳號資料…</p>}
      {p.error && <p role="alert">{p.error}</p>}
      {p.expired ? (
        <a href="/auth/login">重新登入</a>
      ) : (
        <button onClick={p.onRetry}>重新整理工作台</button>
      )}
      {!p.expired && (
        <>
          <nav aria-label="可用工作入口">
            <ul>
              {p.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          {!!p.deadlines.length && (
            <section>
              <h2>相關截止時間</h2>
              <ul>
                {p.deadlines.map((deadline, index) => (
                  <li key={`${deadline.title}-${index}`}>
                    {deadline.title}：
                    <time dateTime={deadline.at}>{deadline.at}</time>
                  </li>
                ))}
              </ul>
              <p>時間含時區；是否仍可操作由伺服器依最新設定判定。</p>
            </section>
          )}
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
                <p>目前沒有紀錄。</p>
              )}
              <a href={section.href}>
                {section.more ? "還有更多紀錄，開啟完整清單" : "開啟完整工作區"}
              </a>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
