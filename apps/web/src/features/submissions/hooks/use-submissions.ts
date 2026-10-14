import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAuthClient,
  createSubmissionClient,
  createFilesClient,
  ApiError,
} from "@confsys/sdk";
import {
  submissionSchema,
  submissionConfigSchema,
  submissionDetailSchema,
  submissionListSchema,
  type SubmissionDocument,
  type SubmissionConfig,
  type Submission,
} from "@confsys/contracts";
const client = createSubmissionClient(),
  auth = createAuthClient(),
  files = createFilesClient();
const blank = (): SubmissionDocument => ({
  title: "",
  abstract: "",
  keywords: [],
  correspondingAuthorIndex: 0,
  trackId: "",
  topicIds: [],
  authors: [{ name: "", email: "", affiliation: "" }],
  presenterIndex: 0,
  presentationPreference: "either",
  competition: false,
  attachmentIds: [],
  slidesFileId: null,
  videoUrl: "",
});
export function useSubmissions(admin = false) {
  const queries = useQueryClient(),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null);
  const [expired, setExpired] = useState(false),
    [offset, setOffset] = useState(0),
    [revisionOffset, setRevisionOffset] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Submission | null>(null),
    [settings, setSettings] = useState<SubmissionConfig | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
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
    (!admin ||
      account.data.user.permissions.some((v) => v === "submissions.read_all"));
  const config = useQuery({
    queryKey: ["private", "submissions", "config"],
    queryFn: async ({ signal }) =>
      submissionConfigSchema.parse(
        await client("submissionConfig", null, signal),
      ),
    retry: false,
    enabled: allowed,
  });
  const list = useQuery({
    queryKey: ["private", "submissions", "list", admin, offset],
    queryFn: async ({ signal }) =>
      submissionListSchema.parse(
        await client(
          "submissionList",
          { scope: admin ? "admin" : "own", offset },
          signal,
        ),
      ),
    retry: false,
    enabled: allowed,
  });
  const detail = useQuery({
    queryKey: [
      "private",
      "submissions",
      "detail",
      admin,
      selected,
      revisionOffset,
    ],
    queryFn: async ({ signal }) =>
      submissionDetailSchema.parse(
        await client(
          "submissionDetail",
          { id: selected, scope: admin ? "admin" : "own", revisionOffset },
          signal,
        ),
      ),
    retry: false,
    enabled: allowed && !!selected,
  });
  const expire = () => {
    ++epoch.current;
    controller.current?.abort();
    setExpired(true);
    setDraft(null);
    setSettings(null);
    setSelected(null);
    setBusy(false);
    setMessage("");
    setError("登入已失效或權限已撤銷，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    if (
      [account.error, config.error, list.error, detail.error].some(
        (e) =>
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code),
      )
    )
      expire();
  }, [account.error, config.error, list.error, detail.error]);
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
      if (ticket !== epoch.current || c.signal.aborted) return;
      if (
        e instanceof ApiError &&
        ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
      ) {
        expire();
        return;
      }
      setError(
        e instanceof ApiError && e.code === "CONFLICT"
          ? "版本衝突、投稿窗口已關閉，或未符合報名要求。未儲存內容已保留；請重新載入比對。"
          : "操作失敗：請確認必填欄位、主題與附件，然後重試。",
      );
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  const refresh = () =>
    queries.invalidateQueries({ queryKey: ["private", "submissions"] });
  const effective = draft ?? detail.data?.submission ?? null;
  return {
    admin,
    expired,
    loading:
      !expired &&
      (account.isPending || (allowed && (config.isPending || list.isPending))),
    busy,
    error:
      error ||
      (!account.isPending && !allowed
        ? "沒有此工作台的權限。"
        : config.error || list.error || detail.error
          ? "讀取失敗，請重試。"
          : ""),
    message,
    items: allowed ? (list.data?.items ?? []) : [],
    offset,
    nextOffset: list.data?.nextOffset ?? null,
    current: allowed ? effective : null,
    revisions: allowed ? (detail.data?.revisions ?? []) : [],
    settings: allowed ? (settings ?? config.data ?? null) : null,
    canConfigure:
      allowed &&
      !!account.data?.user.permissions.some((v) => v === "submissions.manage"),
    dirty: !!draft,
    onOffset: setOffset,
    revisionOffset,
    nextRevisionOffset: detail.data?.nextRevisionOffset ?? null,
    onRevisionOffset: setRevisionOffset,
    onSelect: (id: string) => {
      setSelected(id);
      setRevisionOffset(0);
      setDraft(null);
      setError("");
      setMessage("");
    },
    onNew: () => {
      setSelected(null);
      setRevisionOffset(0);
      setDraft({
        id: crypto.randomUUID(),
        number: "",
        ownerId: account.data!.user.id,
        state: "draft",
        version: 0,
        submittedVersion: null,
        currentRevisionId: null,
        document: blank(),
        updatedAt: "",
      });
      setMessage("");
      setError("");
    },
    onChange: (document: SubmissionDocument) => {
      if (effective) setDraft({ ...effective, document });
    },
    onUpload: (file: File, slides: boolean) =>
      void perform(async (signal) => {
        if (!effective) return;
        const asset = await files.upload(file, "manuscript", signal);
        if (signal.aborted) return;
        if (asset.status !== "ready") {
          setError(
            "附件尚未通過檢查，未加入稿件。請至私有檔案頁查看或重試檢查。",
          );
          return;
        }
        setDraft({
          ...effective,
          document: {
            ...effective.document,
            ...(slides
              ? { slidesFileId: asset.id }
              : {
                  attachmentIds: [
                    ...effective.document.attachmentIds,
                    asset.id,
                  ],
                }),
          },
        });
        setMessage("附件已通過檢查並加入本地草稿，請儲存草稿。");
      }),
    onDownload: (id: string) =>
      void perform(async (signal) => {
        const blob = await files.download(id, signal);
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = `submission-${id}`;
        link.click();
        URL.revokeObjectURL(url);
      }),
    onSettings: setSettings,
    onReload: () => {
      setDraft(null);
      setSettings(null);
      setError("");
      void refresh();
    },
    onRetry: () => void queries.invalidateQueries({ queryKey: ["private"] }),
    onSave: () =>
      void perform(async (signal) => {
        if (!effective) return;
        const saved = submissionSchema.parse(
          await client(
            "submissionSave",
            {
              id: effective.id,
              expectedVersion: effective.version,
              document: effective.document,
            },
            signal,
          ),
        );
        if (signal.aborted) return;
        setSelected(saved.id);
        setDraft(null);
        queries.setQueryData(
          ["private", "submissions", "detail", admin, saved.id, revisionOffset],
          {
            submission: saved,
            revisions: detail.data?.revisions ?? [],
            nextRevisionOffset: detail.data?.nextRevisionOffset ?? null,
          },
        );
        setMessage("草稿已儲存，請正式提交以建立不可變版本。");
        await refresh();
      }),
    onTransition: (action: "submit" | "withdraw") =>
      void perform(async (signal) => {
        if (!effective) return;
        const saved = submissionSchema.parse(
          await client(
            "submissionTransition",
            { id: effective.id, expectedVersion: effective.version, action },
            signal,
          ),
        );
        if (signal.aborted) return;
        setDraft(null);
        queries.setQueryData(
          ["private", "submissions", "detail", admin, saved.id, revisionOffset],
          {
            submission: saved,
            revisions: detail.data?.revisions ?? [],
            nextRevisionOffset: detail.data?.nextRevisionOffset ?? null,
          },
        );
        setMessage(
          action === "submit"
            ? "正式提交成功，已保存不可變版本。"
            : "稿件已撤回。",
        );
        await refresh();
      }),
    onConfigure: () =>
      void perform(async (signal) => {
        const value = settings ?? config.data;
        if (!value) return;
        const saved = submissionConfigSchema.parse(
          await client("submissionConfigure", value, signal),
        );
        if (signal.aborted) return;
        setSettings(null);
        queries.setQueryData(["private", "submissions", "config"], saved);
        setMessage("投稿設定已儲存。");
        await refresh();
      }),
  };
}
