import { useState, useId } from "react";
import type {
  SiteDocument,
  SiteDraft,
  SiteHistory,
  SiteLocale,
  SitePage,
} from "@confsys/contracts";
import { PublicSiteContent } from "./public-site.js";
type Props = {
  loading: boolean;
  expired: boolean;
  error: string;
  message: string;
  busy: boolean;
  dirty: boolean;
  form: SiteDraft | null;
  serverDraft: SiteDraft | null;
  preview: SiteDraft | null;
  locale: SiteLocale;
  page: SitePage;
  issues: string[];
  changedFields: string[];
  history: SiteHistory["items"];
  offset: number;
  nextOffset: number | null;
  confirmation: string | null;
  canWrite: boolean;
  canPublish: boolean;
  canMedia: boolean;
  pages: readonly SitePage[];
  optionalPages: readonly SitePage[];
  onLocale: (v: SiteLocale) => void;
  onPage: (v: SitePage) => void;
  onHistoryPage: (v: number) => void;
  onConfirm: (v: string | null) => void;
  onChange: (v: SiteDocument) => void;
  onRetry: () => void;
  onReload: () => void;
  onSave: () => void;
  onPreview: () => void;
  onExecute: () => void;
  onReauthenticate: (v: string) => void;
};

const pageNames = {
  committee: "大會委員",
  dates: "重要日期",
  news: "最新消息",
  speakers: "講者",
  travel: "交通住宿",
  sponsors: "贊助單位",
  faq: "常見問題",
  home: "首頁",
  about: "關於會議",
  participation: "參與說明",
  contact: "交通與聯絡",
};
export function SiteScreen(p: Props) {
  const [section, setSection] = useState("settings"),
    [password, setPassword] = useState("");
  const d = p.form?.document;
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    multiline = false,
  ) => (
    <SiteField
      label={label}
      value={value}
      onChange={change}
      multiline={multiline}
      disabled={!p.canWrite || p.busy}
    />
  );

  const set = (key: keyof SiteDocument, value: unknown) => {
    if (d) p.onChange({ ...d, [key]: value });
  };
  const t = d?.translations[p.locale];
  const selectedPage = t?.pages[p.page] ?? {
    title: "",
    description: "",
    body: "",
    bullets: [],
    links: [],
  };
  const translation = (key: string, value: unknown) => {
    if (d && t)
      p.onChange({
        ...d,
        translations: { ...d.translations, [p.locale]: { ...t, [key]: value } },
      });
  };
  return (
    <div className="layout site-editor">
      <header>
        <a href="/">官網</a>
        <a href="/auth/account">帳號</a>
        <h1>會議設定與官網</h1>
      </header>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && (
        <p id="site-error" role="alert">
          {p.error}
        </p>
      )}
      {p.message && <p role="status">{p.message}</p>}
      {p.expired ? (
        <a href="/auth/login">重新登入</a>
      ) : (
        <button onClick={p.onRetry}>重試／取得伺服器版本</button>
      )}
      {d && p.form && (
        <>
          <p>目前正式版本：{p.form.activePublicationId ?? "尚未發布"}</p>
          <p>
            草稿版本：
            <strong data-testid="draft-version">
              {p.form.draftVersion}
            </strong> ·{" "}
            {p.dirty
              ? "有尚未儲存的變更，請先儲存再預覽／發布。"
              : p.form.publishedDraftVersion === p.form.draftVersion
                ? "與正式版本相同"
                : "有未發布變更"}
          </p>
          <nav aria-label="編輯分區">
            {[
              ["settings", "基本資訊"],
              ["content", "官網內容"],
              ["preview", "預覽與發布"],
              ["history", "發布歷程"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSection(key!)}
                aria-pressed={section === key}
              >
                {label}
              </button>
            ))}
          </nav>
          {section === "settings" && (
            <section>
              <h2>基本資訊</h2>
              <p>
                發布後才會更新官網、登入頁及新帳號郵件品牌。公開聯絡信箱不會變更實際寄件身分。
              </p>
              <div className="fields">
                <label>
                  預設語系
                  <select
                    value={d.defaultLocale}
                    onChange={(e) => set("defaultLocale", e.target.value)}
                    disabled={!p.canWrite || p.busy}
                  >
                    <option value="zh-Hant">繁體中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <fieldset>
                  <legend>啟用語系</legend>
                  {(["zh-Hant", "en"] as const).map((lang) => (
                    <label key={lang}>
                      <input
                        type="checkbox"
                        checked={d.enabledLocales.includes(lang)}
                        disabled={!p.canWrite || p.busy}
                        onChange={(e) =>
                          set(
                            "enabledLocales",
                            e.target.checked
                              ? [...d.enabledLocales, lang]
                              : d.enabledLocales.filter((v) => v !== lang),
                          )
                        }
                      />
                      {lang}
                    </label>
                  ))}
                </fieldset>
                {(
                  [
                    ["startDate", "會議開始日期 YYYY-MM-DD"],
                    ["endDate", "會議結束日期 YYYY-MM-DD"],
                    ["timezone", "IANA 時區"],
                    ["contactEmail", "公開聯絡 Email"],
                    ["phone", "聯絡電話"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {field(label, d[key], (v) => set(key, v))}
                  </div>
                ))}
              </div>
              <fieldset disabled={!p.canMedia || p.busy}>
                <legend>官網圖片</legend>
                <p>
                  先至{" "}
                  <a href="/account/files" target="_blank" rel="noreferrer">
                    私人檔案
                  </a>{" "}
                  上傳用途為官網媒體的圖片，檢查完成後貼上檔案
                  ID。草稿不會公開圖片。
                </p>
                {(["logoId", "heroId"] as const).map((key) => (
                  <label key={key}>
                    {key === "logoId" ? "Logo 檔案 ID" : "主視覺檔案 ID"}
                    <input
                      value={d.media?.[key] ?? ""}
                      onChange={(e) =>
                        set("media", {
                          logoId: d.media?.logoId ?? null,
                          heroId: d.media?.heroId ?? null,
                          [key]: e.target.value || null,
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <Locale value={p.locale} onChange={p.onLocale} />
              {t &&
                (
                  [
                    ["name", "會議名稱"],
                    ["subtitle", "簡稱／副標題"],
                    ["summary", "簡介"],
                    ["venue", "場地名稱（空白顯示待公告）"],
                    ["address", "場地地址"],
                    ["organizers", "主辦單位"],
                    ["hosts", "承辦單位"],
                    ["contactNote", "聯絡說明"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {field(
                      label,
                      t[key],
                      (v) => translation(key, v),
                      [
                        "summary",
                        "organizers",
                        "hosts",
                        "contactNote",
                      ].includes(key),
                    )}
                  </div>
                ))}
            </section>
          )}
          {section === "content" && t && (
            <section>
              <h2>固定官網頁面</h2>
              <p>
                文字不會執行 HTML。每個啟用語系都需名稱及各頁
                metadata；空白內文回退預設語系。
              </p>
              <Locale value={p.locale} onChange={p.onLocale} />
              <label htmlFor="site-page">頁面</label>
              <select
                id="site-page"
                value={p.page}
                onChange={(e) => p.onPage(e.target.value as SitePage)}
              >
                {p.pages.map((key) => (
                  <option key={key} value={key}>
                    {pageNames[key]}
                  </option>
                ))}
              </select>
              {p.optionalPages.some((key) => key === p.page) && (
                <div>
                  <p>
                    {t.pages[p.page]
                      ? "此語系已建立此頁；發布後可見。"
                      : "此語系尚未建立此頁；填寫內容後會建立，或回退預設語系。"}
                  </p>
                  <button
                    disabled={!p.canWrite || p.busy || !t.pages[p.page]}
                    onClick={() => {
                      const next = { ...t.pages };
                      for (const key of p.optionalPages)
                        if (key === p.page) delete next[key];
                      translation("pages", next);
                    }}
                  >
                    移除此語系選填頁面
                  </button>
                </div>
              )}
              {(["title", "description", "body"] as const).map((key) => (
                <div key={key}>
                  {field(
                    {
                      title: "頁面 title",
                      description: "頁面 description",
                      body: "頁面內文",
                    }[key],
                    selectedPage[key],
                    (v) =>
                      translation("pages", {
                        ...t.pages,
                        [p.page]: { ...selectedPage, [key]: v },
                      }),
                    key === "body",
                  )}
                </div>
              ))}
              {field(
                "條列（每行一項）",
                selectedPage.bullets.join("\n"),
                (v) =>
                  translation("pages", {
                    ...t.pages,
                    [p.page]: {
                      ...selectedPage,
                      bullets: v ? v.split("\n") : [],
                    },
                  }),
                true,
              )}
              <h3>受限連結</h3>
              {selectedPage.links.map((link, i) => (
                <fieldset key={i}>
                  <legend>連結 {i + 1}</legend>
                  {field("連結文字", link.label, (v) =>
                    translation("pages", {
                      ...t.pages,
                      [p.page]: {
                        ...selectedPage,
                        links: selectedPage.links.map((x, j) =>
                          i === j ? { ...x, label: v } : x,
                        ),
                      },
                    }),
                  )}
                  {field("HTTPS 或固定站內網址", link.url, (v) =>
                    translation("pages", {
                      ...t.pages,
                      [p.page]: {
                        ...selectedPage,
                        links: selectedPage.links.map((x, j) =>
                          i === j ? { ...x, url: v } : x,
                        ),
                      },
                    }),
                  )}
                  <button
                    disabled={!p.canWrite || p.busy}
                    onClick={() =>
                      translation("pages", {
                        ...t.pages,
                        [p.page]: {
                          ...selectedPage,
                          links: selectedPage.links.filter((_, j) => i !== j),
                        },
                      })
                    }
                  >
                    移除此連結
                  </button>
                </fieldset>
              ))}
              <button
                disabled={
                  !p.canWrite || p.busy || selectedPage.links.length >= 10
                }
                onClick={() =>
                  translation("pages", {
                    ...t.pages,
                    [p.page]: {
                      ...selectedPage,
                      links: [...selectedPage.links, { label: "", url: "" }],
                    },
                  })
                }
              >
                新增連結
              </button>
            </section>
          )}
          {p.canWrite && (
            <button onClick={p.onSave} disabled={p.busy}>
              儲存草稿
            </button>
          )}
          <details>
            <summary>查看伺服器草稿／人工比對</summary>
            <p>
              伺服器版本 {p.serverDraft?.draftVersion}
              ；本地未儲存內容保留至明確放棄。
            </p>
            <pre>{JSON.stringify(p.serverDraft?.document, null, 2)}</pre>
            <label>
              <input
                type="checkbox"
                checked={p.confirmation === "reload"}
                onChange={(e) =>
                  p.onConfirm(e.target.checked ? "reload" : null)
                }
              />
              我確認放棄未儲存內容
            </label>
            <button
              disabled={p.confirmation !== "reload" || p.busy}
              onClick={p.onReload}
            >
              放棄並重新載入
            </button>
          </details>
          {section === "preview" && (
            <section>
              <h2>預覽與發布</h2>
              <button
                disabled={p.dirty || p.busy || !p.form.draftVersion}
                onClick={p.onPreview}
              >
                預覽已儲存草稿
              </button>
              {p.preview && (
                <>
                  <p className="preview-banner">
                    未發布預覽 · 草稿版本 {p.preview.draftVersion}
                  </p>
                  <PublicSiteContent
                    preview
                    site={{
                      publicationId: null,
                      conferenceName:
                        p.preview.document.translations[
                          p.preview.document.defaultLocale
                        ].name,
                      document: p.preview.document,
                    }}
                    locale={p.locale}
                    page={p.page}
                  />
                </>
              )}
              <h3>發布檢查</h3>
              <p>
                相較正式版本的主要變更欄位：
                {p.changedFields.join("、") || "無／尚未取得正式內容"}
              </p>
              {p.issues.length ? (
                <ul>
                  {p.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>必要欄位完整，伺服器發布時會再次驗證。</p>
              )}
              {p.canPublish && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      p.onReauthenticate(password);
                      setPassword("");
                    }}
                  >
                    <label>
                      目前密碼
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                    <button disabled={p.busy}>重新驗證密碼</button>
                  </form>
                  <label>
                    <input
                      type="checkbox"
                      checked={p.confirmation === "publish"}
                      onChange={(e) =>
                        p.onConfirm(e.target.checked ? "publish" : null)
                      }
                    />
                    確認發布整站草稿版本 {p.form.draftVersion}
                    ：基本資訊、四個固定頁面與全部啟用語系將取代目前官網。
                  </label>
                  <button
                    disabled={
                      p.dirty ||
                      p.busy ||
                      p.issues.length > 0 ||
                      p.confirmation !== "publish"
                    }
                    onClick={p.onExecute}
                  >
                    確認發布
                  </button>
                </>
              )}
            </section>
          )}
          {section === "history" && (
            <section>
              <h2>發布歷程</h2>
              {!p.history.length && <p>尚無發布紀錄。</p>}
              <ol>
                {p.history.map((item) => (
                  <li key={item.publicationId}>
                    <p>
                      草稿版本 {item.draftVersion} ·{" "}
                      <time>{item.publishedAt}</time>
                    </p>
                    <p>
                      版本 {item.publicationId} · 操作者 {item.publishedBy}
                    </p>
                    <p>變更欄位：{item.changedFields.join(", ")}</p>
                    {p.canWrite && (
                      <button
                        disabled={p.dirty || p.busy}
                        onClick={() => p.onConfirm(item.publicationId)}
                      >
                        載入此版本為新草稿
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              <button
                disabled={!p.offset || p.busy}
                onClick={() => p.onHistoryPage(Math.max(0, p.offset - 20))}
              >
                上一頁
              </button>
              <button
                disabled={p.nextOffset === null || p.busy}
                onClick={() =>
                  p.nextOffset !== null && p.onHistoryPage(p.nextOffset)
                }
              >
                下一頁
              </button>
              {p.confirmation &&
                !["publish", "reload"].includes(p.confirmation) && (
                  <div>
                    <p>
                      將版本 {p.confirmation} 取代目前已儲存草稿{" "}
                      {p.form.draftVersion}，產生新草稿版本；官網保持不變。
                    </p>
                    <button disabled={p.dirty || p.busy} onClick={p.onExecute}>
                      確認載入歷史為新草稿
                    </button>
                    <button onClick={() => p.onConfirm(null)}>取消</button>
                  </div>
                )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
function Locale({
  value,
  onChange,
}: {
  value: SiteLocale;
  onChange: (v: SiteLocale) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>編輯語系</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as SiteLocale)}
      >
        <option value="zh-Hant">繁體中文</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
function SiteField({
  label,
  value,
  onChange,
  multiline,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline: boolean;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
