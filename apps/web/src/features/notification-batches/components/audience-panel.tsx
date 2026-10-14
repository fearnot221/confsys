import { useEffect, useState } from "react";
import type {
  NotificationAudience,
  NotificationAudiencePreview,
} from "@confsys/contracts";
type Props = {
  roleOptions: NonNullable<NotificationAudience["role"]>[];
  busy: boolean;
  preview: NotificationAudiencePreview | null;
  previewFilters: NotificationAudience | null;
  onPreview: (filters: NotificationAudience) => Promise<void>;
  onAdopt: (ids: string[], filters: NotificationAudience) => void;
};
export function NotificationAudiencePanel(p: Props) {
  const [filters, setFilters] = useState<NotificationAudience>({
    role: null,
    registration: "any",
    submission: "any",
    publishedOutcome: "any",
  });
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected([]), [p.preview]);
  const current = JSON.stringify(filters) === JSON.stringify(p.previewFilters);
  return (
    <section aria-label="通知受眾預覽">
      <h2>篩選與預覽收件者</h2>
      <p>
        只列出已驗證且啟用的本地帳號。報名狀態優先採用目前未取消的報名，否則採用最近一次取消紀錄。篩選只建立此次明確選定的受眾快照。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void p.onPreview(filters);
        }}
      >
        <label htmlFor="audience-role">角色篩選</label>
        <select
          id="audience-role"
          value={filters.role ?? ""}
          onChange={(e) =>
            setFilters({
              ...filters,
              role: p.roleOptions.find(role => role === e.target.value) ?? null,
            })
          }
        >
          <option value="">全部角色</option>
          {p.roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <label htmlFor="audience-registration">報名狀態篩選</label>
        <select
          id="audience-registration"
          value={filters.registration}
          onChange={(e) =>
            setFilters({
              ...filters,
              registration: e.target
                .value as NotificationAudience["registration"],
            })
          }
        >
          {["any", "none", "confirmed", "cancelled"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <label htmlFor="audience-submission">投稿狀態篩選</label>
        <select
          id="audience-submission"
          value={filters.submission}
          onChange={(e) =>
            setFilters({
              ...filters,
              submission: e.target.value as NotificationAudience["submission"],
            })
          }
        >
          {["any", "none", "draft", "submitted", "withdrawn"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <label htmlFor="audience-outcome">已發布結果篩選</label>
        <select
          id="audience-outcome"
          value={filters.publishedOutcome}
          onChange={(e) =>
            setFilters({
              ...filters,
              publishedOutcome: e.target
                .value as NotificationAudience["publishedOutcome"],
            })
          }
        >
          {["any", "accepted", "reject", "revision_requested"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button disabled={p.busy}>預覽受眾</button>
      </form>
      {p.preview && current && (
        <>
          <p>
            符合 {p.preview.total} 位；本次預覽 {p.preview.items.length} 位。
            {p.preview.truncated && "超過每批100位，請縮小篩選或分批處理。"}
          </p>
          <button
            type="button"
            disabled={p.busy}
            onClick={() => setSelected(p.preview!.items.map((item) => item.id))}
          >
            勾選本次預覽全部收件者
          </button>
          <ul>
            {p.preview.items.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.email}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={p.busy || selected.length === 0}
            onClick={() => p.onAdopt(selected, filters)}
          >
            採用勾選的 {selected.length} 位收件者
          </button>
        </>
      )}
      {p.preview && !current && <p>篩選已變更，請重新預覽後再採用。</p>}
    </section>
  );
}
