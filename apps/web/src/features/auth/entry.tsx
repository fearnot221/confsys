import {useEffect} from "react";
import { useInstance } from "../instance/hooks/use-instance.js";
import { useAuth } from "./hooks/use-auth.js";
import { AuthScreen } from "./components/auth-screen.js";
export function AuthApp() {
  const mode = window.location.pathname.split("/")[2] ?? "login";
  const state = useAuth(mode);
  const instance = useInstance();
  useEffect(() => {
    document.documentElement.lang = "zh-Hant";
    document.title = instance.data
      ? `${instance.data.conferenceName} · 帳號與安全`
      : "載入研討會";
  }, [instance.data]);
  if (!instance.data)
    return (
      <main className="layout">
        <p role={instance.error ? "alert" : "status"}>
          {instance.error ? "無法取得研討會設定。" : "載入研討會…"}
        </p>
        {instance.error && (
          <button onClick={() => void instance.refetch()}>重試</button>
        )}
      </main>
    );
  return (
    <AuthScreen {...state} conferenceName={instance.data.conferenceName} />
  );
}
