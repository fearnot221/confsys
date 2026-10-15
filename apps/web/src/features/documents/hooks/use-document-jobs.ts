import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createAuthClient,
  createDocumentJobsClient,
} from "@confsys/sdk";
import { documentJob, documentJobList } from "@confsys/contracts";
const client = createDocumentJobsClient(),
  auth = createAuthClient();
const resultLabels: Record<string, string> = {
  INELIGIBLE: "參加資格或製作權限已異動",
  KEY_ROTATED: "報到金鑰已更換，請重新建立",
  OUTPUT_TOO_LARGE: "檔案超過大小限制，請分成較小批次",
  RENDER_FAILED: "無法排版名牌，請檢查姓名或單位是否過長或含不支援字元",
  LEASE_EXPIRED: "工作者曾中斷；已自動恢復或達重試上限",
};
export function useDocumentJobs() {
  const queries = useQueryClient(),
    active = useRef<AbortController | null>(null),
    request = useRef<{ ids: string; key: string } | null>(null),
    [offset, setOffset] = useState(0),
    [expired, setExpired] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const account = useQuery({
      queryKey: ["private", "account"],
      queryFn: ({ signal }) => auth.me(signal),
      enabled: !expired,
      retry: false,
    }),
    canRead =
      !expired &&
      (account.data?.user.permissions.includes("onsite.read") ?? false);
  const list = useQuery({
    queryKey: ["private", "document-jobs", offset],
    queryFn: async ({ signal }) =>
      documentJobList.parse(
        await client.operation("documentJobList", { offset }, signal),
      ),
    enabled: canRead && !account.error,
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.items.some(
        (j) => j.status === "pending" || j.status === "processing",
      )
        ? 2000
        : false,
  });
  function expire() {
    active.current?.abort();
    setExpired(true);
    setBusy(false);
    setError("登入已失效或權限已變更，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  }
  useEffect(() => {
    const e = account.error ?? list.error;
    if (
      e instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
    )
      expire();
  }, [account.error, list.error]);
  useEffect(() => () => active.current?.abort(), []);
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(c.signal);
    } catch (e) {
      if (!c.signal.aborted) {
        if (
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
        )
          expire();
        else
          setError(
            e instanceof ApiError && e.code === "CONFLICT"
              ? "工作尚未完成、報到碼已更換或資料已異動。請重新建立批次。"
              : "操作失敗，請檢查輸入後重試。",
          );
      }
    } finally {
      if (active.current === c) setBusy(false);
    }
  };
  return {
    initialIds:
      new URLSearchParams(window.location.search).get("registrationIds") ?? "",
    loading: !expired && (account.isPending || (canRead && list.isPending)),
    busy,
    expired,
    canRead,
    error: error || (list.error ? "讀取工作清單失敗。" : ""),
    message,
    items: canRead
      ? (list.data?.items ?? []).map((j) => ({
          ...j,
          resultLabel: j.resultCode
            ? (resultLabels[j.resultCode] ?? "製作失敗，請重試或聯繫管理者")
            : null,
        }))
      : [],
    offset,
    nextOffset: list.data?.nextOffset ?? null,
    onPage: setOffset,
    onRefresh: () =>
      void queries.invalidateQueries({
        queryKey: ["private", "document-jobs"],
      }),
    onCreate: (registrationIds: string[]) =>
      void perform(async (signal) => {
        const ids = JSON.stringify([...registrationIds].sort());
        if (request.current?.ids !== ids)
          request.current = { ids, key: crypto.randomUUID() };
        const result = documentJob.parse(
          await client.operation(
            "documentJobCreate",
            { registrationIds, idempotencyKey: request.current.key },
            signal,
          ),
        );
        if (signal.aborted) return;
        request.current = null;
        setMessage(`已排入 ${result.count} 張名牌。工作者完成後可下載。`);
        await queries.invalidateQueries({
          queryKey: ["private", "document-jobs"],
        });
      }),
    onDownload: (id: string) =>
      void perform(async (signal) => {
        const blob = await client.download(id, signal);
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `badges-${id}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
  };
}
