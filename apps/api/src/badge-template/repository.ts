import type { PoolClient } from "pg";
import { badgeTemplate, type BadgeTemplateDocument } from "@confsys/contracts";
export async function current(db: PoolClient) {
  const row = (
    await db.query(
      "SELECT COALESCE(s.current_version,0) AS version,v.document FROM confsys.badge_template_state s LEFT JOIN confsys.badge_template_versions v ON v.version=s.current_version WHERE singleton",
    )
  ).rows[0];
  return badgeTemplate.parse(row);
}
export async function lock(db: PoolClient) {
  await db.query(
    "SELECT current_version FROM confsys.badge_template_state WHERE singleton FOR UPDATE",
  );
}
export async function save(
  db: PoolClient,
  actor: string,
  version: number,
  document: BadgeTemplateDocument,
) {
  await db.query(
    "INSERT INTO confsys.badge_template_versions(version,document,created_by) VALUES($1,$2,$3)",
    [version, document, actor],
  );
  await db.query(
    "UPDATE confsys.badge_template_state SET current_version=$1 WHERE singleton",
    [version],
  );
}
