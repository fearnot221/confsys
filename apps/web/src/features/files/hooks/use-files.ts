import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient, createFilesClient, ApiError } from "@confsys/sdk";
import type { FileAsset, FilePurpose } from "@confsys/contracts";
const client = createFilesClient(),
  auth = createAuthClient();
export function useFiles() {
  const queries = useQueryClient(),
    controller = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [expired, setExpired] = useState(false);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const files = useQuery({
    queryKey: ["private", "files", offset],
    queryFn: ({ signal }) => client.list(offset, signal),
    retry: false,
    enabled: !!account.data && !account.error && !expired,
  });
  const expire = () => {
    ++epoch.current;
    controller.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  const fail = (e: unknown) => {
    if (
      e instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
    ) {
      expire();
      return;
    }
    setError(
      e instanceof ApiError && e.code === "CONFLICT"
        ? "檔案尚未可用、狀態已變更或已達儲存上限。"
        : e instanceof ApiError && e.code === "UNSUPPORTED_MEDIA_TYPE"
          ? "僅接受可解析的 PNG、JPEG 或無主動內容 PDF。"
          : "操作失敗，請檢查檔案並重試。",
    );
  };
  useEffect(() => {
    const e = account.error ?? files.error;
    if (
      e instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
    )
      expire();
  }, [account.error, files.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      controller.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(c.signal);
    } catch (e) {
      if (ticket === epoch.current && !c.signal.aborted) fail(e);
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return {
    loading: !expired && (account.isPending || files.isPending),
    busy,
    expired,
    error: error || (files.error ? "載入失敗，請重試。" : ""),
    message,
    items: !expired && !account.error ? (files.data?.items ?? []) : [],
    offset,
    nextOffset: files.data?.nextOffset ?? null,
    canUpload: !!account.data && !account.error && !expired,
    canMedia:
      !expired &&
      (account.data?.user.permissions.includes("files.media.manage") ?? false),
    onPage: setOffset,
    onRefresh: () => {
      void queries.invalidateQueries({ queryKey: ["private", "files"] });
    },
    onUpload: (file: File, purpose: FilePurpose) =>
      void perform(async (signal) => {
        const result = await client.upload(file, purpose, signal);
        if (signal.aborted) return;
        setMessage(
          result.status === "ready"
            ? "檔案已檢查並可使用。"
            : result.status === "rejected"
              ? "檔案未通過安全檢查。"
              : "已隔離，掃描服務尚未完成；請稍後重試掃描。",
        );
        await queries.invalidateQueries({ queryKey: ["private", "files"] });
      }),
    onRetry: (id: string) =>
      void perform(async (signal) => {
        const result = await client.retry(id, signal);
        if (signal.aborted) return;
        setMessage(`掃描狀態：${result.status}`);
        await queries.invalidateQueries({ queryKey: ["private", "files"] });
      }),
    onDownload: (file: FileAsset) =>
      void perform(async (signal) => {
        const blob = await client.download(file.id, signal);
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
  };
}
