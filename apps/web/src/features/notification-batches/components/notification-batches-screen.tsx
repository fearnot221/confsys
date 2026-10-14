import { useState } from "react";
import type { NotificationBatch } from "@confsys/contracts";
type Props = {
  canManage: boolean;
  busy: boolean;
  error: string;
  message: string;
  items: NotificationBatch[];
  offset: number;
  nextOffset: number | null;
  page: (offset: number) => void;
  refresh: () => void;
  reauthenticate: (password: string) => Promise<void>;
  create: (recipients: string, subject: string, text: string) => Promise<void>;
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
  const [recipients, setRecipients] = useState(""),
    [subject, setSubject] = useState(""),
    [text, setText] = useState(""),
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
            Mailpit。每批最多100個已驗證且啟用的本地帳號，不接受外部 Email；請從
            Email 清單匯出取得帳號
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.create(recipients, subject, text);
            }}
          >
            <h2>建立通知批次</h2>
            <label>
              收件人本地帳號 UUID（每行一個）
              <textarea
                required
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </label>
            <label>
              通知主旨
              <input
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label>
              通知本文
              <textarea
                required
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
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
                {!b.cancelledAt && (
                  <button disabled={p.busy} onClick={() => void p.cancel(b.id)}>
                    取消待寄送：{b.subject}
                  </button>
                )}
              </li>
            ))}
          </ul>
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
