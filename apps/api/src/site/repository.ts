import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  siteDocumentSchema,
  type SiteDocument,
  type SiteDraft,
  initialSite,
  publicationSchema,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
type Connection = Pool | PoolClient;
export async function published(db: Connection) {
  // One statement fixes the active immutable version. Never re-read the pointer for its fields.
  const row = (
    await db.query<{ id: string; document: unknown }>(
      `SELECT p.id,p.document FROM confsys.site_state s JOIN confsys.site_publications p ON p.id=s.active_publication_id WHERE s.singleton=true`,
    )
  ).rows[0];
  return row
    ? { id: row.id, document: siteDocumentSchema.parse(row.document) }
    : null;
}
export async function draft(db: Connection, name: string): Promise<SiteDraft> {
  const row = (
    await db.query<{
      draft_version: number;
      document: unknown;
      active_publication_id: string | null;
      source_draft_version: number | null;
    }>(
      `SELECT s.*,p.source_draft_version FROM confsys.site_state s LEFT JOIN confsys.site_publications p ON p.id=s.active_publication_id WHERE s.singleton=true`,
    )
  ).rows[0];
  if (!row) throw new Error("Site migration required");
  return {
    draftVersion: row.draft_version,
    document:
      row.document === null
        ? initialSite(name)
        : siteDocumentSchema.parse(row.document),
    activePublicationId: row.active_publication_id,
    publishedDraftVersion: row.source_draft_version,
  };
}
export async function save(
  db: PoolClient,
  document: SiteDocument,
  version: number,
) {
  const result = await db.query(
    `UPDATE confsys.site_state SET document=$1,draft_version=draft_version+1 WHERE singleton=true AND draft_version=$2`,
    [document, version],
  );
  if (!result.rowCount) throw new AuthError("CONFLICT");
}
const projection = `id AS "publicationId",source_draft_version AS "draftVersion",published_at,published_by AS "publishedBy",changed_fields AS "changedFields"`;
function project(row: Record<string, unknown>) {
  const { published_at, ...rest } = row;
  if (!(published_at instanceof Date))
    throw new Error("Invalid publication timestamp");
  return publicationSchema.parse({
    ...rest,
    publishedAt: published_at.toISOString(),
  });
}
export async function publicationForVersion(db: Connection, version: number) {
  const row = (
    await db.query(
      `SELECT ${projection} FROM confsys.site_publications WHERE source_draft_version=$1`,
      [version],
    )
  ).rows[0];
  return row ? project(row) : null;
}
export async function insertPublication(
  db: PoolClient,
  document: SiteDocument,
  version: number,
  actorId: string,
  fields: string[],
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO confsys.site_publications(id,source_draft_version,document,published_by,changed_fields) VALUES($1,$2,$3,$4,$5)`,
    [id, version, document, actorId, JSON.stringify(fields)],
  );
  await db.query(
    `UPDATE confsys.site_state SET active_publication_id=$1 WHERE singleton=true`,
    [id],
  );
  return (await publicationForVersion(db, version))!;
}
export async function history(db: Connection, offset: number) {
  const rows = (
    await db.query(
      `SELECT ${projection} FROM confsys.site_publications ORDER BY published_at DESC,id DESC LIMIT 21 OFFSET $1`,
      [offset],
    )
  ).rows;
  return {
    items: rows.slice(0, 20).map(project),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}
export async function historicalDocument(db: Connection, id: string) {
  const row = (
    await db.query(
      `SELECT document FROM confsys.site_publications WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new AuthError("NOT_FOUND");
  return siteDocumentSchema.parse(row.document);
}
export async function recordSite(
  db: PoolClient,
  actorId: string,
  requestId: string,
  event: string,
  version: number,
  fields: string[],
  publicationId?: string,
) {
  await db.query(
    `INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session','Conference site change',$4,$5)`,
    [
      randomUUID(),
      event,
      actorId,
      JSON.stringify({
        draftVersion: version,
        fields,
        ...(publicationId ? { publicationId } : {}),
      }),
      requestId,
    ],
  );
}
