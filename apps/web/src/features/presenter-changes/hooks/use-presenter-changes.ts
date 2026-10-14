import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createPresenterChangesClient,
  ApiError,
} from "@confsys/sdk";
import {
  presenterChangeEndpoints,
  submissionListSchema,
  type PresenterChange,
} from "@confsys/contracts";
const client = createPresenterChangesClient(),
  auth = createAuthClient();
export function usePresenterChanges(administrative = false) {
  const queries = useQueryClient(),
    active = useRef<AbortController | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [expired, setExpired] = useState(false),
    [scope, setScope] = useState<"own" | "incoming" | "admin">(
      administrative ? "admin" : "own",
    ),
    [offset, setOffset] = useState(0);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const canUse =
    !expired &&
    !!account.data &&
    (!administrative ||
      account.data.user.permissions.includes("submissions.manage"));
  const [candidateOffset, setCandidateOffset] = useState(0);
  const candidates = useQuery({
    queryKey: ["private", "presenter-candidates", candidateOffset],
    queryFn: async ({ signal }) =>
      submissionListSchema.parse(
        await client(
          "presenterCandidates",
          { scope: "own", offset: candidateOffset },
          signal,
        ),
      ),
    enabled: canUse && !administrative,
    retry: false,
  });
  const list = useQuery({
    queryKey: ["private", "presenter-changes", scope, offset],
    queryFn: async ({ signal }) =>
      presenterChangeEndpoints.presenterChanges.output.parse(
        await client("presenterChanges", { scope, offset }, signal),
      ),
    enabled: canUse,
    retry: false,
  });
  useEffect(() => () => active.current?.abort(), []);
  const clear = () => {
    setExpired(true);
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    const e = account.error ?? list.error ?? candidates.error;
    if (
      e instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
    ) {
      setExpired(true);
      void queries.cancelQueries({ queryKey: ["private"] });
      queries.removeQueries({ queryKey: ["private"] });
    }
  }, [account.error, list.error, candidates.error, queries]);
  const perform = async (
    operation: keyof typeof presenterChangeEndpoints,
    input: unknown,
  ) => {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client(operation, input, c.signal);
      await queries.invalidateQueries({
        queryKey: ["private", "presenter-changes"],
      });
      await queries.invalidateQueries({ queryKey: ["private", "submissions"] });
      setMessage(
        "申請已更新。核准後仍須新的錄取結果及議程／競賽作業；既有公開版本保留原內容。",
      );
    } catch (e) {
      if (!c.signal.aborted) {
        if (
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
        )
          clear();
        setError(
          e instanceof ApiError && e.code === "CONFLICT"
            ? "申請已過期、版本或資格已變更，請重新載入；新申請須使用尚未修改的最新正式投稿。"
            : "操作失敗，請檢查投稿資料、目標作者已驗證帳號及報告者政策。",
        );
      }
    } finally {
      if (active.current === c) setBusy(false);
    }
  };
  return {
    candidates: canUse
      ? (candidates.data?.items.filter(
          (s) => s.state === "submitted" && s.submittedVersion === s.version,
        ) ?? [])
      : [],
    candidateOffset,
    candidateNextOffset: candidates.data?.nextOffset ?? null,
    candidatePage: setCandidateOffset,
    administrative,
    canUse,
    scope,
    items: canUse ? (list.data?.items ?? []) : [],
    nextOffset: list.data?.nextOffset ?? null,
    offset,
    busy,
    loading: account.isPending || (canUse && list.isPending),
    error:
      error ||
      (!account.isPending && !canUse
        ? "登入失效或沒有管理權限。"
        : list.error
          ? "無法讀取申請。"
          : ""),
    message,
    changeScope: (value: "own" | "incoming") => {
      setScope(value);
      setOffset(0);
    },
    page: (value: number) => setOffset(value),
    reload: () => list.refetch(),
    create: (data: {
      submissionId: string;
      sourceRevisionId: string;
      expectedSubmissionVersion: number;
      targetAuthorIndex: number;
      reason: string;
    }) =>
      perform("presenterChangeCreate", { ...data, id: crypto.randomUUID() }),
    action: (
      row: PresenterChange,
      action: "accept" | "decline" | "cancel" | "approve" | "reject",
      reason: string,
    ) =>
      perform(
        action === "cancel"
          ? "presenterChangeCancel"
          : ["approve", "reject"].includes(action)
            ? "presenterChangeDecide"
            : "presenterChangeRespond",
        {
          id: row.id,
          expectedVersion: row.version,
          reason,
          ...(action === "cancel" ? {} : { action }),
        },
      ),
  };
}
