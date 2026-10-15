import { useState } from "react";
import type { FileAsset, FilePurpose } from "@confsys/contracts";
type Props = {
  loading: boolean;
  busy: boolean;
  expired: boolean;
  error: string;
  message: string;
  items: FileAsset[];
  offset: number;
  nextOffset: number | null;
  canUpload: boolean;
  canMedia: boolean;
  onPage: (offset: number) => void;
  onRefresh: () => void;
  onUpload: (file: File, purpose: FilePurpose) => void;
  onRetry: (id: string) => void;
  onDownload: (file: FileAsset) => void;
};
const statuses = {
  uploading: "上傳未完成",
  quarantined: "隔離／待掃描",
  ready: "可使用",
  rejected: "已拒絕",
};
export function FilesScreen(p: Props) {
  const [file, setFile] = useState<File | null>(null),
    [purpose, setPurpose] = useState<FilePurpose>("manuscript");
  return (
    <main className="shell">
      <header>
        <h1>私人檔案</h1>
        <p>
          上傳 PDF、PNG 或 JPEG，每個檔案最多 8
          MiB。圖片會重新編碼；檔案須完成安全檢查才可下載或引用。
        </p>
      </header>
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      {p.expired && <a href="/login">重新登入</a>}
      {p.canUpload && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (file) p.onUpload(file, purpose);
          }}
        >
          <label>
            用途
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as FilePurpose)}
              disabled={p.busy}
            >
              <option value="manuscript">投稿／簡報</option>
              <option value="payment_evidence">付款憑證</option>
              {p.canMedia && <option value="site_media">官網媒體</option>}
            </select>
          </label>
          <label>
            選擇檔案
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              disabled={p.busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={p.busy || !file} type="submit">
            {p.busy ? "處理中…" : "上傳並檢查"}
          </button>
        </form>
      )}
      <button onClick={p.onRefresh} disabled={p.busy || p.expired}>
        重新整理
      </button>
      {p.loading ? (
        <p role="status">載入中…</p>
      ) : !p.items.length ? (
        <p>尚無檔案。</p>
      ) : (
        <ul>
          {p.items.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong>{" "}
              <span>
                {statuses[item.status]} · {Math.ceil(item.size / 1024)} KiB ·{" "}
                {item.purpose}
              </span>
              <p>
                檔案 ID：<code>{item.id}</code>
              </p>
              {item.status === "ready" && (
                <button disabled={p.busy} onClick={() => p.onDownload(item)}>
                  下載
                </button>
              )}
              {item.status === "quarantined" && (
                <button disabled={p.busy} onClick={() => p.onRetry(item.id)}>
                  重試掃描
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="檔案分頁">
        <button
          disabled={p.offset === 0 || p.busy}
          onClick={() => p.onPage(Math.max(0, p.offset - 50))}
        >
          上一頁
        </button>
        <button
          disabled={p.nextOffset === null || p.busy}
          onClick={() => {
            if (p.nextOffset !== null) p.onPage(p.nextOffset);
          }}
        >
          下一頁
        </button>
      </nav>
    </main>
  );
}
