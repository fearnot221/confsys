import { useId, useState } from "react";
type History = {
  id: string;
  previousDeadline: string;
  deadline: string;
  reason: string;
  createdAt: string;
};
export function DeadlineHistory({
  original,
  effective,
  history,
}: {
  original: string;
  effective: string;
  history: History[];
}) {
  return (
    <div>
      <p>
        目前截止：{effective} · 原始截止：{original}
      </p>
      {history.length > 0 && (
        <details>
          <summary>期限展延紀錄（{history.length}）</summary>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                {h.createdAt}：{h.previousDeadline} → {h.deadline}；{h.reason}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
export function DeadlineExtension({
  busy,
  onExtend,
}: {
  busy: boolean;
  onExtend: (deadline: string, reason: string) => void;
}) {
  const prefix = useId(),
    [deadline, setDeadline] = useState(""),
    [reason, setReason] = useState("");
  const valid = Number.isFinite(Date.parse(deadline));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onExtend(new Date(deadline).toISOString(), reason);
      }}
    >
      <label htmlFor={prefix + "deadline"}>展延後截止時間（含時區）</label>
      <input
        id={prefix + "deadline"}
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        placeholder="2026-10-20T18:00:00+08:00"
        required
      />
      <label htmlFor={prefix + "reason"}>展延理由（評審可見）</label>
      <textarea
        id={prefix + "reason"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={3}
        maxLength={2000}
        required
      />
      <button disabled={busy || !valid || reason.trim().length < 3}>
        展延此指派期限
      </button>
      <p>
        保留原評分表；只接受比目前截止更晚的未來時間，最多一年及 50 次紀錄。
      </p>
    </form>
  );
}
