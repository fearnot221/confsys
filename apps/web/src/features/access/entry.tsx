import {useEffect} from "react";
import { useAccess } from "./hooks/use-access.js";
import { AccessScreen } from "./components/access-screen.js";
import { useInstance } from "../instance/hooks/use-instance.js";
export function AccessApp() {
  const state = useAccess();
  const instance = useInstance();
  useEffect(() => {
    document.documentElement.lang = "zh-Hant";
    document.title = `${instance.data?.conferenceName ?? "研討會"} · 帳號管理`;
  }, [instance.data]);
  if (!instance.data)
    return (
      <main>
        <p role={instance.error ? "alert" : "status"}>
          {instance.error ? "無法取得研討會設定。" : "載入研討會…"}
        </p>
        <button onClick={() => void instance.refetch()}>重試</button>
      </main>
    );
  return (
    <AccessScreen {...state} conferenceName={instance.data.conferenceName} />
  );
}
