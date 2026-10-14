import { useState } from "react";
import { Button, Input, Layout } from "@confsys/ui";
type Props = {
  conferenceName: string;
  confirming: boolean;
  busy: boolean;
  complete: boolean;
  message: string;
  error: string;
  email: string | undefined;
  onSubmit: (email: string, password: string) => Promise<void>;
};
export function EmailChangeScreen(p: Props) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  return (
    <Layout>
      <header>
        <a href="/">{p.conferenceName}</a>
        <a href="/auth/account">我的帳號</a>
      </header>
      <section className="auth-panel" aria-busy={p.busy}>
        <h1>{p.confirming ? "確認新信箱" : "變更登入信箱"}</h1>
        <p>
          確認新信箱後，本帳號所有既有登入會撤銷。報名與投稿仍屬於同一本地帳號；更換信箱不會取得其他作者的資源。
        </p>
        {p.email && <p>目前信箱：{p.email}</p>}
        {p.error && <p role="alert">{p.error}</p>}
        {p.message && <p role="status">{p.message}</p>}
        {p.email && !p.complete && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.onSubmit(email, password).finally(() => setPassword(""));
            }}
          >
            {!p.confirming && (
              <Input
                label="新電子郵件"
                id="new-email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            <Input
              label="目前密碼"
              id="current-password"
              type="password"
              required
              maxLength={512}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={p.busy}>
              {p.busy
                ? "處理中…"
                : p.confirming
                  ? "確認變更並撤銷既有登入"
                  : "寄送新信箱確認信"}
            </Button>
          </form>
        )}
        <p>
          <a href="/auth/login">登入</a>
        </p>
      </section>
    </Layout>
  );
}
