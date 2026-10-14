import { useState } from "react";
import type {
  NotificationTemplate,
  NotificationTemplateDraft,
} from "@confsys/contracts";
type Props = {
  busy: boolean;
  items: NotificationTemplate[];
  offset: number;
  next: number | null;
  onPage: (offset: number) => void;
  onApply: (template: NotificationTemplate) => void;
  onSave: (draft: NotificationTemplateDraft) => Promise<void>;
  subject: string;
  text: string;
};
export function NotificationTemplatePanel(p: Props) {
  const [key, setKey] = useState(""),
    [name, setName] = useState(""),
    [expectedVersion, setExpectedVersion] = useState(0);
  return (
    <section aria-label="通知範本版本">
      <h2>通知範本版本</h2>
      <p>
        範本僅儲存一般文字，不插入私人欄位。套用後可在下方確認主旨與本文；修改內容會解除範本版本連結。
      </p>
      <ul>
        {p.items.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              disabled={p.busy}
              onClick={() => {
                setKey(template.key);
                setName(template.name);
                setExpectedVersion(template.version);
                p.onApply(template);
              }}
            >
              套用範本：{template.name} v{template.version}
            </button>
            <details>
              <summary>
                預覽：{template.name} v{template.version}
              </summary>
              <p>{template.subject}</p>
              <pre className="whitespace-pre-wrap">{template.text}</pre>
            </details>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={p.busy || !p.offset}
        onClick={() => p.onPage(Math.max(0, p.offset - 20))}
      >
        上一頁範本
      </button>
      <button
        type="button"
        disabled={p.busy || p.next === null}
        onClick={() => {
          if (p.next !== null) p.onPage(p.next);
        }}
      >
        下一頁範本
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void p.onSave({
            key,
            name,
            expectedVersion,
            subject: p.subject,
            text: p.text,
          });
        }}
      >
        <h3>將目前通知內容保存為新版本</h3>
        <label>
          範本識別字
          <input
            required
            pattern="[a-z0-9-]{1,80}"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setExpectedVersion(0);
            }}
          />
        </label>
        <label>
          範本名稱
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p>
          目前基礎版本：{expectedVersion}
          。編修既有範本請先套用最新版本；新識別字從版本0開始。
        </p>
        <button disabled={p.busy || !p.subject.trim() || !p.text.trim()}>
          保存範本新版本
        </button>
      </form>
    </section>
  );
}
