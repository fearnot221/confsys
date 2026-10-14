import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient, ApiError } from "@confsys/sdk";
import {
  siteDraftSchema,
  siteHistorySchema,
  publicSiteSchema,
  siteIssues,
  siteChangedFields,
  siteDocumentSchema,
  type SiteDocument,
  type SiteDraft,
  type SiteLocale,
  type SitePage,
} from "@confsys/contracts";
const client = createAuthClient();
export function useSite() {
  const queries = useQueryClient();
  const [expired, setExpired] = useState(false),
    [form, setForm] = useState<SiteDraft | null>(null),
    [preview, setPreview] = useState<SiteDraft | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [locale, setLocale] = useState<SiteLocale>("zh-Hant"),
    [page, setPage] = useState<SitePage>("home"),
    [confirmation, setConfirmation] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null),
    epoch = useRef(0);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => client.me(signal),
    retry: false,
    enabled: !expired,
  });
  const permissions = account.data?.user.permissions ?? [];
  const canRead =
    !expired && !account.error && permissions.includes("site.draft.read");
  const draft = useQuery({
    queryKey: ["private", "site", "draft"],
    queryFn: async ({ signal }) =>
      siteDraftSchema.parse(await client.site("siteDraft", null, signal)),
    retry: false,
    enabled: canRead,
  });
  const history = useQuery({
    queryKey: ["private", "site", "history", offset],
    queryFn: async ({ signal }) =>
      siteHistorySchema.parse(await client.site("siteHistory", offset, signal)),
    retry: false,
    enabled: canRead,
  });
  const official = useQuery({
    queryKey: ["public", "site"],
    queryFn: async ({ signal }) =>
      publicSiteSchema.parse(await client.site("sitePublic", null, signal)),
    retry: false,
  });
  const effective = form ?? draft.data;
  const dirty =
    !!form &&
    JSON.stringify(form.document) !== JSON.stringify(draft.data?.document);
  const expire = async () => {
    ++epoch.current;
    current.current?.abort();
    setExpired(true);
    setForm(null);
    setPreview(null);
    setConfirmation(null);
    setMessage("");
    setBusy(false);
    setError("登入已逾期、撤權或 Session 已被撤銷，請重新登入。");
    await queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  const fail = (e: unknown) => {
    if (
      e instanceof ApiError &&
      (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN")
    ) {
      void expire();
      return;
    }
    setError(
      e instanceof ApiError
        ? ({
            CONFLICT:
              "版本衝突：未儲存內容已保留。請查看伺服器草稿並人工比對，或確認後重新載入。",
            REAUTH_REQUIRED: "請先重新驗證密碼，再確認發布。",
            INVALID_REQUEST: "驗證失敗，請檢查欄位。",
            INVALID_CREDENTIALS: "密碼驗證失敗。",
          }[e.code] ?? "操作失敗，請重試。")
        : "服務或資料無法處理，請重試。",
    );
  };
  useEffect(() => {
    if (
      [account.error, draft.error, history.error].some(
        (e) =>
          e instanceof ApiError &&
          (e.code === "SESSION_EXPIRED" || e.code === "FORBIDDEN"),
      )
    )
      void expire();
  }, [account.error, draft.error, history.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      current.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const change = () => {
      const m =
        /^#preview-(zh-Hant|en)-(home|about|participation|contact)$/.exec(
          window.location.hash,
        );
      if (m) {
        setLocale(m[1] as SiteLocale);
        setPage(m[2] as SitePage);
      }
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    current.current?.abort();
    const c = new AbortController();
    current.current = c;
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
  const refresh = () =>
    queries.invalidateQueries({ queryKey: ["private", "site"] });
  const validation = effective
    ? siteDocumentSchema.safeParse(effective.document)
    : null;
  const issues = validation?.success
    ? siteIssues(validation.data, true)
    : (validation?.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ) ?? []);
  return {
    loading: !expired && (account.isPending || (canRead && draft.isPending)),
    expired,
    error:
      error ||
      (!account.isPending && !canRead
        ? "沒有官網管理權限。"
        : draft.error || history.error
          ? "讀取失敗，請重試。"
          : ""),
    message,
    busy,
    dirty,
    form: canRead ? (effective ?? null) : null,
    serverDraft: canRead ? (draft.data ?? null) : null,
    preview: canRead ? preview : null,
    locale,
    page,
    issues,
    changedFields:
      effective && official.data
        ? siteChangedFields(official.data.document, effective.document)
        : [],
    history: canRead ? (history.data?.items ?? []) : [],
    offset,
    nextOffset: history.data?.nextOffset ?? null,
    confirmation,
    canWrite: canRead && permissions.includes("site.draft.write"),
    canPublish: canRead && permissions.includes("site.publish"),
    canMedia: canRead && permissions.includes("files.media.manage"),
    onLocale: setLocale,
    onPage: setPage,
    onHistoryPage: setOffset,
    onConfirm: setConfirmation,
    onChange: (document: SiteDocument) => {
      if (effective) {
        setForm({ ...effective, document });
        setPreview(null);
        setConfirmation(null);
      }
    },
    onRetry: () => {
      void queries.invalidateQueries({ queryKey: ["private"] });
    },
    onReload: () => {
      setForm(null);
      setPreview(null);
      setConfirmation(null);
      setError("");
      void refresh();
    },
    onSave: () =>
      void perform(async (signal) => {
        if (!effective) return;
        const parsed = siteDocumentSchema.safeParse(effective.document);
        if (!parsed.success) {
          setError(
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("；"),
          );
          return;
        }
        const problems = siteIssues(parsed.data, false);
        if (problems.length) {
          setError(problems.join("；"));
          return;
        }
        const saved = siteDraftSchema.parse(
          await client.site(
            "siteSave",
            { expectedVersion: effective.draftVersion, document: parsed.data },
            signal,
          ),
        );
        if (signal.aborted) return;
        queries.setQueryData(["private", "site", "draft"], saved);
        setForm(null);
        setPreview(null);
        setMessage("草稿已儲存；官網尚未變更。");
        await refresh();
      }),
    onPreview: () =>
      void perform(async (signal) => {
        if (!effective || dirty) return;
        const value = siteDraftSchema.parse(
          await client.site("sitePreview", effective.draftVersion, signal),
        );
        if (!signal.aborted) {
          setPreview(value);
          setLocale(value.document.defaultLocale);
          setPage("home");
        }
      }),
    onExecute: () =>
      void perform(async (signal) => {
        if (!effective || dirty || !confirmation) return;
        if (confirmation === "publish") {
          await client.site(
            "sitePublish",
            { expectedVersion: effective.draftVersion },
            signal,
          );
          const published = publicSiteSchema.parse(
            await client.site("sitePublic", null, signal),
          );
          if (signal.aborted) return;
          queries.setQueryData(["public", "site"], published);
          setMessage(`發布完成：${published.publicationId}`);
          await queries.invalidateQueries({ queryKey: ["public", "instance"] });
        } else {
          const saved = siteDraftSchema.parse(
            await client.site(
              "siteRestore",
              {
                expectedVersion: effective.draftVersion,
                publicationId: confirmation,
              },
              signal,
            ),
          );
          if (signal.aborted) return;
          queries.setQueryData(["private", "site", "draft"], saved);
          setMessage("歷史版本已載入為新草稿；官網沒有變更。");
        }
        if (signal.aborted) return;
        setForm(null);
        setPreview(null);
        setConfirmation(null);
        await refresh();
      }),
    onReauthenticate: (password: string) =>
      void perform(async (signal) => {
        await client.mutate("reauthenticate", { password }, signal);
        if (!signal.aborted) setMessage("密碼已重新驗證，請再次確認發布。");
      }),
  };
}
