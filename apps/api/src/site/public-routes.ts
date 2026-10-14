import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import {
  siteLocales,
  sitePages,
  type PublicSite,
  type SiteLocale,
  type SitePage,
} from "@confsys/contracts";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { AuthError } from "../auth/errors.js";
import type { createSiteService } from "./service.js";
export type SiteRenderer = (
  site: PublicSite,
  locale: SiteLocale,
  page: SitePage,
  origin: string,
) => string;
export async function registerPublicRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  site: ReturnType<typeof createSiteService>,
  renderer?: SiteRenderer,
) {
  const render: SiteRenderer =
    renderer ??
    (
      await import(
        pathToFileURL(resolve("apps/web/dist/server/entry-server.js")).href
      )
    ).renderSite;
  app.addHook("onSend", async (_req, reply) => {
    reply.header(
      "content-security-policy",
      "default-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
  });
  app.get("/", async (_req, reply) => {
    const s = await site.public();
    return reply
      .type("text/html; charset=utf-8")
      .send(
        render(
          s,
          s.document?.defaultLocale ?? "zh-Hant",
          "home",
          config.PUBLIC_APP_ORIGIN,
        ),
      );
  });
  app.get("/:locale/:page", async (req, reply) => {
    const { locale, page } = req.params as { locale: string; page: string };
    const lang = siteLocales.find((v) => v === locale),
      key = sitePages.find((v) => v === page);
    if (!lang || !key) throw new AuthError("NOT_FOUND");
    const s = await site.public();
    if (s.document && !s.document.enabledLocales.includes(lang))
      throw new AuthError("NOT_FOUND");
    return reply
      .type("text/html; charset=utf-8")
      .send(render(s, lang, key, config.PUBLIC_APP_ORIGIN));
  });
  app.get("/sitemap.xml", async (_req, reply) => {
    const s = await site.public();
    const urls = s.document
      ? s.document.enabledLocales.flatMap((lang) =>
          sitePages.map(
            (page) => `${config.PUBLIC_APP_ORIGIN}/${lang}/${page}`,
          ),
        )
      : [];
    // All paths are fixed enums and origin is centrally validated (no query/fragment/userinfo).
    const xml = (v: string) =>
      v
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;");
    return reply
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${xml(u)}</loc></url>`).join("")}</urlset>`,
      );
  });
  app.get("/public-site.css", async (_req, reply) =>
    reply
      .type("text/css")
      .send(
        await readFile(resolve("apps/web/dist/server/public-site.css"), "utf8"),
      ),
  );
}
