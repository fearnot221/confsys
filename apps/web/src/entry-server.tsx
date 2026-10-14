import { siteNavigation } from "./features/site/components/site-navigation.js";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicSite, SiteLocale, SitePage } from "@confsys/contracts";
import { PublicSiteContent } from "./features/site/components/public-site.js";
import "./design/styles.css";
export function renderSite(
  site: PublicSite,
  locale: SiteLocale,
  page: SitePage,
  origin: string,
) {
  const d = site.document,
    p =
      d?.translations[locale].pages[page] ??
      d?.translations[d.defaultLocale].pages[page];
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang={locale}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{p?.title || site.conferenceName}</title>
          <meta
            name="description"
            content={p?.description || "網站準備中 / Website in preparation"}
          />
          <link rel="canonical" href={`${origin}/${locale}/${page}`} />
          {d?.enabledLocales
            .filter((lang) => siteNavigation(d, lang).includes(page))
            .map((lang) => (
              <link
                key={lang}
                rel="alternate"
                hrefLang={lang}
                href={`${origin}/${lang}/${page}`}
              />
            ))}
          <link rel="stylesheet" href="/public-site.css" />
        </head>
        <body>
          <PublicSiteContent site={site} locale={locale} page={page} />
        </body>
      </html>,
    )
  );
}
