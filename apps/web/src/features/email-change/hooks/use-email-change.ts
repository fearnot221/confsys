import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createAuthClient } from "@confsys/sdk";
const client = createAuthClient();
export function useEmailChange() {
  const queries = useQueryClient();
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
    return () => controller.current?.abort();
  }, [token]);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => client.me(signal),
    retry: false,
    enabled: !complete,
  });
  return {
    confirming: !!token,
    busy,
    complete,
    message,
    error:
      error ||
      (account.error ? "請先以原信箱登入，再重新開啟確認郵件中的連結。" : ""),
    email: complete ? undefined : account.data?.user.email,
    async onSubmit(email: string, password: string) {
      controller.current?.abort();
      const pending = new AbortController();
      controller.current = pending;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        await client.mutate("reauthenticate", { password }, pending.signal);
        await client.mutate(
          token ? "emailChangeConfirm" : "emailChangeRequest",
          token ? { token } : { email },
          pending.signal,
        );
        if (pending.signal.aborted) return;
        if (token) {
          setComplete(true);
          await queries.cancelQueries({ queryKey: ["private"] });
          queries.removeQueries({ queryKey: ["private"] });
          setMessage(
            "新信箱確認完成，所有原有登入已撤銷。請以新信箱重新登入。",
          );
        } else
          setMessage(
            "若新信箱符合條件，確認信寄送要求已受理。請在 30 分鐘內開啟郵件並確認；目前信箱尚未變更。",
          );
      } catch (e) {
        if (!pending.signal.aborted)
          setError(
            e instanceof ApiError && e.code === "INVALID_TOKEN"
              ? "確認連結已失效或不屬於目前帳號，請重新申請。"
              : e instanceof ApiError && e.code === "CONFLICT"
                ? "此信箱目前無法使用，請重新申請其他信箱。"
                : "操作未完成，請確認目前帳號、密碼與網路後重試。",
          );
      } finally {
        if (!pending.signal.aborted) setBusy(false);
      }
    },
  };
}
