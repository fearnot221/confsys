import { roleSchema } from "@confsys/contracts";
import type {
  NotificationAudience,
  NotificationAudiencePreview,
  NotificationBatchOptions,
  NotificationTemplateDraft,
} from "@confsys/contracts";
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
    templateAttempt = useRef<{ payload: string; key: string } | null>(null),
    attempt = useRef<{ payload: string; key: string } | null>(null);
  const [preview, setPreview] = useState<NotificationAudiencePreview | null>(
      null,
    ),
    [previewFilters, setPreviewFilters] = useState<NotificationAudience | null>(
      null,
    ),
    [templateOffset, setTemplateOffset] = useState(0),
    [deliveryBatch, setDeliveryBatch] = useState<string | null>(null),
    [deliveryOffset, setDeliveryOffset] = useState(0),
    [offset, setOffset] = useState(0),
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
  const templates = useQuery({
    queryKey: ["private", "notification-batches", "templates", templateOffset],
    queryFn: ({ signal }) => client.templates(templateOffset, signal),
    retry: false,
    enabled: canManage,
  });
  const deliveries = useQuery({
    queryKey: [
      "private",
      "notification-batches",
      "deliveries",
      deliveryBatch,
      deliveryOffset,
    ],
    queryFn: ({ signal }) =>
      client.deliveries(deliveryBatch!, deliveryOffset, signal),
    retry: false,
    enabled: canManage && !!deliveryBatch,
  });
  const expire = () => {
    ++epoch.current;
    request.current?.abort();
    setExpired(true);
    setPreview(null);
    setPreviewFilters(null);
    setDeliveryBatch(null);
    setBusy(false);
    setError("登入或權限已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, batches.error, templates.error, deliveries.error].some(
        (e) =>
          e instanceof ApiError &&
          (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN"),
      )
    )
      expire();
  }, [account.error, batches.error, templates.error, deliveries.error]);
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
    roleOptions: roleSchema.options,
    canManage,
    preview: canManage ? preview : null,
    previewFilters: canManage ? previewFilters : null,
    previewAudience: (filters: NotificationAudience) =>
      run(async (signal) => {
        setPreview(null);
        setPreviewFilters(null);
        const result = await client.preview(filters, signal);
        if (signal.aborted) return;
        setPreview(result);
        setPreviewFilters(filters);
      }, "受眾預覽已更新，請明確勾選並採用收件者。"),
    templates: canManage ? (templates.data?.items ?? []) : [],
    templateOffset,
    templateNext: templates.data?.nextOffset ?? null,
    templatePage: setTemplateOffset,
    saveTemplate: (draft: NotificationTemplateDraft) =>
      run((signal) => {
        const payload = JSON.stringify(draft);
        if (templateAttempt.current?.payload !== payload)
          templateAttempt.current = { payload, key: crypto.randomUUID() };
        return client.saveTemplate(
          { ...draft, id: templateAttempt.current.key },
          signal,
        );
      }, "已保存不可變的範本新版本。"),
    deliveryBatch: canManage ? deliveryBatch : null,
    deliveries: canManage ? (deliveries.data?.items ?? []) : [],
    deliveryOffset,
    deliveryNext: deliveries.data?.nextOffset ?? null,
    deliveryPage: setDeliveryOffset,
    selectDeliveries: (id: string) => {
      setDeliveryBatch(id);
      setDeliveryOffset(0);
    },
    busy,
    error:
      error ||
      ([account.error, batches.error, templates.error, deliveries.error].some(
        Boolean,
      )
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
    create: (
      recipientText: string,
      subject: string,
      text: string,
      options: NotificationBatchOptions,
    ) =>
      run((signal) => {
        const recipientIds = recipientText
            .split(/[\s,;]+/)
            .map((v) => v.trim())
            .filter(Boolean)
            .sort(),
          payload = JSON.stringify({ recipientIds, subject, text, ...options });
        if (attempt.current?.payload !== payload)
          attempt.current = { payload, key: crypto.randomUUID() };
        return client.create(
          {
            recipientIds,
            subject,
            text,
            ...options,
            idempotencyKey: attempt.current.key,
          },
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
