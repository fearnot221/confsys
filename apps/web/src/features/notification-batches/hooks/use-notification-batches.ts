import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createNotificationBatchClient,
  ApiError,
} from "@confsys/sdk";
const auth = createAuthClient(),
  client = createNotificationBatchClient();
export function useNotificationBatches() {
  const queries = useQueryClient(),
    request = useRef<AbortController | null>(null),
    epoch = useRef(0),
    retryAttempts = useRef(new Map<string, { reason: string; key: string }>()),
    attempt = useRef<{ payload: string; key: string } | null>(null);
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [expired, setExpired] = useState(false);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const canManage =
    !expired &&
    !account.error &&
    !!account.data?.user.permissions.includes("notifications.manage");
  const batches = useQuery({
    queryKey: ["private", "notification-batches", offset],
    queryFn: ({ signal }) => client.list(offset, signal),
    retry: false,
    enabled: canManage,
  });
  const expire = () => {
    ++epoch.current;
    request.current?.abort();
    setExpired(true);
    setBusy(false);
    setError("登入或權限已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, batches.error].some(
        (e) =>
          e instanceof ApiError &&
          (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN"),
      )
    )
      expire();
  }, [account.error, batches.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      request.current?.abort();
    },
    [],
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
          queryKey: ["private", "notification-batches"],
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
            : "資料或連線有誤，請檢查收件人與內容。",
        );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return {
    canManage,
    busy,
    error:
      error ||
      ([account.error, batches.error].some(Boolean)
        ? "無法載入通知批次。"
        : ""),
    message,
    offset,
    items: canManage ? (batches.data?.items ?? []) : [],
    nextOffset: canManage ? (batches.data?.nextOffset ?? null) : null,
    page: setOffset,
    refresh: () =>
      void queries.invalidateQueries({
        queryKey: ["private", "notification-batches"],
      }),
    reauthenticate: (password: string) =>
      run(
        (signal) => auth.mutate("reauthenticate", { password }, signal),
        "密碼已驗證。",
      ),
    create: (recipientText: string, subject: string, text: string) =>
      run((signal) => {
        const recipientIds = recipientText
            .split(/[\s,;]+/)
            .map((v) => v.trim())
            .filter(Boolean)
            .sort(),
          payload = JSON.stringify({ recipientIds, subject, text });
        if (attempt.current?.payload !== payload)
          attempt.current = { payload, key: crypto.randomUUID() };
        return client.create(
          { recipientIds, subject, text, idempotencyKey: attempt.current.key },
          signal,
        );
      }, "通知批次已保存並排入佇列；不代表已送達。"),
    retry: (id: string, reason: string) =>
      run((signal) => {
        let attempt = retryAttempts.current.get(id);
        if (!attempt || attempt.reason !== reason) {
          attempt = { reason, key: crypto.randomUUID() };
          retryAttempts.current.set(id, attempt);
        }
        return client.retry(
          { id, reason, idempotencyKey: attempt.key },
          signal,
        );
      }, "已建立明確失敗收件人的重試批次；原寄送紀錄保留，不代表已送達。"),
    cancel: (id: string) =>
      run(
        (signal) => client.cancel(id, signal),
        "已要求取消尚未開始的寄送；已開始或已接受的郵件無法撤回。",
      ),
  };
}
