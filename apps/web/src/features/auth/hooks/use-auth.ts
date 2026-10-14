import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createAuthClient } from "@confsys/sdk";
import type { AuthOperation } from "@confsys/contracts";
const client = createAuthClient();
const errorText = (error: unknown) => {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "信箱或密碼不正確，請重新輸入。",
      SESSION_EXPIRED: "尚未登入或登入已逾期，請重新登入。",
      INVALID_TOKEN: "連結已過期、已使用或無效。請重新申請郵件。",
      WEAK_PASSWORD:
        "請使用 15–128 個字元的密碼，避免常見、重複或與信箱相同的密碼。",
      RATE_LIMITED: "嘗試次數過多，請於 15 分鐘後再試。",
      SERVICE_UNAVAILABLE: "服務暫時無法使用，請稍後重試。",
      CSRF_REJECTED: "安全驗證失敗，請重試或重新整理頁面。",
      INVALID_REQUEST: "請檢查信箱、連結及密碼格式。",
    };
    return messages[error.code] ?? "無法完成操作，請稍後重試。";
  }
  return "無法完成操作，請檢查輸入與網路連線後重試。";
};
export function useAuth(mode: string) {
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);
  const current = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => client.me(signal),
    enabled: mode === "account" && !hidden,
    retry: false,
    staleTime: 0,
  });
  useEffect(
    () => () => {
      epoch.current++;
      current.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (account.error instanceof ApiError && account.error.status === 401) {
      setError(errorText(account.error));
      setHidden(true);
      void queries.cancelQueries({ queryKey: ["private"] });
      queries.removeQueries({ queryKey: ["private"] });
    }
  }, [account.error, queries]);
  const submit = async (
    email: string,
    password: string,
    override?: "resend",
  ) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    // Cancel before removal; a late response cannot rehydrate the previous account.
    await queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
    setHidden(true);
    const operation: AuthOperation =
      override ??
      (mode === "account"
        ? "logout"
        : mode === "waiting"
          ? "resend"
          : mode === "register" ||
              mode === "verify" ||
              mode === "reset" ||
              mode === "forgot"
            ? mode
            : "login");
    try {
      const input =
        operation === "logout"
          ? {}
          : operation === "verify" || operation === "reset"
            ? {
                token:
                  new URLSearchParams(window.location.hash.slice(1)).get(
                    "token",
                  ) ?? "",
                password,
              }
            : operation === "login"
              ? { email, password }
              : { email };
      await client.mutate(operation, input, controller.signal);
      if (ticket !== epoch.current) return;
      if (operation === "login") {
        window.location.assign("/auth/account");
        return;
      }
      if (operation === "logout") {
        window.location.assign("/auth/login");
        return;
      }
      if (operation === "verify" || operation === "reset") {
        window.history.replaceState(null, "", window.location.pathname);
        setMessage(
          operation === "verify"
            ? "信箱驗證完成，請使用新密碼登入。"
            : "密碼已重設，既有登入已撤銷。請重新登入。",
        );
      } else
        setMessage(
          "若此信箱符合條件，寄送要求已受理。請至郵件信箱查看；尚不代表郵件已送達。",
        );
    } catch (error) {
      if (ticket === epoch.current && !controller.signal.aborted)
        setError(errorText(error));
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return {
    mode,
    busy,
    message,
    error: error || (account.error && !hidden ? errorText(account.error) : ""),
    loading: mode === "account" && account.isPending && !hidden,
    email: !hidden && !account.error ? account.data?.user.email : undefined,
    userId: !hidden && !account.error ? account.data?.user.id : undefined,
    canDirectory:
      !hidden &&
      !account.error &&
      !!account.data?.user.permissions.includes("accounts.directory.read"),
    onSubmit: submit,
    onRetry: () => {
      setError("");
      setHidden(false);
      void account.refetch();
    },
  };
}
