import type { PoolClient } from "pg";
import { financeReminderPreview } from "@confsys/contracts";
export async function context(db: PoolClient, actor: string) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin','true',true),set_config('app.notifications_manage','false',true)",
    [actor],
  );
}
export async function audience(db: PoolClient, offset: number) {
  const rows = (
    await db.query(
      "SELECT id,email,balances,count(*) OVER()::integer AS total FROM confsys.finance_reminder_audience ORDER BY email,id LIMIT 101 OFFSET $1",
      [offset],
    )
  ).rows;
  const total =
    rows[0]?.total ??
    Number(
      (
        await db.query(
          "SELECT count(*) AS total FROM confsys.finance_reminder_audience",
        )
      ).rows[0].total,
    );
  return financeReminderPreview.parse({
    items: rows
      .slice(0, 100)
      .map(({ id, email, balances }) => ({ id, email, balances })),
    total,
    nextOffset: rows.length > 100 ? offset + 100 : null,
  });
}
export async function eligible(db: PoolClient, ids: string[]) {
  return (
    await db.query(
      "SELECT id FROM confsys.finance_reminder_audience WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows.map((r: { id: string }) => r.id);
}
