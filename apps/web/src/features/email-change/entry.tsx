import { useInstance } from "../instance/hooks/use-instance.js";
import { useEmailChange } from "./hooks/use-email-change.js";
import { EmailChangeScreen } from "./components/email-change-screen.js";
export default function EmailChangeApp() {
  const instance = useInstance();
  const state = useEmailChange();
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
    <EmailChangeScreen
      conferenceName={instance.data.conferenceName}
      {...state}
    />
  );
}
