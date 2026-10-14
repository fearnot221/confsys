import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient, ApiError } from "@confsys/sdk";
import { accessMutationInput, type DirectoryAccount } from "@confsys/contracts";
const client = createAuthClient();
export function useAccess() {
  const queries = useQueryClient();
  const [expired, setExpired] = useState(false),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [auditOffset, setAuditOffset] = useState(0);
  const [state, setState] = useState<
    "pending" | "active" | "disabled" | undefined
  >();
  const [target, setTarget] = useState<DirectoryAccount | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    current = useRef<AbortController | null>(null);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => client.me(signal),
    retry: false,
    enabled: !expired,
  });
  const permissions = account.data?.user.permissions ?? [];
  const canRead =
    !expired &&
    !account.error &&
    permissions.includes("accounts.directory.read");
  const canAudit = canRead && permissions.includes("security_audit.read");
  const directory = useQuery({
    queryKey: ["private", "directory", search, state, offset],
    queryFn: ({ signal }) =>
      client.directory({ search, offset, ...(state ? { state } : {}) }, signal),
    retry: false,
    enabled: canRead,
  });
  const roles = useQuery({
    queryKey: ["private", "roles"],
    queryFn: ({ signal }) => client.roles(signal),
    retry: false,
    enabled: canRead,
  });
  const audit = useQuery({
    queryKey: ["private", "audit", auditOffset],
    queryFn: ({ signal }) => client.audit(auditOffset, signal),
    retry: false,
    enabled: canAudit,
  });
  const expire = async () => {
    ++epoch.current;
    current.current?.abort();
    setExpired(true);
    setTarget(null);
    setBusy(false);
    setMessage("");
    setError("登入已逾期或已被撤銷，請重新登入。");
    await queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  const failure = (value: unknown) => {
    if (value instanceof ApiError && value.code === "SESSION_EXPIRED") {
      void expire();
      return;
    }
    const messages: Record<string, string> = {
      FORBIDDEN: "沒有執行此操作的權限。",
      REAUTH_REQUIRED: "請先重新驗證密碼，再確認操作。",
      LAST_ADMIN: "必須保留至少一位可登入的管理員。",
      SELF_CHANGE: "不可變更自己的角色或停用自己。",
      CONFLICT: "目標帳號狀態不允許此操作。",
      INVALID_CREDENTIALS: "密碼驗證失敗。",
      RATE_LIMITED: "嘗試次數過多，請稍後重試。",
      NOT_FOUND: "找不到此帳號。",
    };
    setError(
      value instanceof ApiError
        ? (messages[value.code] ?? "操作失敗，請檢查輸入並重試。")
        : "服務或輸入無法處理，請重試。",
    );
  };
  useEffect(() => {
    const errors = [account.error, directory.error, roles.error, audit.error];
    if (
      errors.some((e) => e instanceof ApiError && e.code === "SESSION_EXPIRED")
    )
      void expire();
  }, [account.error, directory.error, roles.error, audit.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      current.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (ticket === epoch.current && !controller.signal.aborted) failure(e);
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return {
    email: expired ? "" : (account.data?.user.email ?? ""),
    expired,
    loading:
      !expired &&
      (account.isPending ||
        (canRead && (directory.isPending || roles.isPending))),
    error:
      error ||
      ([directory.error, roles.error, audit.error].some(Boolean)
        ? "讀取失敗，請重試。"
        : !account.isPending && !canRead && !expired
          ? "沒有帳號目錄權限。"
          : ""),
    message,
    busy,
    items: canRead && !directory.error ? (directory.data?.items ?? []) : [],
    target: canRead ? target : null,
    roles: roles.data?.items.map((item) => item.role) ?? [],
    canManage: canRead && permissions.includes("access.roles.manage"),
    canStatus: canRead && permissions.includes("accounts.status.manage"),
    canRevoke: canRead && permissions.includes("accounts.sessions.revoke"),
    canAudit,
    audit: canAudit && !audit.error ? (audit.data?.items ?? []) : [],
    offset,
    next: directory.data?.nextOffset ?? null,
    auditOffset,
    auditNext: audit.data?.nextOffset ?? null,
    onSearch: (value: string, filter: string) => {
      setSearch(value);
      setState(
        filter === "active" || filter === "pending" || filter === "disabled"
          ? filter
          : undefined,
      );
      setOffset(0);
      setTarget(null);
    },
    onPage: (value: number) => {
      setOffset(value);
      setTarget(null);
    },
    onAuditPage: setAuditOffset,
    onSelect: (id: string) =>
      void perform(async (signal) => {
        const value = await client.detail(id, signal);
        if (!signal.aborted) setTarget(value);
      }),
    onCancel: () => setTarget(null),
    onRetry: () => {
      setError("");
      void queries.invalidateQueries({ queryKey: ["private"] });
    },
    onReauthenticate: (password: string) =>
      void perform(async (signal) => {
        await client.mutate("reauthenticate", { password }, signal);
        if (!signal.aborted) setMessage("密碼已重新驗證，請再次確認管理操作。");
      }),
    onAction: (action: string, role: string, reason: string) =>
      void perform(async (signal) => {
        if (!target) return;
        const input = accessMutationInput.parse({
          action,
          reason,
          ...(action === "grant" || action === "revoke" ? { role } : {}),
        });
        const result = await client.manage(target.id, input, signal);
        if (signal.aborted) return;
        if (target.id === account.data?.user.id) {
          await expire();
          return;
        }
        setMessage(
          result.changed
            ? "操作完成；目標原有登入已失效。"
            : "無變更；沒有重複撤銷登入。",
        );
        setTarget(null);
        await queries.invalidateQueries({ queryKey: ["private"] });
      }),
  };
}
