import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createInvitationClient,
  ApiError,
} from "@confsys/sdk";
const auth = createAuthClient(),
  invitations = createInvitationClient();
export function useInvitationAcceptance() {
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  const current = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const queries = useQueryClient();
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !complete,
  });
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return () => {
      ++epoch.current;
      current.current?.abort();
    };
  }, []);
  return {
    busy,
    complete,
    hasToken: token.length > 0,
    email: complete ? "" : (account.data?.user.email ?? ""),
    error:
      error ||
      (account.error
        ? "請使用收到邀請的本地帳號登入，再重新開啟邀請郵件連結。"
        : ""),
    onAccept: (password: string) => {
      const controller = new AbortController();
      current.current?.abort();
      current.current = controller;
      const ticket = ++epoch.current;
      setBusy(true);
      setError("");
      void (async () => {
        try {
          await auth.mutate("reauthenticate", { password }, controller.signal);
          await invitations.accept(token, controller.signal);
          if (ticket !== epoch.current || controller.signal.aborted) return;
          setToken("");
          setComplete(true);
          await queries.cancelQueries({ queryKey: ["private"] });
          queries.removeQueries({ queryKey: ["private"] });
        } catch (e) {
          if (ticket !== epoch.current || controller.signal.aborted) return;
          const messages: Record<string, string> = {
            INVALID_TOKEN:
              "邀請無效、已使用、已過期，或不屬於此帳號。請向管理員確認。",
            INVALID_CREDENTIALS: "密碼錯誤。",
            SESSION_EXPIRED: "登入已失效。請重新登入後開啟郵件連結。",
            RATE_LIMITED: "嘗試過多，請稍後再試。",
          };
          setError(
            e instanceof ApiError
              ? (messages[e.code] ?? "接受邀請失敗，請重試。")
              : "服務暫時無法使用，請重試。",
          );
          if (e instanceof ApiError && e.code === "SESSION_EXPIRED") {
            await queries.cancelQueries({ queryKey: ["private"] });
            queries.removeQueries({ queryKey: ["private"] });
          }
        } finally {
          if (ticket === epoch.current) setBusy(false);
        }
      })();
    },
  };
}
