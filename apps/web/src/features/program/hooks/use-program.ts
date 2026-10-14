import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createProgramClient, createAuthClient, ApiError } from "@confsys/sdk";
import {
  programDraftSchema,
  programPublicSchema,
  type ProgramDraft,
} from "@confsys/contracts";
const client = createProgramClient(),
  auth = createAuthClient();
export function usePublicProgram() {
  const q = useQuery({
    queryKey: ["public", "program"],
    queryFn: async ({ signal }) =>
      programPublicSchema.parse(await client("programPublic", null, signal)),
    retry: false,
  });
  return {
    program: q.data ?? null,
    loading: q.isPending,
    error: q.error ? "議程暫時無法讀取，請稍後重試。" : "",
    onRetry: () => void q.refetch(),
  };
}
export function useProgram() {
  const queries = useQueryClient(),
    controller = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const [expired, setExpired] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const account = useQuery({
      queryKey: ["private", "account"],
      queryFn: ({ signal }) => auth.me(signal),
      retry: false,
      enabled: !expired,
    }),
    allowed =
      !expired &&
      !account.error &&
      !!account.data?.user.permissions.some((v) => v === "program.manage");
  const draft = useQuery({
    queryKey: ["private", "program"],
    queryFn: async ({ signal }) =>
      programDraftSchema.parse(await client("programDraft", null, signal)),
    retry: false,
    enabled: allowed,
  });
  const expire = () => {
    ++epoch.current;
    controller.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入已失效或權限已撤銷，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, draft.error].some(
        (e) =>
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code),
      )
    )
      expire();
  }, [account.error, draft.error]);
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
      if (c.signal.aborted || ticket !== epoch.current) return;
      if (
        e instanceof ApiError &&
        ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
      ) {
        expire();
        return;
      }
      setError(
        e instanceof ApiError && e.code === "CONFLICT"
          ? "版本、會場、主持人或報告者時段衝突，或稿件尚未發布錄取。請檢查排程後重試。"
          : e instanceof ApiError && e.code === "REAUTH_REQUIRED"
            ? "請重新驗證密碼後發布。"
            : "操作失敗，請檢查必填欄位、時段範圍與附件。",
      );
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  type SaveOperation =
    "programRoom" | "programBlocked" | "programSession" | "programSlot";
  const save = (operation: SaveOperation, item: unknown) =>
    void perform(async (signal) => {
      if (!draft.data) return;
      const saved = programDraftSchema.parse(
        await client(
          operation,
          { expectedVersion: draft.data.version, item },
          signal,
        ),
      );
      if (signal.aborted) return;
      queries.setQueryData(["private", "program"], saved);
      setMessage("議程草稿已儲存；公開議程尚未改變。");
    });
  return {
    draft: allowed ? (draft.data ?? null) : null,
    loading: !expired && (account.isPending || (allowed && draft.isPending)),
    busy,
    error:
      error ||
      (!account.isPending && !allowed
        ? "沒有議程管理權限。"
        : draft.error
          ? "讀取失敗，請重試。"
          : ""),
    message,
    canPublish:
      allowed &&
      !!account.data?.user.permissions.some((v) => v === "program.publish"),
    onRetry: () => void queries.invalidateQueries({ queryKey: ["private"] }),
    onRoom: (item: ProgramDraft["rooms"][number]) => save("programRoom", item),
    onBlocked: (item: ProgramDraft["blocked"][number]) =>
      save("programBlocked", item),
    onSession: (item: ProgramDraft["sessions"][number]) =>
      save("programSession", item),
    onSlot: (item: unknown) => save("programSlot", item),
    newId: () => crypto.randomUUID(),
    onRemove: (kind: "room" | "blocked" | "session" | "slot", id: string) =>
      void perform(async (signal) => {
        if (!draft.data) return;
        const saved = programDraftSchema.parse(
          await client(
            "programRemove",
            { expectedVersion: draft.data.version, kind, id },
            signal,
          ),
        );
        if (signal.aborted) return;
        queries.setQueryData(["private", "program"], saved);
        setMessage("已從草稿移除。");
      }),
    onPublish: () =>
      void perform(async (signal) => {
        if (!draft.data) return;
        const published = programPublicSchema.parse(
          await client(
            "programPublish",
            { expectedVersion: draft.data.version },
            signal,
          ),
        );
        if (signal.aborted) return;
        queries.setQueryData(["public", "program"], published);
        setMessage(`議程已發布：${published.publicationId}`);
        await queries.invalidateQueries({ queryKey: ["private", "program"] });
      }),
    onReauthenticate: (password: string) =>
      void perform(async (signal) => {
        await auth.mutate("reauthenticate", { password }, signal);
        if (!signal.aborted) setMessage("密碼已重新驗證，請再次確認發布。");
      }),
  };
}

/** Owner-linked published schedule; callers never match identity names or emails. */
export function useMyProgram(enabled = true) {
  const query = useQuery({
    queryKey: ["private", "program", "mine"],
    queryFn: async ({ signal }) =>
      programPublicSchema.parse(await client("programMine", null, signal)),
    enabled,
    retry: false,
  });
  return {
    program: enabled && !query.error ? (query.data ?? null) : null,
    loading: enabled && query.isPending,
    error:
      enabled && query.error ? "個人議程無法讀取，請重新登入或稍後重試。" : "",
    onRetry: () => void query.refetch(),
  };
}
