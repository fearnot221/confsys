import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createExportJobsClient,
  ApiError,
} from "@confsys/sdk";
import type { ExportJob } from "@confsys/contracts";
const auth = createAuthClient(),
  client = createExportJobsClient();
export function useExportJobs() {
  const queries = useQueryClient(),
    request = useRef<AbortController | null>(null),
    epoch = useRef(0),
    attempt = useRef<{ kind: string; key: string } | null>(null);
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [expired, setExpired] = useState(false),
    [download, setDownload] = useState<{ url: string; name: string } | null>(
      null,
    );
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const canExport =
    !expired &&
    !account.error &&
    !!account.data?.user.permissions.includes("reporting.export");
  const jobs = useQuery({
    queryKey: ["private", "export-jobs", offset],
    queryFn: ({ signal }) => client.list(offset, signal),
    retry: false,
    enabled: canExport,
  });
  const clearDownload = () =>
    setDownload((value) => {
      if (value) URL.revokeObjectURL(value.url);
      return null;
    });
  const expire = () => {
    ++epoch.current;
    request.current?.abort();
    setExpired(true);
    setBusy(false);
    clearDownload();
    setError("登入或權限已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, jobs.error].some(
        (e) =>
          e instanceof ApiError &&
          (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN"),
      )
    )
      expire();
  }, [account.error, jobs.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      request.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  async function run(
    work: (signal: AbortSignal) => Promise<unknown>,
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
      if (generation === epoch.current) {
        setMessage(success);
        await queries.invalidateQueries({
          queryKey: ["private", "export-jobs"],
        });
      }
    } catch (e) {
      if (generation !== epoch.current) return;
      if (
        e instanceof ApiError &&
        (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN")
      )
        expire();
      else
        setError(
          e instanceof ApiError
            ? `操作未完成：${e.code}`
            : "操作未完成，請稍後重新整理。",
        );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return {
    canExport,
    busy,
    error:
      error ||
      ([account.error, jobs.error].some(Boolean) ? "無法載入匯出工作。" : ""),
    message,
    offset,
    items: canExport ? (jobs.data?.items ?? []) : [],
    nextOffset: canExport ? (jobs.data?.nextOffset ?? null) : null,
    download: canExport ? download : null,
    page: setOffset,
    refresh: () =>
      void queries.invalidateQueries({ queryKey: ["private", "export-jobs"] }),
    reauthenticate: (password: string) =>
      run(
        (signal) => auth.mutate("reauthenticate", { password }, signal),
        "密碼已驗證。",
      ),
    create: (kind: "registrations" | "submissions" | "emails") =>
      run((signal) => {
        if (attempt.current?.kind !== kind)
          attempt.current = { kind, key: crypto.randomUUID() };
        return client.create(kind, attempt.current.key, signal);
      }, "匯出工作已保存；請重新整理查看背景處理結果。"),
    newRequest: () => {
      attempt.current = null;
      clearDownload();
      setMessage("已準備新的匯出要求；請明確建立。");
    },
    fetchDownload: (job: ExportJob) =>
      run(async (signal) => {
        clearDownload();
        const blob = await client.download(job.id, signal);
        if (!signal.aborted)
          setDownload({
            url: URL.createObjectURL(blob),
            name: `export-${job.kind}-${job.id}.csv`,
          });
      }, "權限與檔案完整性已驗證，可以下載。"),
  };
}
