import type {
  FinanceReminderPreview,
  NotificationBatchPage,
} from "@confsys/contracts";
type Props = {
  audience: FinanceReminderPreview | undefined;
  batches: NotificationBatchPage | undefined;
  audienceOffset: number;
  batchOffset: number;
  selected: string[];
  reason: string;
  setReason: (reason: string) => void;
  pending: boolean;
  loading: boolean;
  error: string | null;
  queued: boolean;
  onRefresh: () => void;
  onToggle: (id: string) => void;
  onAudiencePage: (offset: number) => void;
  onBatchPage: (offset: number) => void;
  onCreate: () => void;
  onCancel: (id: string) => void;
};
export function FinanceRemindersScreen(p: Props) {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">付款催繳通知</h1>
      <p>
        依目前未繳足的有效訂單選取收件者，每批最多100人。金額以各幣別最小單位顯示。寄送前會再檢查付款狀態；已繳足者不寄送。
      </p>
      <button onClick={p.onRefresh} disabled={p.pending}>
        重新整理
      </button>
      {p.loading && <p role="status">載入中</p>}
      {p.error && <p role="alert">{p.error}</p>}
      {p.queued && (
        <p role="status">通知批次已排入工作佇列；實際結果請查看批次狀態。</p>
      )}
      <section aria-labelledby="reminder-audience">
        <h2 id="reminder-audience">
          目前符合 {p.audience?.total ?? 0} 人；本頁{" "}
          {p.audience?.items.length ?? 0} 人
        </h2>
        <ul>
          {p.audience?.items.map((person) => (
            <li key={person.id}>
              <label>
                <input
                  type="checkbox"
                  checked={p.selected.includes(person.id)}
                  onChange={() => p.onToggle(person.id)}
                  disabled={
                    p.pending ||
                    (!p.selected.includes(person.id) &&
                      p.selected.length >= 100)
                  }
                />
                {person.email} —{" "}
                {person.balances
                  .map((b) => `${b.currency} ${b.amount}`)
                  .join(" / ")}
              </label>
            </li>
          ))}
        </ul>
        <button
          disabled={p.audienceOffset === 0 || p.pending}
          onClick={() => p.onAudiencePage(Math.max(0, p.audienceOffset - 100))}
        >
          收件者上一頁
        </button>
        <button
          disabled={p.audience?.nextOffset == null || p.pending}
          onClick={() => p.onAudiencePage(p.audience!.nextOffset!)}
        >
          收件者下一頁
        </button>
      </section>
      <section>
        <h2>通知內容</h2>
        <p>
          通知會請收件者登入查看目前訂單金額與人工核帳狀態，不在信件內保存可能過時的應繳金額。
        </p>
        <label htmlFor="reminder-reason">操作理由（建立及取消皆記錄）</label>
        <input
          id="reminder-reason"
          value={p.reason}
          minLength={3}
          maxLength={300}
          onChange={(e) => p.setReason(e.target.value)}
          required
        />
        <button
          disabled={
            p.pending || !p.selected.length || p.reason.trim().length < 3
          }
          onClick={p.onCreate}
        >
          確認排入 {p.selected.length} 位收件者
        </button>
      </section>
      <section aria-labelledby="reminder-batches">
        <h2 id="reminder-batches">催繳批次</h2>
        <ul>
          {p.batches?.items.map((batch) => (
            <li key={batch.id}>
              <p>
                {batch.subject} — {batch.recipientCount} 人 —{" "}
                {new Date(batch.createdAt).toLocaleString()}
              </p>
              <p>
                {batch.statuses
                  .map((s) => `${s.status}: ${s.count}`)
                  .join(" / ") || "等待工作處理"}
              </p>
              {batch.cancelledAt ? (
                <p>已取消待寄通知；已寄出信件無法收回。</p>
              ) : (
                <button
                  disabled={p.pending || p.reason.trim().length < 3}
                  onClick={() => p.onCancel(batch.id)}
                >
                  取消此批尚未寄出的通知
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          disabled={p.batchOffset === 0 || p.pending}
          onClick={() => p.onBatchPage(Math.max(0, p.batchOffset - 20))}
        >
          批次上一頁
        </button>
        <button
          disabled={p.batches?.nextOffset == null || p.pending}
          onClick={() => p.onBatchPage(p.batches!.nextOffset!)}
        >
          批次下一頁
        </button>
      </section>
    </main>
  );
}
