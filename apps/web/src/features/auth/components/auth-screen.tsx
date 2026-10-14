import { useState } from "react";
import { Button, Input, Layout } from "@confsys/ui";
export type AuthView = {
  conferenceName: string;
  canDirectory?: boolean;
  canSite?: boolean;
  userId?: string | undefined;
  mode: string;
  busy: boolean;
  loading: boolean;
  message: string;
  error: string;
  email: string | undefined;
  onSubmit: (
    email: string,
    password: string,
    override?: "resend",
  ) => Promise<void>;
  onRetry: () => void;
};
const titles: Record<string, string> = {
  register: "建立本研討會帳號",
  waiting: "等待信箱驗證",
  verify: "確認信箱並設定密碼",
  login: "登入",
  forgot: "忘記密碼",
  reset: "設定新密碼",
  account: "我的帳號",
};
export function AuthScreen(view: AuthView) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordForm = ["login", "verify", "reset"].includes(view.mode);
  const emailForm = ["login", "register", "waiting", "forgot"].includes(
    view.mode,
  );
  const complete = !!view.message && ["verify", "reset"].includes(view.mode);
  return (
    <Layout>
      <header>
        <a className="brand" href="/">
          {view.conferenceName}
        </a>
        <a href="/auth/account">我的帳號</a>
      </header>
      <section className="auth-panel" aria-busy={view.busy || view.loading}>
        <p className="eyebrow">帳號與安全 / ACCOUNT</p>
        <h1>
          {view.mode === "login"
            ? `登入 ${view.conferenceName}`
            : (titles[view.mode] ?? titles.login)}
        </h1>
        <p>本帳號僅用於本研討會；其他研討會需另外註冊。</p>
        {view.loading && <p role="status">正在確認登入狀態…</p>}
        {view.error && (
          <p id="auth-error" role="alert">
            {view.error}
          </p>
        )}
        {view.message && <p role="status">{view.message}</p>}
        {view.mode === "account" ? (
          <>
            {view.email && (
              <>
                {view.canSite && (
                  <p>
                    <a href="/admin/site">會議設定與官網</a>
                  </p>
                )}
                {view.canDirectory && <a href="/access/accounts">帳號管理</a>}
                <p>已驗證的信箱</p>
                <p data-testid="account-email">{view.email}</p>
                <p>本地帳號 ID：{view.userId}</p>
              </>
            )}
            {!view.loading && (
              <>
                <Button
                  onClick={() => void view.onSubmit("", "")}
                  disabled={view.busy}
                >
                  {view.busy ? "處理中…" : "登出"}
                </Button>{" "}
                <Button onClick={view.onRetry} disabled={view.busy}>
                  重新確認
                </Button>
              </>
            )}
          </>
        ) : (
          !complete && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void view.onSubmit(email, password);
              }}
            >
              {emailForm && (
                <Input
                  label="電子郵件"
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={view.error ? "auth-error" : undefined}
                  aria-invalid={!!view.error}
                />
              )}
              {passwordForm && (
                <>
                  <Input
                    label={view.mode === "login" ? "密碼" : "新密碼"}
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={
                      view.mode === "login"
                        ? "current-password"
                        : "new-password"
                    }
                    required
                    maxLength={512}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-describedby={
                      view.error ? "password-help auth-error" : "password-help"
                    }
                    aria-invalid={!!view.error}
                  />
                  <p id="password-help">
                    15–128 個字元，可使用空白與
                    Unicode。請避免常見或重複的密碼。
                  </p>
                </>
              )}
              <Button type="submit" disabled={view.busy}>
                {view.busy
                  ? "處理中…"
                  : view.mode === "login"
                    ? "登入"
                    : view.mode === "verify"
                      ? "確認並啟用帳號"
                      : view.mode === "reset"
                        ? "重設密碼"
                        : "申請郵件"}
              </Button>
              {view.mode === "register" && view.message && (
                <Button
                  disabled={view.busy}
                  onClick={() => void view.onSubmit(email, "", "resend")}
                >
                  重寄驗證信
                </Button>
              )}
            </form>
          )
        )}
        <nav aria-label="帳號操作">
          <a href="/auth/login">登入</a>
          <a href="/auth/register">建立帳號</a>
          <a href="/auth/waiting">重寄驗證信</a>
          <a href="/auth/forgot">忘記密碼</a>
        </nav>
      </section>
      <footer>開發環境郵件由 Mailpit 捕捉；請只使用合成測試信箱。</footer>
    </Layout>
  );
}
