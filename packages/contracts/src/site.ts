import { z } from "zod";
export const siteLocales = ["zh-Hant", "en"] as const;
export const sitePages = ["home", "about", "participation", "contact"] as const;
export type SiteLocale = (typeof siteLocales)[number];
export type SitePage = (typeof sitePages)[number];
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        !Array.from(v).some(
          (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
        ),
      "不支援的控制字元",
    );
const line = (max: number) =>
  text(max).refine((v) => !/[\r\n]/.test(v), "請輸入單行文字");
export const siteLinkSchema = z.strictObject({
  label: line(100),
  url: z.string().max(1000),
});
export function safeSiteLink(value: string) {
  if (/^\/(zh-Hant|en)\/(home|about|participation|contact)$/.test(value))
    return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/[\\\s]/.test(value)
    );
  } catch {
    return false;
  }
}
const page = z.strictObject({
  title: line(160),
  description: line(320),
  body: text(6000),
  bullets: z.array(line(300)).max(20),
  links: z.array(siteLinkSchema).max(10),
});
const translation = z.strictObject({
  name: line(160),
  subtitle: line(200),
  summary: text(2000),
  venue: line(200),
  address: line(400),
  organizers: text(1000),
  hosts: text(1000),
  contactNote: text(2000),
  pages: z.strictObject({
    home: page,
    about: page,
    participation: page,
    contact: page,
  }),
});
// Structural schemas remain JSON-schema representable; semantic validation is shared below.
export const siteDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  defaultLocale: z.enum(siteLocales),
  enabledLocales: z.array(z.enum(siteLocales)).min(1).max(2),
  startDate: z.string().max(10),
  endDate: z.string().max(10),
  timezone: line(100),
  contactEmail: line(254),
  phone: line(50),
  translations: z.strictObject({ "zh-Hant": translation, en: translation }),
});
export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export function siteIssues(d: SiteDocument, publishing: boolean): string[] {
  const errors: string[] = [];
  if (
    !d.enabledLocales.includes(d.defaultLocale) ||
    new Set(d.enabledLocales).size !== d.enabledLocales.length
  )
    errors.push("enabledLocales: 預設語系必須啟用且不能重複");
  try {
    new Intl.DateTimeFormat("en", { timeZone: d.timezone });
    if (!d.timezone.includes("/") && d.timezone !== "UTC") throw new Error();
  } catch {
    errors.push("timezone: 請填寫有效 IANA 時區");
  }
  for (const key of ["startDate", "endDate"] as const) {
    const v = d[key];
    if (
      (!v && publishing) ||
      (v &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          !Number.isFinite(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v))
    )
      errors.push(`${key}: 請填寫有效日期`);
  }
  if (d.startDate && d.endDate && d.startDate > d.endDate)
    errors.push("endDate: 結束日不得早於開始日");
  if (
    (!d.contactEmail && publishing) ||
    (d.contactEmail && !z.email().safeParse(d.contactEmail).success)
  )
    errors.push("contactEmail: 請填寫有效公開 Email");
  for (const locale of siteLocales) {
    const t = d.translations[locale];
    if (publishing && d.enabledLocales.includes(locale) && !t.name.trim())
      errors.push(`${locale}.name: 必填`);
    for (const key of sitePages) {
      const p = t.pages[key];
      if (
        publishing &&
        d.enabledLocales.includes(locale) &&
        (!p.title.trim() || !p.description.trim())
      )
        errors.push(`${locale}.${key}: title 與 description 必填`);
      for (const link of p.links)
        if (!link.label.trim() || !safeSiteLink(link.url))
          errors.push(
            `${locale}.${key}.links: 僅允許 HTTPS 或固定官網站內路徑`,
          );
    }
  }
  return errors;
}
export function initialSite(name: string): SiteDocument {
  const blankPage = () => ({
    title: "",
    description: "",
    body: "",
    bullets: [],
    links: [],
  });
  const blank = () => ({
    name: "",
    subtitle: "",
    summary: "",
    venue: "",
    address: "",
    organizers: "",
    hosts: "",
    contactNote: "",
    pages: {
      home: blankPage(),
      about: blankPage(),
      participation: blankPage(),
      contact: blankPage(),
    },
  });
  const zh = blank();
  zh.name = name;
  return {
    schemaVersion: 1,
    defaultLocale: "zh-Hant",
    enabledLocales: ["zh-Hant"],
    startDate: "",
    endDate: "",
    timezone: "Asia/Taipei",
    contactEmail: "",
    phone: "",
    translations: { "zh-Hant": zh, en: blank() },
  };
}
export const draftVersionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const siteDraftSchema = z.strictObject({
  draftVersion: draftVersionSchema,
  document: siteDocumentSchema,
  activePublicationId: z.uuid().nullable(),
  publishedDraftVersion: draftVersionSchema.nullable(),
});
export type SiteDraft = z.infer<typeof siteDraftSchema>;
export const publicSiteSchema = z.strictObject({
  publicationId: z.uuid().nullable(),
  conferenceName: z.string(),
  document: siteDocumentSchema.nullable(),
});
export type PublicSite = z.infer<typeof publicSiteSchema>;
export const publicationSchema = z.strictObject({
  publicationId: z.uuid(),
  draftVersion: draftVersionSchema,
  publishedAt: z.string(),
  publishedBy: z.uuid(),
  changedFields: z.array(z.string()),
});
export const siteHistorySchema = z.strictObject({
  items: z.array(publicationSchema),
  nextOffset: z.number().int().nullable(),
});
export type SiteHistory = z.infer<typeof siteHistorySchema>;
export const siteSaveInput = z.strictObject({
  expectedVersion: draftVersionSchema,
  document: siteDocumentSchema,
});
export const siteVersionInput = z.strictObject({
  expectedVersion: draftVersionSchema,
});
export const siteRestoreInput = siteVersionInput.extend({
  publicationId: z.uuid(),
});
export const siteEndpoints = {
  sitePublic: { method: "get", path: "/api/site", output: publicSiteSchema },
  siteDraft: {
    method: "get",
    path: "/api/site/draft",
    output: siteDraftSchema,
  },
  sitePreview: {
    method: "get",
    path: "/api/site/preview",
    input: z.strictObject({ version: z.coerce.number().int().min(1) }),
    output: siteDraftSchema,
  },
  siteHistory: {
    method: "get",
    path: "/api/site/history",
    input: z.strictObject({
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }),
    output: siteHistorySchema,
  },
  siteSave: {
    method: "post",
    path: "/api/site/draft",
    input: siteSaveInput,
    output: siteDraftSchema,
  },
  sitePublish: {
    method: "post",
    path: "/api/site/publish",
    input: siteVersionInput,
    output: publicationSchema,
  },
  siteRestore: {
    method: "post",
    path: "/api/site/restore",
    input: siteRestoreInput,
    output: siteDraftSchema,
  },
} as const;

export function siteChangedFields(
  before: SiteDocument | null,
  after: SiteDocument,
) {
  return (Object.keys(after) as (keyof SiteDocument)[]).filter(
    (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after[key]),
  );
}
