import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createReportingClient,
  ApiError,
} from "@confsys/sdk";
import type { AuthorPreview, ExportPage } from "@confsys/contracts";
const auth = createAuthClient(),
  client = createReportingClient();
export function useReporting() {
  const queries = useQueryClient(),
    request = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const [exportKind, setExportKind] = useState<
    "registrations" | "submissions" | "emails"
  >("registrations");
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [expired, setExpired] = useState(false),
    [preview, setPreview] = useState<AuthorPreview | null>(null),
    [exported, setExported] = useState<ExportPage | null>(null);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const ready = !!account.data && !account.error && !expired,
    permissions = ready ? (account.data?.user.permissions ?? []) : [];
  const canRead = permissions.includes("reporting.read"),
    canExport = permissions.includes("reporting.export"),
    canPreview = permissions.includes("authors.preview");
  const feed = useQuery({
    queryKey: ["private", "notifications", offset],
    queryFn: ({ signal }) => client.notifications(offset, signal),
    retry: false,
    enabled: ready,
  });
  const stats = useQuery({
    queryKey: ["private", "reporting", "stats"],
    queryFn: ({ signal }) => client.stats(signal),
    retry: false,
    enabled: canRead,
  });
  const expire = () => {
    ++epoch.current;
    request.current?.abort();
    setExpired(true);
    setPreview(null);
    setExported(null);
    setBusy(false);
    setError("登入已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, feed.error, stats.error].some(
        (e) => e instanceof ApiError && e.code === "SESSION_EXPIRED",
      )
    )
      expire();
  }, [account.error, feed.error, stats.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      request.current?.abort();
    },
    [],
  );
  async function run(
    work: (signal: AbortSignal) => Promise<void>,
    success: string,
  ) {
    if (busy) return;
    const controller = new AbortController(),
      generation = ++epoch.current;
    request.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(controller.signal);
      if (generation === epoch.current) setMessage(success);
    } catch (e) {
      if (generation !== epoch.current) return;
      if (e instanceof ApiError && e.code === "SESSION_EXPIRED") expire();
      else
        setError(
          e instanceof ApiError
            ? `操作未完成：${e.code}`
            : "操作未完成，請稍後再試。",
        );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return {
    ready,
    busy,
    error:
      error ||
      ([account.error, feed.error, stats.error].some(Boolean)
        ? "無法載入資料，請確認登入與權限。"
        : ""),
    message,
    canRead,
    canExport,
    canPreview,
    feed: ready ? feed.data : undefined,
    stats: canRead ? stats.data : undefined,
    preview: canPreview ? preview : null,
    exported: canExport ? exported : null,
    offset,
    exportKind,
    page: (next: number) => setOffset(next),
    read: (id: string) =>
      run(async (signal) => {
        await client.read(id, signal);
        await queries.invalidateQueries({
          queryKey: ["private", "notifications"],
        });
      }, "已標示為已讀。"),
    exportPage: (
      kind: "registrations" | "submissions" | "emails",
      next: number,
      purpose: string,
    ) =>
      run(async (signal) => {
        setExported(null);
        const result = await client.export(kind, next, purpose, signal);
        if (!signal.aborted) {
          setExported(result);
          setExportKind(kind);
        }
      }, "匯出本頁完成；更多資料請繼續下一頁。"),
    previewAuthor: (userId: string, reason: string) =>
      run(async (signal) => {
        setPreview(null);
        const result = await client.preview(userId, reason, signal);
        if (!signal.aborted) setPreview(result);
      }, "已建立唯讀預覽，操作帳號保持不變。"),
    reauthenticate: (password: string) =>
      run(async (signal) => {
        await auth.mutate("reauthenticate", { password }, signal);
      }, "密碼已驗證，請再次執行所需操作。"),
    closePreview: () => setPreview(null),
  };
}
