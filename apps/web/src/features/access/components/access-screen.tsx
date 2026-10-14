import { useState } from "react";
import { Button, Input, Layout } from "@confsys/ui";
type Account = {
  id: string;
  email: string;
  state: string;
  verified: boolean;
  roles: string[];
};
type View = {
  conferenceName: string;
  email: string;
  expired: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  items: Account[];
  target: Account | null;
  roles: string[];
  canManage: boolean;
  canStatus: boolean;
  canRevoke: boolean;
  canAudit: boolean;
  offset: number;
  next: number | null;
  auditOffset: number;
  auditNext: number | null;
  audit: {
    id: string;
    event: string;
    targetId: string | null;
    actorId: string | null;
    source: string;
    reason: string | null;
    before: string | null;
    after: string | null;
    requestId: string;
    createdAt: string;
  }[];
  onSearch: (value: string, state: string) => void;
  onSelect: (id: string) => void;
  onCancel: () => void;
  onPage: (value: number) => void;
  onAuditPage: (value: number) => void;
  onRetry: () => void;
  onReauthenticate: (password: string) => void;
  onAction: (action: string, role: string, reason: string) => void;
};
export function AccessScreen(view: View) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [password, setPassword] = useState("");
  return (
    <Layout>
      <div className="access-panel">
        <header>
          <p className="brand">{view.conferenceName}</p>
          <h1>本研討會帳號管理</h1>
          <p>{view.email}</p>
          <a href="/auth/account">自己的帳號</a>
        </header>
        {view.loading && <p role="status">載入中…</p>}
        {view.error && (
          <p id="access-error" role="alert">
            {view.error}
          </p>
        )}
        {view.message && <p role="status">{view.message}</p>}
        {view.expired ? (
          <a href="/auth/login">重新登入</a>
        ) : (
          <>
            <Button onClick={view.onRetry} disabled={view.busy}>
              重試／重新整理
            </Button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                view.onSearch(search, filter);
              }}
            >
              <Input
                id="search"
                label="搜尋信箱"
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label htmlFor="state">帳號狀態</label>
              <select
                id="state"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">全部</option>
                <option value="pending">待驗證</option>
                <option value="active">可登入</option>
                <option value="disabled">已停用</option>
              </select>
              <Button type="submit">搜尋</Button>
            </form>
            {!view.loading && view.items.length === 0 && (
              <p>沒有可顯示的帳號。</p>
            )}
            <ul>
              {view.items.map((item) => (
                <li key={item.id}>
                  <Button
                    onClick={() => view.onSelect(item.id)}
                    disabled={view.busy}
                  >
                    {item.email}
                  </Button>{" "}
                  · {item.state} · {item.roles.join(", ") || "一般帳號"}
                </li>
              ))}
            </ul>
            <nav aria-label="帳號分頁">
              <Button
                disabled={view.offset === 0}
                onClick={() => view.onPage(Math.max(0, view.offset - 20))}
              >
                上一頁
              </Button>
              <Button
                disabled={view.next === null}
                onClick={() => view.next !== null && view.onPage(view.next)}
              >
                下一頁
              </Button>
            </nav>
            {view.target && (
              <section aria-label="帳號詳情">
                <h2>{view.target.email}</h2>
                <p>
                  狀態：{view.target.state}；信箱
                  {view.target.verified ? "已驗證" : "未驗證"}
                </p>
                <p>現行角色：{view.target.roles.join(", ") || "一般帳號"}</p>
                {(view.canManage || view.canStatus || view.canRevoke) && (
                  <Management key={view.target.id} view={view} />
                )}
                <Button onClick={view.onCancel}>關閉詳情</Button>
              </section>
            )}
            {(view.canManage || view.canStatus || view.canRevoke) && (
              <section>
                <h2>近期密碼驗證</h2>
                <p>敏感操作需在最近五分鐘內驗證密碼。此步驟不是 MFA。</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    view.onReauthenticate(password);
                    setPassword("");
                  }}
                >
                  <Input
                    id="reauth"
                    label="目前密碼"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={view.error ? "access-error" : undefined}
                  />
                  <Button type="submit" disabled={view.busy}>
                    重新驗證密碼
                  </Button>
                </form>
              </section>
            )}
            {view.canAudit && (
              <section>
                <h2>安全稽核</h2>
                <p>理由請勿填入密碼、token 或不必要的個人資料。</p>
                <ul>
                  {view.audit.map((entry) => (
                    <li key={entry.id}>
                      <p>
                        {entry.createdAt} · {entry.event} · {entry.source}
                      </p>
                      <p>
                        操作者 {entry.actorId ?? "未驗證的系統／operator 來源"}
                        ；目標 {entry.targetId ?? "無"}
                      </p>
                      <p>
                        {entry.before} → {entry.after}
                      </p>
                      <p>
                        {entry.reason} · 關聯 {entry.requestId}
                      </p>
                    </li>
                  ))}
                </ul>
                <nav aria-label="稽核分頁">
                  <Button
                    disabled={view.auditOffset === 0}
                    onClick={() =>
                      view.onAuditPage(Math.max(0, view.auditOffset - 20))
                    }
                  >
                    較新事件
                  </Button>
                  <Button
                    disabled={view.auditNext === null}
                    onClick={() =>
                      view.auditNext !== null &&
                      view.onAuditPage(view.auditNext)
                    }
                  >
                    較舊事件
                  </Button>
                </nav>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
function Management({ view }: { view: View }) {
  const [action, setAction] = useState(""),
    [role, setRole] = useState("conference_staff"),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmed) view.onAction(action, role, reason);
      }}
    >
      <label htmlFor="action">管理操作</label>
      <select
        id="action"
        required
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setConfirmed(false);
        }}
      >
        <option value="">請選擇</option>
        {view.canManage && (
          <>
            <option value="grant">授予角色</option>
            <option value="revoke">撤銷角色</option>
          </>
        )}
        {view.canStatus && (
          <>
            <option value="disable">停用帳號</option>
            <option value="restore">恢復帳號</option>
          </>
        )}
        {view.canRevoke && (
          <option value="revoke_sessions">撤銷所有登入</option>
        )}
      </select>
      {(action === "grant" || action === "revoke") && (
        <>
          <label htmlFor="role">角色</label>
          <select
            id="role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setConfirmed(false);
            }}
          >
            {view.roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </>
      )}
      <Input
        id="reason"
        label="操作理由（不含秘密）"
        required
        minLength={3}
        maxLength={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-invalid={!!view.error}
        aria-describedby={
          view.error ? "access-error operation-effect" : "operation-effect"
        }
      />
      <p id="operation-effect">
        目標：{view.target?.email}。{action}{" "}
        {action === "grant" || action === "revoke" ? role : ""}
        。有效變更會撤銷目標所有既有登入；停用也會作廢恢復連結。恢復帳號保留上列未撤銷角色，不恢復舊登入或連結。不可變更自己的角色或停用自己。
      </p>
      <label>
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我已確認目標、變更及登入失效效果
      </label>
      <Button type="submit" disabled={view.busy || !confirmed}>
        確認執行
      </Button>
    </form>
  );
}
