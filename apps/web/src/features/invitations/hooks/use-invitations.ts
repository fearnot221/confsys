import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createInvitationClient,
  ApiError,
} from "@confsys/sdk";
import { roleSchema } from "@confsys/contracts";
const auth = createAuthClient(),
  invitations = createInvitationClient();
export function useInvitations() {
  const queries = useQueryClient();
  const [expired, setExpired] = useState(false),
    [offset, setOffset] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    current = useRef<AbortController | null>(null);
  // Keep one key while retrying the same payload after an ambiguous network outcome.
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const canManage =
    !expired &&
    !account.error &&
    !!account.data?.user.permissions.includes("access.roles.manage");
  const list = useQuery({
    queryKey: ["private", "invitations", offset],
    queryFn: ({ signal }) => invitations.list(offset, signal),
    retry: false,
    enabled: canManage,
  });
  const expire = async () => {
    ++epoch.current;
    current.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入或權限已失效，請重新登入。");
    await queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, list.error].some(
        (e) =>
          e instanceof ApiError &&
          (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN"),
      )
    )
      void expire();
  }, [account.error, list.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      current.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<string>) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await work(controller.signal);
      if (ticket !== epoch.current || controller.signal.aborted) return;
      setMessage(text);
      await queries.invalidateQueries({ queryKey: ["private", "invitations"] });
    } catch (e) {
      if (ticket !== epoch.current || controller.signal.aborted) return;
      if (
        e instanceof ApiError &&
        (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN")
      ) {
        await expire();
        return;
      }
      const messages: Record<string, string> = {
        REAUTH_REQUIRED: "請先重新驗證密碼。",
        NOT_FOUND: "收件人必須先完成本研討會註冊與信箱驗證。",
        CONFLICT: "帳號或邀請狀態已變更，請重新確認。",
        SELF_CHANGE: "不能邀請自己變更角色。",
        INVALID_CREDENTIALS: "密碼錯誤。",
      };
      setError(
        e instanceof ApiError
          ? (messages[e.code] ?? "操作失敗，請重試。")
          : "請檢查輸入後重試。",
      );
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return {
    expired,
    roles: roleSchema.options,
    canManage,
    busy,
    message,
    loading: !expired && (account.isPending || (canManage && list.isPending)),
    error:
      error ||
      (account.error || list.error
        ? "讀取失敗，請重試。"
        : !account.isPending && !canManage && !expired
          ? "沒有管理邀請的權限。"
          : ""),
    items: canManage && !list.error ? (list.data?.items ?? []) : [],
    offset,
    next: list.data?.nextOffset ?? null,
    onPage: setOffset,
    onRetry: () => {
      void queries.invalidateQueries({ queryKey: ["private"] });
    },
    onReauthenticate: (password: string) =>
      void perform(async (signal) => {
        await auth.mutate("reauthenticate", { password }, signal);
        return "密碼已驗證；請再次確認邀請操作。";
      }),
    onCreate: (email: string, role: string, reason: string) =>
      void perform(async (signal) => {
        const parsed = roleSchema.parse(role);
        const payload = JSON.stringify({ email, role: parsed, reason });
        if (attempt.current?.payload !== payload)
          attempt.current = { payload, key: crypto.randomUUID() };
        await invitations.create(
          { email, role: parsed, reason, idempotencyKey: attempt.current.key },
          signal,
        );
        return "邀請已建立並排入郵件佇列；不代表郵件已送達。相同表單重試不重複建立。";
      }),
    onRevoke: (id: string, reason: string) =>
      void perform(async (signal) => {
        const result = await invitations.revoke(id, reason, signal);
        return result.changed ? "邀請已撤銷。" : "邀請先前已撤銷。";
      }),
  };
}
