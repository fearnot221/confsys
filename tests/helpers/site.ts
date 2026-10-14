import { initialSite, siteLocales, sitePages } from "@confsys/contracts";
export function completeSite(name = "Synthetic published conference") {
  const d = initialSite(name);
  d.startDate = "2027-02-28";
  d.endDate = "2027-03-01";
  d.contactEmail = "conference@example.invalid";
  d.enabledLocales = [...siteLocales];
  for (const locale of siteLocales) {
    d.translations[locale].name = locale === "en" ? `${name} EN` : name;
    for (const page of sitePages) {
      d.translations[locale].pages[page].title = `${name} ${page}`;
      d.translations[locale].pages[page].description = `Description ${page}`;
    }
  }
  d.translations["zh-Hant"].pages.home.body = "公開導言";
  return d;
}
