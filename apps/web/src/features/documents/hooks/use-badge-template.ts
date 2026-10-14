import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createBadgeTemplateClient,
  ApiError,
} from "@confsys/sdk";
import {
  badgeTemplateDocument,
  type BadgeTemplateDocument,
} from "@confsys/contracts";
const client = createBadgeTemplateClient(),
  auth = createAuthClient();
export function useBadgeTemplate() {
  const queries = useQueryClient(),
    active = useRef<AbortController | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const canRead =
      !expired &&
      (account.data?.user.permissions.includes("onsite.read") ?? false),
    canManage =
      !expired &&
      (account.data?.user.permissions.includes("documents.template.manage") ??
        false);
  const current = useQuery({
    queryKey: ["private", "badge-template"],
    queryFn: ({ signal }) => client.get(signal),
    retry: false,
    enabled: canRead,
  });
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const failure = account.error ?? current.error;
    if (
      failure instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(failure.code)
    ) {
      active.current?.abort();
      setExpired(true);
      void queries.cancelQueries({ queryKey: ["private"] });
      queries.removeQueries({ queryKey: ["private"] });
    }
  }, [account.error, current.error, queries]);
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await work(c.signal);
    } catch (e) {
      if (!c.signal.aborted) {
        if (
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
        ) {
          setExpired(true);
          void queries.cancelQueries({ queryKey: ["private"] });
          queries.removeQueries({ queryKey: ["private"] });
          setError("登入已失效或權限已變更。");
        } else
          setError(
            e instanceof ApiError && e.code === "CONFLICT"
              ? "模板版本已變更，請重新載入後編輯。"
              : "操作失敗；請檢查文字長度與支援字元後重試。",
          );
      }
    } finally {
      if (active.current === c) setBusy(false);
    }
  };
  return {
    current: canRead ? current.data : undefined,
    canRead,
    canManage,
    busy,
    loading: account.isPending || (canRead && current.isPending),
    error:
      (!account.isPending && !canRead
        ? "登入已失效或沒有名牌模板讀取權限。"
        : "") ||
      error ||
      (account.error || current.error
        ? "無法讀取模板，請確認登入與權限。"
        : ""),
    message,
    save: (document: BadgeTemplateDocument) =>
      perform(async (signal) => {
        const result = await client.save(
          {
            expectedVersion: current.data?.version ?? 0,
            document: badgeTemplateDocument.parse(document),
          },
          signal,
        );
        queries.setQueryData(["private", "badge-template"], result);
        setMessage(`已儲存模板版本 ${result.version}；新的批次將使用此版本。`);
      }),
    reload: () => current.refetch(),
    preview: () =>
      perform(async (signal) => {
        const blob = await client.preview(signal),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "badge-template-preview.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("已下載目前儲存版本的合成預覽 PDF。");
      }),
  };
}
