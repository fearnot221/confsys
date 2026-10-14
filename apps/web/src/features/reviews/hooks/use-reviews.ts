import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient, createReviewClient, ApiError } from "@confsys/sdk";
import {
  type ReviewFormDocument,
  type ReviewScreening,
  type ReviewAssignment,
  type ReviewScoreDocument,
  type ReviewDecision,
} from "@confsys/contracts";
const auth = createAuthClient(),
  client = createReviewClient();
export function useReviews() {
  const queries = useQueryClient(),
    current = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const [offset, setOffset] = useState(0),
    [expired, setExpired] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const keys = useRef(new Map<string, string>());
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const ready = !!account.data && !account.error && !expired,
    permissions = ready ? (account.data?.user.permissions ?? []) : [];
  const canManage = permissions.includes("reviews.manage"),
    canReview = permissions.includes("reviews.assigned"),
    canDecide = permissions.includes("reviews.decide"),
    canConfigure = permissions.includes("access.roles.manage");
  const board = useQuery({
    queryKey: ["private", "reviews", "board", offset],
    queryFn: ({ signal }) => client.board(offset, signal),
    retry: false,
    enabled: canManage,
  });
  const assigned = useQuery({
    queryKey: ["private", "reviews", "assigned", offset],
    queryFn: ({ signal }) => client.assigned(offset, signal),
    retry: false,
    enabled: canReview,
  });
  const results = useQuery({
    queryKey: ["private", "reviews", "results", offset],
    queryFn: ({ signal }) => client.results(offset, signal),
    retry: false,
    enabled: ready,
  });
  const expire = () => {
    ++epoch.current;
    current.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入已失效，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, board.error, assigned.error, results.error].some(
        (e) => e instanceof ApiError && e.code === "SESSION_EXPIRED",
      )
    )
      expire();
  }, [account.error, board.error, assigned.error, results.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      current.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<string>) => {
    current.current?.abort();
    const c = new AbortController();
    current.current = c;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await work(c.signal);
      if (ticket !== epoch.current || c.signal.aborted) return;
      setMessage(text);
      await queries.invalidateQueries({ queryKey: ["private", "reviews"] });
    } catch (e) {
      if (ticket !== epoch.current || c.signal.aborted) return;
      if (e instanceof ApiError && e.code === "SESSION_EXPIRED") {
        expire();
        return;
      }
      const messages: Record<string, string> = {
        FORBIDDEN: "沒有權限、超出分組範圍，或存在利益衝突。",
        CONFLICT: "版本、截止時間或狀態已變更，請重新整理確認。",
        INVALID_REQUEST: "請檢查評分、必填欄位與匿名稿確認。",
        REAUTH_REQUIRED: "請先重新驗證管理密碼。",
        NOT_FOUND: "找不到可存取的資料。",
      };
      setError(
        e instanceof ApiError
          ? (messages[e.code] ?? "操作失敗，請重試。")
          : "輸入或服務錯誤，請重試。",
      );
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  const stableId = (input: unknown) => {
    const key = JSON.stringify(input);
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
    return keys.current.get(key)!;
  };
  return {
    expired,
    busy,
    error:
      error ||
      ([board.error, assigned.error, results.error].some(Boolean)
        ? "讀取失敗，請重試。"
        : ""),
    message,
    loading:
      !expired &&
      (account.isPending ||
        (canManage && board.isPending) ||
        (canReview && assigned.isPending)),
    canManage,
    canReview,
    canDecide,
    canConfigure,
    board: canManage && !board.error ? (board.data ?? null) : null,
    assigned: canReview && !assigned.error ? (assigned.data?.items ?? []) : [],
    results: ready && !results.error ? (results.data?.items ?? []) : [],
    offset,
    next:
      board.data?.nextOffset ??
      assigned.data?.nextOffset ??
      results.data?.nextOffset ??
      null,
    onPage: setOffset,
    onRefresh: () => {
      void queries.invalidateQueries({ queryKey: ["private"] });
    },
    onReauthenticate: (password: string) =>
      void perform(async (signal) => {
        await auth.mutate("reauthenticate", { password }, signal);
        return "密碼已重新驗證。";
      }),
    onScreen: (
      submissionId: string,
      revisionId: string,
      outcome: ReviewScreening["outcome"],
      reason: string,
    ) =>
      void perform(async (signal) => {
        const expectedVersion =
            board.data?.screenings.find((s) => s.revisionId === revisionId)
              ?.version ?? 0,
          input = {
            submissionId,
            revisionId,
            expectedVersion,
            outcome,
            reason,
          };
        await client.screen({ ...input, id: stableId(input) }, signal);
        return "初檢已保存為新版本；既有公開結果未被改寫。";
      }),
    onRemind: (assignmentId: string, reason: string) =>
      void perform(async (signal) => {
        const input = { assignmentId, reason };
        await client.remind(
          { ...input, idempotencyKey: stableId(input) },
          signal,
        );
        return "待完成審查提醒已排入寄送；相同操作重試不重複寄送。";
      }),
    onConfigure: (document: ReviewFormDocument) =>
      void perform(async (signal) => {
        await client.configure(document, signal);
        return "已建立新的評分表版本；既有指派保持原版本。";
      }),
    onScope: (userId: string, trackId: string, remove: boolean) =>
      void perform(async (signal) => {
        await client.scope({ userId, trackId, remove }, signal);
        return "主席分組範圍已更新。";
      }),
    onConflict: (submissionId: string, reason: string) =>
      void perform(async (signal) => {
        await client.conflict({ submissionId, reason }, signal);
        return "利益衝突已記錄；此稿件不再提供決議權限。";
      }),
    onAssign: (
      submissionId: string,
      revisionId: string,
      reviewerId: string,
      formId: string,
      anonymousConfirmed: boolean,
    ) =>
      void perform(async (signal) => {
        const input = {
          submissionId,
          revisionId,
          reviewerId,
          formId,
          anonymousConfirmed,
        };
        await client.assign({ ...input, id: stableId(input) }, signal);
        return "已指派不可變投稿版本並排入通知。";
      }),
    onAction: (
      assignment: ReviewAssignment,
      action: string,
      document: ReviewScoreDocument,
      reason: string,
    ) =>
      void perform(async (signal) => {
        await client.action(
          {
            id: assignment.id,
            expectedVersion: assignment.version,
            action,
            document,
            reason,
          },
          signal,
        );
        return action === "submit"
          ? "審查已正式送出，評分與評語已鎖定。"
          : "審查狀態已更新。";
      }),
    onDecide: (
      submissionId: string,
      revisionId: string,
      outcome: ReviewDecision["outcome"],
      authorMessage: string,
      internalReason: string,
      revisionDeadline: string | null,
    ) =>
      void perform(async (signal) => {
        const expectedVersion = Math.max(
          0,
          ...(board.data?.decisions ?? [])
            .filter((d) => d.submissionId === submissionId)
            .map((d) => d.version),
        );
        const input = {
          submissionId,
          revisionId,
          outcome,
          authorMessage,
          internalReason,
          revisionDeadline,
          expectedVersion,
        };
        await client.decide({ ...input, id: stableId(input) }, signal);
        return "決議草稿已保存，作者尚未看到新結果。";
      }),
    onPublish: (id: string) =>
      void perform(async (signal) => {
        await client.publish(id, signal);
        return "結果已發布至作者工作台，通知已排入佇列。";
      }),
    onDownload: (assignmentId: string, fileId: string) =>
      void perform(async (signal) => {
        const blob = await client.download(assignmentId, fileId, signal);
        if (signal.aborted) return "";
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `manuscript-${fileId}.${blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return "稿件已下載。";
      }),
  };
}
