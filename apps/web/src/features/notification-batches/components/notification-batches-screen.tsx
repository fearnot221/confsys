import { useState } from "react";
import type {
  NotificationBatch,
  NotificationAudience,
  NotificationAudiencePreview,
  NotificationBatchOptions,
  NotificationTemplate,
  NotificationTemplateDraft,
  NotificationDelivery,
} from "@confsys/contracts";
import { NotificationAudiencePanel } from "./audience-panel.js";
import { NotificationTemplatePanel } from "./template-panel.js";
type Props = {
  roleOptions: NonNullable<NotificationAudience["role"]>[];
  canManage: boolean;
  preview: NotificationAudiencePreview | null;
  previewFilters: NotificationAudience | null;
  previewAudience: (filters: NotificationAudience) => Promise<void>;
  templates: NotificationTemplate[];
  templateOffset: number;
  templateNext: number | null;
  templatePage: (offset: number) => void;
  saveTemplate: (draft: NotificationTemplateDraft) => Promise<void>;
  deliveryBatch: string | null;
  deliveries: NotificationDelivery[];
  deliveryOffset: number;
  deliveryNext: number | null;
  deliveryPage: (offset: number) => void;
  selectDeliveries: (id: string) => void;
  busy: boolean;
  error: string;
  message: string;
  items: NotificationBatch[];
  offset: number;
  nextOffset: number | null;
  page: (offset: number) => void;
  refresh: () => void;
  reauthenticate: (password: string) => Promise<void>;
  create: (
    recipients: string,
    subject: string,
    text: string,
    options: NotificationBatchOptions,
  ) => Promise<void>;
  retry: (id: string, reason: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
};
const labels = {
  pending: "待寄送",
  processing: "處理中",
  accepted: "SMTP 已接受",
  failed: "失敗",
  unknown: "結果不確定",
  cancelled: "已取消",
};
export function NotificationBatchesScreen(p: Props) {
  const [audience, setAudience] = useState<NotificationAudience | null>(null),
    [templateVersionId, setTemplateVersionId] = useState<string | null>(null),
    [scheduledAt, setScheduledAt] = useState(""),
    [recipients, setRecipients] = useState(""),
    [subject, setSubject] = useState(""),
    [text, setText] = useState(""),
    [retryReasons, setRetryReasons] = useState<Record<string, string>>({}),
    [password, setPassword] = useState("");
  return (
    <main className="layout access-panel">
      <h1>批次通知管理</h1>
      <p>
        <a href="/notifications">通知中心與 Email 清單匯出</a> ·{" "}
        <a href="/auth/account">帳號</a>
      </p>
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      {!p.canManage ? (
        <p>
          需要本場研討會通知管理權限。請<a href="/auth/login">登入</a>。
        </p>
      ) : (
        <>
          <p>
            目前郵件僅使用測試擷取服務
            Mailpit。每批最多100個已驗證且啟用的本地帳號，不接受外部
            Email；可先篩選預覽，或使用已核對的帳號
            UUID。只填寫一般公告，不包含密碼、存取密鑰或尚未公開的個人資料。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.reauthenticate(password);
              setPassword("");
            }}
          >
            <h2>近期密碼驗證</h2>
            <label>
              目前密碼
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={p.busy}>驗證密碼</button>
          </form>
          <NotificationAudiencePanel
            roleOptions={p.roleOptions}
            busy={p.busy}
            preview={p.preview}
            previewFilters={p.previewFilters}
            onPreview={p.previewAudience}
            onAdopt={(ids, filters) => {
              setRecipients(ids.join("\n"));
              setAudience(filters);
            }}
          />
          <NotificationTemplatePanel
            busy={p.busy}
            items={p.templates}
            offset={p.templateOffset}
            next={p.templateNext}
            onPage={p.templatePage}
            subject={subject}
            text={text}
            onSave={p.saveTemplate}
            onApply={(template) => {
              setSubject(template.subject);
              setText(template.text);
              setTemplateVersionId(template.id);
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.create(recipients, subject, text, {
                audience,
                templateVersionId,
                scheduledAt: scheduledAt || null,
              });
            }}
          >
            <h2>建立通知批次</h2>
            <label>
              收件人本地帳號 UUID（每行一個）
              <textarea
                required
                value={recipients}
                onChange={(e) => {
                  setRecipients(e.target.value);
                  setAudience(null);
                }}
              />
            </label>
            <label>
              通知主旨
              <input
                required
                maxLength={200}
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setTemplateVersionId(null);
                }}
              />
            </label>
            <label>
              通知本文
              <textarea
                required
                maxLength={4000}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setTemplateVersionId(null);
                }}
              />
            </label>
            {audience && (
              <p>
                此批次使用已預覽並明確採用的受眾；送出時將重新核對每位收件者仍符合篩選。
              </p>
            )}
            {templateVersionId && (
              <p>已連結不可變範本版本：{templateVersionId}</p>
            )}
            <label>
              預約寄送時間（UTC ISO，留空立即；最多30日）
              <input
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                placeholder="2026-10-16T02:00:00Z"
              />
            </label>
            <p>
              通知中心與郵件皆不會提早公開預約內容。請確認上列收件者、主旨、本文與時間後再送出。
            </p>
            <button disabled={p.busy}>儲存並排入通知佇列</button>
          </form>
          <h2>通知批次紀錄</h2>
          <p>
            重送同一份表單沿用相同請求識別碼。寄送前重新檢查收件人與發起者的有效狀態和權限。取消只停止尚未開始的寄送，無法撤回已開始、已接受或結果不確定的郵件。
          </p>
          <button disabled={p.busy} onClick={p.refresh}>
            重新整理批次狀態
          </button>
          {!p.items.length && <p>此頁沒有通知批次。</p>}
          <ul>
            {p.items.map((b) => (
              <li key={b.id} className="my-4 border p-4">
                <h3>{b.subject}</h3>
                <p className="whitespace-pre-wrap">{b.text}</p>
                <p>
                  {b.recipientCount}位收件人 ·{" "}
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {b.cancelledAt ? "已要求取消" : "未取消"}
                </p>
                <ul>
                  {b.statuses.map((s) => (
                    <li key={s.status}>
                      {labels[s.status]}：{s.count}
                    </li>
                  ))}
                </ul>
                <p>
                  寄送安排：{b.scheduledAt ?? "建立後立即"} ·{" "}
                  {b.templateVersionId ? "已保存範本版本連結" : "自訂內容"}
                </p>
                <button
                  type="button"
                  disabled={p.busy}
                  onClick={() => p.selectDeliveries(b.id)}
                >
                  查看寄送明細：{b.subject}
                </button>
                {b.retryOf && <p>原批次：{b.retryOf}</p>}
                {b.retriedAs && (
                  <p>重試批次：{b.retriedAs}（保留此批次原始狀態）</p>
                )}
                {b.retryableCount > 0 && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void p.retry(b.id, retryReasons[b.id] ?? "");
                    }}
                  >
                    <p>
                      可人工重試 {b.retryableCount}{" "}
                      位：僅限七日內、連線尚未開始便明確失敗的收件人。結果不確定者不會重寄。
                    </p>
                    <label htmlFor={`retry-reason-${b.id}`}>
                      重試理由：{b.subject}
                    </label>
                    <input
                      id={`retry-reason-${b.id}`}
                      required
                      minLength={3}
                      maxLength={300}
                      value={retryReasons[b.id] ?? ""}
                      onChange={(e) =>
                        setRetryReasons({
                          ...retryReasons,
                          [b.id]: e.target.value,
                        })
                      }
                    />
                    <button disabled={p.busy}>重試明確失敗：{b.subject}</button>
                  </form>
                )}
                {!b.cancelledAt && (
                  <button disabled={p.busy} onClick={() => void p.cancel(b.id)}>
                    取消待寄送：{b.subject}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {p.deliveryBatch && (
            <section aria-label="批次寄送明細">
              <h2>寄送明細</h2>
              <p>
                批次：{p.deliveryBatch}。SMTP 接受不代表送達；沒有供應商
                delivery/bounce 事件時不推測投遞或退信結果。
              </p>
              <ul>
                {p.deliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <p>
                      {delivery.email} · {labels[delivery.status]} · 嘗試{" "}
                      {delivery.attempts} 次
                    </p>
                    <p>
                      結果：{delivery.resultCode ?? "尚無結果"} · Provider
                      message ID：{delivery.providerId ?? "尚無識別碼"}
                    </p>
                    <p>
                      內容可見時間：{delivery.availableAt} · 下次處理時間：
                      {delivery.nextAttemptAt}
                    </p>
                  </li>
                ))}
              </ul>
              <button
                disabled={p.busy || !p.deliveryOffset}
                onClick={() =>
                  p.deliveryPage(Math.max(0, p.deliveryOffset - 20))
                }
              >
                上一頁寄送明細
              </button>
              <button
                disabled={p.busy || p.deliveryNext === null}
                onClick={() => {
                  if (p.deliveryNext !== null) p.deliveryPage(p.deliveryNext);
                }}
              >
                下一頁寄送明細
              </button>
            </section>
          )}
          <button
            disabled={p.busy || p.offset === 0}
            onClick={() => p.page(Math.max(0, p.offset - 20))}
          >
            上一頁批次
          </button>{" "}
          <button
            disabled={p.busy || p.nextOffset === null}
            onClick={() => p.page(p.nextOffset!)}
          >
            下一頁批次
          </button>
        </>
      )}
    </main>
  );
}
