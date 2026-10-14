import { RegistrationFields } from "./registration-fields.js";
import { useState } from "react";
import type {
  Registration,
  RegistrationConfig,
  RegistrationInput,
  RegistrationHistory,
} from "@confsys/contracts";
type Props = {
  historyId: string | null;
  historyOffset: number;
  history: RegistrationHistory | null;
  historyLoading: boolean;
  historyError: boolean;
  onHistory: (id: string | null) => void;
  onHistoryPage: (offset: number) => void;
  projectFields: (
    fields: RegistrationConfig["fields"],
    answers: RegistrationInput["answers"],
  ) => RegistrationConfig["fields"];
  projectAnswers: (
    fields: RegistrationConfig["fields"],
    answers: RegistrationInput["answers"],
  ) => RegistrationInput["answers"];
  admin: boolean;
  allowed: boolean;
  expired: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  config: { version: number; document: RegistrationConfig | null } | null;
  items: Registration[];
  offset: number;
  nextOffset: number | null;
  canConfigure: boolean;
  onPage: (n: number) => void;
  onRetry: () => void;
  onRegister: (
    data: Omit<RegistrationInput, "idempotencyKey">,
    key: string,
  ) => void;
  onEdit: (
    id: string,
    expectedVersion: number,
    badgeName: string,
    affiliation: string,
    answers: RegistrationInput["answers"],
    reason: string,
  ) => void;
  onPromote: (id: string, expectedVersion: number, reason: string) => void;
  onCancel: (id: string, reason: string) => void;
  onConfigure: (doc: RegistrationConfig) => void;
  onReauthenticate: (password: string) => void;
};
export function RegistrationScreen(p: Props) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<RegistrationInput["answers"]>({});
  return (
    <main className="layout" aria-busy={p.busy}>
      <h1>{p.admin ? "報名管理" : "研討會報名"}</h1>
      <nav>
        <a href="/">官網</a> · <a href="/auth/account">帳號</a> ·{" "}
        <a href="/account/files">我的檔案</a>
      </nav>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && (
        <p role="alert" id="registration-error">
          {p.error}
        </p>
      )}
      {p.message && <p role="status">{p.message}</p>}
      <button onClick={p.onRetry}>重新載入</button>
      {!p.allowed && !p.loading && (
        <p>
          請登入具備權限的本地帳號。<a href="/auth/login">登入</a>
        </p>
      )}
      {p.allowed && (
        <>
          {p.canConfigure && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  p.onReauthenticate(String(f.get("password")));
                }}
              >
                <label>
                  重新驗證密碼
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button disabled={p.busy}>驗證</button>
              </form>
              <ConfigEditor
                key={p.config?.version ?? 0}
                document={p.config?.document ?? null}
                busy={p.busy}
                onSave={p.onConfigure}
              />
            </>
          )}
          {!p.admin &&
            (p.config?.document ? (
              <form
                aria-describedby={p.error ? "registration-error" : undefined}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    d = p.config!.document!;
                  p.onRegister(
                    {
                      configVersion: p.config!.version,
                      ticketId: String(f.get("ticketId")),
                      badgeName: String(f.get("badgeName")),
                      affiliation: String(f.get("affiliation")),
                      consent: true,
                      answers: p.projectAnswers(d.fields, answers),
                    },
                    key,
                  );
                }}
              >
                <h2>填寫報名資料</h2>
                <p>
                  報名區間：{p.config.document.opensAt} 至{" "}
                  {p.config.document.closesAt}（截止不含）。時區：
                  {p.config.document.timezone}
                  。金額以最小貨幣單位顯示，正式價格由伺服器判定。
                </p>
                <label>
                  票種
                  <select name="ticketId" required>
                    {p.config.document.tickets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ·{" "}
                        {t.rates
                          .map(
                            (r) =>
                              `${r.amount} ${p.config!.document!.currency}`,
                          )
                          .join(" / ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  名牌姓名
                  <input name="badgeName" required maxLength={160} />
                </label>
                <label>
                  單位
                  <input name="affiliation" maxLength={300} />
                </label>
                <RegistrationFields
                  projectFields={p.projectFields}
                  fields={p.config.document.fields}
                  answers={answers}
                  onChange={setAnswers}
                />
                <label>
                  <input name="consent" type="checkbox" required />
                  {p.config.document.consent}
                </label>
                <button disabled={p.busy}>確認送出報名</button>
                <button
                  type="button"
                  onClick={() => setKey(crypto.randomUUID())}
                >
                  取消後重新建立新報名
                </button>
              </form>
            ) : (
              <p>報名尚未設定；建立帳號不代表已報名。</p>
            ))}
          <h2>{p.admin ? "報名清單" : "我的報名"}</h2>
          {!p.items.length && <p>沒有報名紀錄。</p>}
          <label>
            取消理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={300}
            />
          </label>
          <p>取消報名會取消訂單；不會自動退款。</p>
          {p.items.map((r) => (
            <article key={r.id}>
              <h3>
                #{r.number} {r.badgeName}
              </h3>
              <p>
                {r.ticketName} · {r.state} · {r.affiliation}
              </p>
              {r.order && (
                <p>
                  訂單 {r.order.id} · {r.order.amount} {r.order.currency}
                  （最小貨幣單位）· 已分配 {r.order.paid} · 已退款{" "}
                  {r.order.refunded}
                </p>
              )}
              {r.state === "confirmed" && (
                <p>
                  <a href={`/onsite/pass?registrationId=${r.id}`}>
                    開啟報到 QR
                  </a>{" "}
                  · <a href="/activities">預訂餐飲／活動</a>
                </p>
              )}
              <button onClick={() => p.onHistory(r.id)} disabled={p.busy}>
                查看 #{r.number} 異動歷程
              </button>
              {r.state !== "cancelled" && (
                <RegistrationEditor
                  key={r.version}
                  record={r}
                  busy={p.busy}
                  onEdit={p.onEdit}
                  projectFields={p.projectFields}
                  projectAnswers={p.projectAnswers}
                />
              )}{" "}
              {p.admin && r.state === "waitlisted" && (
                <button
                  disabled={p.busy || reason.trim().length < 3}
                  onClick={() => p.onPromote(r.id, r.version, reason)}
                >
                  按原費率遞補（依報名順序）
                </button>
              )}
              {r.state !== "cancelled" && (
                <button
                  disabled={p.busy || reason.trim().length < 3}
                  onClick={() => p.onCancel(r.id, reason)}
                >
                  確認取消此報名
                </button>
              )}
            </article>
          ))}
          {p.historyId && (
            <section aria-label="報名異動歷程">
              <h2>報名異動歷程</h2>
              <button onClick={() => p.onHistory(null)}>關閉歷程</button>
              {p.historyLoading && <p role="status">載入歷程…</p>}
              {p.historyError && <p role="alert">歷程載入失敗，請重試。</p>}
              {p.history?.items.map((item) => (
                <article key={item.version}>
                  <h3>版本 {item.version}</h3>
                  <p>
                    {item.createdAt} · {item.reason}
                  </p>
                  <p>
                    名牌：{item.before.badgeName} → {item.after.badgeName}
                    ；狀態：{item.before.state} → {item.after.state}
                  </p>
                  <details>
                    <summary>表單答案異動</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          before: item.before.answers,
                          after: item.after.answers,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ))}
              {p.history && !p.history.items.length && <p>尚無異動。</p>}
              <button
                disabled={!p.historyOffset}
                onClick={() =>
                  p.onHistoryPage(Math.max(0, p.historyOffset - 20))
                }
              >
                歷程上一頁
              </button>
              <button
                disabled={p.history?.nextOffset == null}
                onClick={() => p.onHistoryPage(p.history!.nextOffset!)}
              >
                歷程下一頁
              </button>
            </section>
          )}
          <button
            disabled={p.offset === 0 || p.busy}
            onClick={() => p.onPage(Math.max(0, p.offset - 20))}
          >
            上一頁
          </button>
          <button
            disabled={p.nextOffset === null || p.busy}
            onClick={() => p.onPage(p.nextOffset!)}
          >
            下一頁
          </button>
        </>
      )}
    </main>
  );
}
function ConfigEditor({
  document,
  busy,
  onSave,
}: {
  document: RegistrationConfig | null;
  busy: boolean;
  onSave: (d: RegistrationConfig) => void;
}) {
  const [tickets, setTickets] = useState(document?.tickets ?? []),
    [fields, setFields] = useState(document?.fields ?? []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          opensAt: new Date(String(f.get("opensAt"))).toISOString(),
          closesAt: new Date(String(f.get("closesAt"))).toISOString(),
          currency: String(f.get("currency")),
          timezone: String(f.get("timezone")),
          consent: String(f.get("consent")),
          tickets,
          fields,
        });
      }}
    >
      <h2>版本化報名設定</h2>
      <p>
        時間請輸入完整 UTC ISO
        時間（例：2027-01-01T00:00:00Z）。費率以最小貨幣單位輸入。修改後既有訂單價格不變。
      </p>
      {(
        ["opensAt", "closesAt", "currency", "timezone", "consent"] as const
      ).map((name, i) => (
        <label key={name}>
          {["開放時間", "截止時間", "幣別代碼", "IANA 時區", "同意事項"][i]}
          <input name={name} defaultValue={document?.[name] ?? ""} required />
        </label>
      ))}
      {tickets.map((t, i) => (
        <fieldset key={t.id}>
          <legend>票種 {i + 1}</legend>
          <label>
            名稱
            <input
              value={t.name}
              required
              onChange={(e) =>
                setTickets(
                  tickets.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            名額
            <input
              type="number"
              min={1}
              value={t.capacity}
              onChange={(e) =>
                setTickets(
                  tickets.map((x, j) =>
                    j === i ? { ...x, capacity: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={t.waitlist}
              onChange={(e) =>
                setTickets(
                  tickets.map((x, j) =>
                    j === i ? { ...x, waitlist: e.target.checked } : x,
                  ),
                )
              }
            />
            額滿開放候補
          </label>
          {t.rates.map((r, k) => (
            <fieldset key={k}>
              <legend>費率 {k + 1}</legend>
              {(["startsAt", "endsAt", "amount"] as const).map((field, n) => (
                <label key={field}>
                  {["起始 UTC ISO", "結束 UTC ISO", "最小單位金額"][n]}
                  <input
                    value={r[field]}
                    required
                    onChange={(e) =>
                      setTickets(
                        tickets.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                rates: x.rates.map((rate, l) =>
                                  l === k
                                    ? { ...rate, [field]: e.target.value }
                                    : rate,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              setTickets(
                tickets.map((x, j) =>
                  j === i
                    ? {
                        ...x,
                        rates: [
                          ...x.rates,
                          { startsAt: "", endsAt: "", amount: "0" },
                        ],
                      }
                    : x,
                ),
              )
            }
          >
            新增費率區間
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setTickets([
            ...tickets,
            {
              id: crypto.randomUUID(),
              name: "",
              capacity: 1,
              waitlist: false,
              rates: [{ startsAt: "", endsAt: "", amount: "0" }],
            },
          ])
        }
      >
        新增票種
      </button>
      {fields.map((f, i) => (
        <fieldset key={i}>
          <legend>自訂欄位 {i + 1}</legend>
          <label>
            欄位代碼
            <input
              required
              value={f.key}
              onChange={(e) =>
                setFields(
                  fields.map((x, j) =>
                    j === i ? { ...x, key: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            標籤
            <input
              required
              value={f.label}
              onChange={(e) =>
                setFields(
                  fields.map((x, j) =>
                    j === i ? { ...x, label: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            型態
            <select
              value={f.type}
              onChange={(e) =>
                setFields(
                  fields.map((x, j) =>
                    j === i
                      ? { ...x, type: e.target.value as typeof f.type }
                      : x,
                  ),
                )
              }
            >
              {[
                "text",
                "long_text",
                "number",
                "select",
                "multiselect",
                "date",
                "checkbox",
                "description",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) =>
                setFields(
                  fields.map((x, j) =>
                    j === i ? { ...x, required: e.target.checked } : x,
                  ),
                )
              }
            />
            必填
          </label>
          <label>
            條件顯示：前置欄位
            <select
              value={f.showWhen?.fieldKey ?? ""}
              onChange={(e) =>
                setFields(
                  fields.map((field, index) => {
                    if (index !== i) return field;
                    const parent = fields.find(
                      (value) => value.key === e.target.value,
                    );
                    const { showWhen: _previous, ...rest } = field;
                    void _previous;
                    return parent
                      ? {
                          ...rest,
                          showWhen: {
                            fieldKey: parent.key,
                            equals:
                              parent.type === "checkbox"
                                ? true
                                : parent.type === "number"
                                  ? 0
                                  : (parent.options[0] ?? ""),
                          },
                        }
                      : rest;
                  }),
                )
              }
            >
              <option value="">一律顯示</option>
              {fields
                .slice(0, i)
                .filter(
                  (field) =>
                    field.key &&
                    !["description", "multiselect"].includes(field.type),
                )
                .map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label} ({field.key})
                  </option>
                ))}
            </select>
          </label>
          {f.showWhen && (
            <label>
              前置欄位等於（布林值填 true 或 false）
              <input
                value={String(f.showWhen.equals)}
                onChange={(e) =>
                  setFields(
                    fields.map((field, index) => {
                      if (index !== i || !field.showWhen) return field;
                      const parent = fields.find(
                        (value) => value.key === field.showWhen!.fieldKey,
                      );
                      return {
                        ...field,
                        showWhen: {
                          ...field.showWhen,
                          equals:
                            parent?.type === "checkbox"
                              ? e.target.value === "true"
                              : parent?.type === "number"
                                ? Number(e.target.value)
                                : e.target.value,
                        },
                      };
                    }),
                  )
                }
              />
            </label>
          )}
          <label>
            選項（每行一個）
            <textarea
              value={f.options.join("\n")}
              onChange={(e) =>
                setFields(
                  fields.map((x, j) =>
                    j === i ? { ...x, options: e.target.value.split("\n") } : x,
                  ),
                )
              }
            />
          </label>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setFields([
            ...fields,
            { key: "", label: "", type: "text", required: false, options: [] },
          ])
        }
      >
        新增欄位
      </button>
      <button disabled={busy}>儲存新版設定</button>
    </form>
  );
}

function RegistrationEditor({
  record: r,
  busy,
  onEdit,
  projectFields,
  projectAnswers,
}: {
  record: Registration;
  busy: boolean;
  onEdit: Props["onEdit"];
  projectFields: Props["projectFields"];
  projectAnswers: Props["projectAnswers"];
}) {
  const [answers, setAnswers] = useState(r.answers);
  return (
    <details>
      <summary>修改報名資料（版本 {r.version}）</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onEdit(
            r.id,
            r.version,
            String(f.get("badgeName")),
            String(f.get("affiliation")),
            projectAnswers(r.formFields, answers),
            String(f.get("reason")),
          );
        }}
      >
        <p>
          依原表單版本驗證；不更動原訂單或已發行文件。截止後須由行政人員附理由處理。
        </p>
        <label>
          修改名牌姓名
          <input
            name="badgeName"
            defaultValue={r.badgeName}
            required
            maxLength={160}
          />
        </label>
        <label>
          修改單位
          <input
            name="affiliation"
            defaultValue={r.affiliation}
            maxLength={300}
          />
        </label>
        <RegistrationFields
          projectFields={projectFields}
          fields={r.formFields}
          answers={answers}
          onChange={setAnswers}
        />
        <label>
          修改理由
          <input name="reason" required minLength={3} maxLength={300} />
        </label>
        <button disabled={busy}>儲存資料異動</button>
      </form>
    </details>
  );
}
