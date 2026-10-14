import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCompetitionClient,
  createAuthClient,
  ApiError,
} from "@confsys/sdk";
import {
  competitionAdminSchema,
  competitionCatalogSchema,
  competitionJudgingSchema,
  competitionPublicSchema,
  type competitionEndpoints,
} from "@confsys/contracts";
const client = createCompetitionClient(),
  auth = createAuthClient();
export function useCompetitions(mode: "author" | "admin" | "judge") {
  const cache = useQueryClient(),
    controller = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const [expired, setExpired] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [offset, setOffset] = useState(0);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const allowed =
    !expired &&
    !account.error &&
    !!account.data &&
    (mode === "author" ||
      account.data.user.permissions.includes(
        mode === "admin" ? "competitions.manage" : "competitions.score",
      ));
  const query = useQuery({
    queryKey: ["private", "competitions", mode, offset],
    enabled: allowed,
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await client(
        mode === "admin"
          ? "competitionAdmin"
          : mode === "judge"
            ? "competitionJudging"
            : "competitionCatalog",
        { offset },
        signal,
      );
      return mode === "admin"
        ? { admin: competitionAdminSchema.parse(value) }
        : mode === "judge"
          ? { judge: competitionJudgingSchema.parse(value) }
          : { author: competitionCatalogSchema.parse(value) };
    },
  });
  const expire = () => {
    epoch.current++;
    controller.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入失效或權限已撤銷，請重新登入。");
    void cache.cancelQueries({ queryKey: ["private"] });
    cache.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, query.error].some(
        (e) =>
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code),
      )
    )
      expire();
  }, [account.error, query.error]);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<unknown>) => {
    controller.current?.abort();
    const c = new AbortController(),
      ticket = ++epoch.current;
    controller.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(c.signal);
      if (c.signal.aborted || ticket !== epoch.current) return;
      setMessage("操作已完成。");
      await cache.invalidateQueries({ queryKey: ["private", "competitions"] });
      await cache.invalidateQueries({ queryKey: ["public", "competitions"] });
    } catch (e) {
      if (c.signal.aborted || ticket !== epoch.current) return;
      if (e instanceof ApiError && e.code === "SESSION_EXPIRED") {
        expire();
        return;
      }
      setError(
        e instanceof ApiError && e.code === "REAUTH_REQUIRED"
          ? "發布前請重新驗證密碼。"
          : e instanceof ApiError && e.code === "CONFLICT"
            ? "狀態、版本、期限、資格或評分條件不符，請重新整理並檢查。"
            : "操作失敗，請檢查欄位與權限。",
      );
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return {
    mode,
    admin: allowed ? (query.data?.admin ?? null) : null,
    author: allowed ? (query.data?.author ?? null) : null,
    judge: allowed ? (query.data?.judge ?? null) : null,
    loading: !expired && (account.isPending || (allowed && query.isPending)),
    busy,
    error:
      error ||
      (!account.isPending && !allowed
        ? "沒有此工作台權限。"
        : query.error
          ? "讀取失敗，請重試。"
          : ""),
    message,
    offset,
    onPage: setOffset,
    onRetry: () => void query.refetch(),
    newId: () => crypto.randomUUID(),
    onAction: (operation: keyof typeof competitionEndpoints, input: unknown) =>
      void perform((signal) => client(operation, input, signal)),
    onReauthenticate: (password: string) =>
      void perform((signal) =>
        auth.mutate("reauthenticate", { password }, signal),
      ),
  };
}
export function usePublicCompetitionAwards() {
  const q = useQuery({
    queryKey: ["public", "competitions"],
    queryFn: async ({ signal }) =>
      competitionPublicSchema.parse(
        await client("competitionPublic", null, signal),
      ),
    retry: false,
  });
  return {
    data: q.data ?? null,
    loading: q.isPending,
    error: q.error ? "得獎名單暫時無法讀取。" : "",
    onRetry: () => void q.refetch(),
  };
}
