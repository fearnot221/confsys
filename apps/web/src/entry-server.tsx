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
  const title=p?.title||site.conferenceName;
  const description=p?.description||"網站準備中 / Website in preparation";
  const canonical=`${origin}/${locale}/${page}`;
  const imageId=d?.media?.heroId??d?.media?.logoId;
  const imageUrl=imageId?`${origin}/api/media/${imageId}`:null;
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang={locale}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title}</title>
          <meta
            name="description"
            content={description}
          />
          <link rel="canonical" href={canonical} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={title} />
          <meta property="og:description" content={description} />
          <meta property="og:url" content={canonical} />
          <meta property="og:site_name" content={site.conferenceName} />
          <meta property="og:locale" content={locale==='en'?'en_US':'zh_TW'} />
          <meta name="twitter:card" content={d?.media?.heroId?'summary_large_image':'summary'} />
          <meta name="twitter:title" content={title} />
          <meta name="twitter:description" content={description} />
          {imageUrl&&<><meta property="og:image" content={imageUrl}/><meta name="twitter:image" content={imageUrl}/></>}
          {!d&&<meta name="robots" content="noindex, nofollow"/>}
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
