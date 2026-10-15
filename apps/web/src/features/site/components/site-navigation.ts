import type {SiteDocument,SiteLocale,SitePage} from "@confsys/contracts";
// Navigation is a presentation of the validated document, with the same language
// fallback as its text. API routes independently enforce published availability.
export function siteNavigation(document: SiteDocument,locale:SiteLocale):SitePage[]{
 return Object.keys({...document.translations[document.defaultLocale].pages,...document.translations[locale].pages}) as SitePage[];
}
