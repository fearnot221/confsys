import { useState } from "react";
import type { Invitation } from "@confsys/contracts";
type Props = {
  expired: boolean;
  canManage: boolean;
  busy: boolean;
  message: string;
  loading: boolean;
  error: string;
  items: Invitation[];
  offset: number;
  next: number | null;
  onPage: (offset: number) => void;
  onRetry: () => void;
  onReauthenticate: (password: string) => void;
  onCreate: (email: string, role: string, reason: string) => void;
  onRevoke: (id: string, reason: string) => void;
};
export function InvitationsScreen(props: Props) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("conference_staff"),
    [reason, setReason] = useState(""),
    [password, setPassword] = useState("");
  return (
    <main className="layout access-panel">
      <h1>本研討會角色邀請</h1>
      <p>
        <a href="/auth/account">返回帳號</a> ·{" "}
        <a href="/access/accounts">帳號管理</a>
      </p>
      <p>
        收件人須先註冊並驗證本研討會帳號。邀請於 72
        小時後到期；對方必須登入並明確接受，不會自動授權。
      </p>
      {props.loading && <p role="status">載入中…</p>}
      {props.error && <p role="alert">{props.error}</p>}
      {props.message && <p role="status">{props.message}</p>}
      {props.expired ? (
        <a href="/auth/login">重新登入</a>
      ) : (
        <button onClick={props.onRetry} disabled={props.busy}>
          重新整理
        </button>
      )}
      {props.canManage && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              props.onReauthenticate(password);
              setPassword("");
            }}
          >
            <h2>近期密碼驗證</h2>
            <label>
              目前密碼
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={props.busy}>驗證密碼</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              props.onCreate(email, role, reason);
            }}
          >
            <h2>建立邀請</h2>
            <label>
              已驗證的本地 Email
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              角色
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="conference_staff">會議工作人員</option>
                <option value="conference_admin">會議管理員</option>
              </select>
            </label>
            <label>
              建立／撤銷理由
              <input
                required
                minLength={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={props.busy}>建立並排入郵件佇列</button>
          </form>
          <h2>邀請紀錄</h2>
          {!props.items.length && !props.loading && <p>此頁沒有邀請。</p>}
          <ul>
            {props.items.map((item) => (
              <li key={item.id}>
                <strong>{item.email}</strong> · {item.role} · {item.status} ·
                到期：<time dateTime={item.expiresAt}>{item.expiresAt}</time>
                {item.status === "pending" && (
                  <button
                    disabled={props.busy || reason.trim().length < 3}
                    onClick={() => props.onRevoke(item.id, reason)}
                  >
                    撤銷邀請
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            disabled={props.offset === 0 || props.busy}
            onClick={() => props.onPage(Math.max(0, props.offset - 20))}
          >
            上一頁
          </button>
          <button
            disabled={props.next === null || props.busy}
            onClick={() => {
              if (props.next !== null) props.onPage(props.next);
            }}
          >
            下一頁
          </button>
        </>
      )}
    </main>
  );
}
