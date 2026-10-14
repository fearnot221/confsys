import { initialSite, siteLocales } from "@confsys/contracts";
import { diagnostic } from "@confsys/config";
import { AuthError } from "../auth/errors.js";
import type { Pool, PoolClient } from "pg";
import { published } from "./repository.js";
// The only effective branding resolver. Database failure propagates; drafts never fall back.
export async function effectivePublicSite(
  db: Pool | PoolClient,
  bootstrapName: string,
) {
  try {
    const active = await published(db);
    const document = active?.document ?? null;
    if (document) {
      const empty = initialSite("");
      for (const locale of siteLocales)
        if (!document.enabledLocales.includes(locale))
          document.translations[locale] = empty.translations[locale];
    }
    return {
      publicationId: active?.id ?? null,
      conferenceName: active
        ? active.document.translations[active.document.defaultLocale].name
        : bootstrapName,
      document,
    };
  } catch {
    diagnostic("site", "public_read_failed");
    throw new AuthError("SERVICE_UNAVAILABLE");
  }
}
