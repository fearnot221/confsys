import { useState } from "react";
type Props = {
  busy: boolean;
  complete: boolean;
  hasToken: boolean;
  email: string;
  error: string;
  onAccept: (password: string) => void;
};
export function InvitationAcceptanceScreen(props: Props) {
  const [password, setPassword] = useState("");
  return (
    <main>
      <h1>接受本研討會角色邀請</h1>
      {props.error && <p role="alert">{props.error}</p>}
      {props.complete ? (
        <>
          <p role="status">
            已接受邀請。原有登入已失效，請重新登入使用新的權限。
          </p>
          <a href="/auth/login">重新登入</a>
        </>
      ) : (
        <>
          <p>只有收到邀請且已驗證的本地帳號能接受。開啟郵件不會自動授權。</p>
          {!props.hasToken && (
            <p role="alert">缺少邀請代碼，請重新開啟邀請郵件的完整連結。</p>
          )}
          {!props.email ? (
            <p>
              <a href="/auth/login">先登入</a>，再重新開啟邀請郵件連結。
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                props.onAccept(password);
                setPassword("");
              }}
            >
              <p>目前帳號：{props.email}</p>
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
              <button disabled={props.busy || !props.hasToken}>
                確認接受角色邀請
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
