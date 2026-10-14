import { siteNavigation } from "./site-navigation.js";
import type { PublicSite, SiteLocale, SitePage } from "@confsys/contracts";
const labels = {
  "zh-Hant": {
    committee: "大會委員",
    dates: "重要日期",
    news: "最新消息",
    speakers: "講者",
    travel: "交通住宿",
    sponsors: "贊助單位",
    faq: "常見問題",
    home: "首頁",
    about: "關於會議",
    participation: "參與說明",
    contact: "交通與聯絡",
    login: "登入",
    register: "建立帳號",
    pending: "網站準備中",
    venue: "場地待公告",
    organizers: "主辦單位",
    hosts: "承辦單位",
  },
  en: {
    committee: "Committee",
    dates: "Important dates",
    news: "News",
    speakers: "Speakers",
    travel: "Travel",
    sponsors: "Sponsors",
    faq: "FAQ",
    home: "Home",
    about: "About",
    participation: "Participation",
    contact: "Travel & contact",
    login: "Sign in",
    register: "Create account",
    pending: "Website in preparation",
    venue: "Venue to be announced",
    organizers: "Organizers",
    hosts: "Hosts",
  },
};
export function PublicSiteContent({
  site,
  locale,
  page,
  preview = false,
}: {
  site: PublicSite;
  locale: SiteLocale;
  page: SitePage;
  preview?: boolean;
}) {
  const d = site.document,
    l = labels[locale],
    t = d?.translations[locale],
    fallback = d?.translations[d.defaultLocale];
  const value = (
    key:
      | "subtitle"
      | "summary"
      | "venue"
      | "address"
      | "organizers"
      | "hosts"
      | "contactNote",
  ) => {
    const own = t?.[key];
    return {
      text: own || fallback?.[key] || "",
      lang: own ? locale : (d?.defaultLocale ?? locale),
    };
  };
  const paragraph = (key: Parameters<typeof value>[0]) => {
    const v = value(key);
    return v.text ? (
      <p className="site-copy" lang={v.lang}>
        {v.text}
      </p>
    ) : null;
  };
  const p = t?.pages[page],
    fp = fallback?.pages[page];
  const body = p?.body || fp?.body;
  const bullets = p?.bullets.length ? p.bullets : fp?.bullets;
  const links = p?.links.length ? p.links : fp?.links;
  const href = (next: SitePage, lang = locale) =>
    preview ? `#preview-${lang}-${next}` : `/${lang}/${next}`;
  const mediaUrl = (id: string) =>
    preview ? `/api/files/${id}/download` : `/api/media/${id}`;
  return (
    <div className="layout public-site">
      <a className="skip-link" href="#site-main">
        {locale === "en" ? "Skip to content" : "跳至主要內容"}
      </a>
      <header>
        <a className="brand" href={href("home")}>
          {d?.media?.logoId && (
            <img
              src={mediaUrl(d.media.logoId)}
              alt=""
              width="64"
              height="64"
              className="site-logo"
            />
          )}
          {t?.name || site.conferenceName}
        </a>
        <nav aria-label="帳號 / Account">
          <a href="/auth/login">{l.login}</a>
          <a href="/auth/register">{l.register}</a>
        </nav>
      </header>
      {d && (
        <nav className="site-nav" aria-label="官網 / Website">
          {siteNavigation(d, locale).map((key) => (
            <a
              key={key}
              href={href(key)}
              aria-current={key === page ? "page" : undefined}
            >
              {l[key]}
            </a>
          ))}
          <span className="site-languages">
            {d.enabledLocales
              .filter((lang) => siteNavigation(d, lang).includes(page))
              .map((lang) => (
                <a
                  key={lang}
                  href={href(page, lang)}
                  hrefLang={lang}
                  lang={lang}
                >
                  {lang === "en" ? "English" : "繁體中文"}
                </a>
              ))}
          </span>
        </nav>
      )}
      <main id="site-main">
        {page === "home" && d?.media?.heroId && (
          <img src={mediaUrl(d.media.heroId)} alt="" className="site-hero" />
        )}
        <section className="intro">
          <p className="eyebrow">{l[page]}</p>
          <h1>
            {page === "home"
              ? t?.name || site.conferenceName
              : p?.title || l[page]}
          </h1>
          {paragraph("subtitle")}
          {!d ? (
            <p>{l.pending}</p>
          ) : (
            <>
              <p>
                <time dateTime={d.startDate}>{d.startDate}</time> —{" "}
                <time dateTime={d.endDate}>{d.endDate}</time> · {d.timezone}
              </p>
              <p lang={value("venue").lang}>{value("venue").text || l.venue}</p>
              {paragraph("summary")}
            </>
          )}
        </section>
        {d && (
          <section className="site-section" aria-label={l[page]}>
            {body && (
              <p
                className="site-copy"
                lang={p?.body ? locale : d.defaultLocale}
              >
                {body}
              </p>
            )}
            {!!bullets?.length && (
              <ul lang={p?.bullets.length ? locale : d.defaultLocale}>
                {bullets.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            {!!links?.length && (
              <ul lang={p?.links.length ? locale : d.defaultLocale}>
                {links.map((link, i) => (
                  <li key={i}>
                    <a href={link.url}>{link.label}</a>
                  </li>
                ))}
              </ul>
            )}
            {page === "about" && (
              <>
                {value("organizers").text && <h2>{l.organizers}</h2>}
                {paragraph("organizers")}
                {value("hosts").text && <h2>{l.hosts}</h2>}
                {paragraph("hosts")}
              </>
            )}
            {page === "contact" && (
              <>
                {paragraph("address")}
                {paragraph("contactNote")}
                {d.phone && <p>{d.phone}</p>}
              </>
            )}
          </section>
        )}
      </main>
      <footer>
        {d?.contactEmail && (
          <p>
            <a href={`mailto:${d.contactEmail}`}>{d.contactEmail}</a>
          </p>
        )}
        <p>{t?.name || site.conferenceName}</p>
      </footer>
    </div>
  );
}
