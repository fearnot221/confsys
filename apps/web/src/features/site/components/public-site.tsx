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
    when: "會期",
    where: "地點",
    timezone: "時區",
    reachUs: "聯絡大會",
    skip: "跳至主要內容",
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
    when: "Dates",
    where: "Venue",
    timezone: "Time zone",
    reachUs: "Get in touch",
    skip: "Skip to content",
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
  const name = t?.name || site.conferenceName;
  const pages = d ? siteNavigation(d, locale) : [];
  const venue = value("venue");
  return (
    <div className="public-site" data-page={page}>
      <a className="skip-link" href="#site-main">
        {l.skip}
      </a>
      <header className="site-header">
        <div className="site-container site-header__inner">
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
            {name}
          </a>
          <nav className="site-account" aria-label="帳號 / Account">
            <a href="/auth/login">{l.login}</a>
            <a className="site-account__primary" href="/auth/register">
              {l.register}
            </a>
          </nav>
        </div>
      </header>
      {d && (
        <nav className="site-nav" aria-label="官網 / Website">
          <div className="site-container site-nav__inner">
            <div className="site-nav__pages">
              {pages.map((key, index) => (
                <a
                  key={key}
                  href={href(key)}
                  aria-current={key === page ? "page" : undefined}
                >
                  <span className="site-nav__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {l[key]}
                </a>
              ))}
            </div>
            <span className="site-languages">
              {d.enabledLocales
                .filter((lang) => siteNavigation(d, lang).includes(page))
                .map((lang) => (
                  <a
                    key={lang}
                    href={href(page, lang)}
                    hrefLang={lang}
                    lang={lang}
                    aria-current={lang === locale ? "true" : undefined}
                  >
                    {lang === "en" ? "English" : "繁體中文"}
                  </a>
                ))}
            </span>
          </div>
        </nav>
      )}
      <main id="site-main">
        <section
          className={
            page === "home"
              ? "intro site-hero site-hero--home"
              : "intro site-hero"
          }
        >
          <div className="site-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="site-container site-hero__inner">
            <p className="eyebrow">{l[page]}</p>
            <h1>{page === "home" ? name : p?.title || l[page]}</h1>
            {paragraph("subtitle")}
            {!d ? (
              <p className="site-pending">{l.pending}</p>
            ) : (
              <>
                <dl className="site-facts">
                  <div>
                    <dt>{l.when}</dt>
                    <dd>
                      <time dateTime={d.startDate}>{d.startDate}</time> —{" "}
                      <time dateTime={d.endDate}>{d.endDate}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>{l.timezone}</dt>
                    <dd>{d.timezone}</dd>
                  </div>
                  <div>
                    <dt>{l.where}</dt>
                    <dd lang={venue.lang}>{venue.text || l.venue}</dd>
                  </div>
                </dl>
                {paragraph("summary")}
              </>
            )}
          </div>
        </section>
        {page === "home" && d?.media?.heroId && (
          <div className="site-container">
            <img
              src={mediaUrl(d.media.heroId)}
              alt=""
              className="site-hero-image"
            />
          </div>
        )}
        {d && (
          <section className="site-section" aria-label={l[page]}>
            <div className="site-container site-section__grid">
              <p className="site-section__label" aria-hidden="true">
                <span>
                  {String(Math.max(pages.indexOf(page), 0) + 1).padStart(
                    2,
                    "0",
                  )}
                </span>
                {l[page]}
              </p>
              <div className="site-section__body">
                {body && (
                  <p
                    className="site-copy site-lede"
                    lang={p?.body ? locale : d.defaultLocale}
                  >
                    {body}
                  </p>
                )}
                {!!bullets?.length && (
                  <ul
                    className="site-bullets"
                    lang={p?.bullets.length ? locale : d.defaultLocale}
                  >
                    {bullets.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
                {!!links?.length && (
                  <ul
                    className="site-links"
                    lang={p?.links.length ? locale : d.defaultLocale}
                  >
                    {links.map((link, i) => (
                      <li key={i}>
                        <a href={link.url}>
                          {link.label}
                          <span
                            className="site-links__arrow"
                            aria-hidden="true"
                          >
                            →
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {page === "about" && (
                  <div className="site-credits">
                    {value("organizers").text && <h2>{l.organizers}</h2>}
                    {paragraph("organizers")}
                    {value("hosts").text && <h2>{l.hosts}</h2>}
                    {paragraph("hosts")}
                  </div>
                )}
                {page === "contact" && (
                  <div className="site-contact">
                    {paragraph("address")}
                    {paragraph("contactNote")}
                    {d.phone && <p>{d.phone}</p>}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div className="site-container">
          {d?.contactEmail && (
            <p className="site-footer__cta">
              <span className="eyebrow">{l.reachUs}</span>
              <a href={`mailto:${d.contactEmail}`}>{d.contactEmail}</a>
            </p>
          )}
          <p className="site-footer__name">{name}</p>
        </div>
      </footer>
    </div>
  );
}
