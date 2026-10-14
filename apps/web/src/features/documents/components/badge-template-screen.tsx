import { useEffect, useState } from "react";
import type { BadgeTemplate, BadgeTemplateDocument } from "@confsys/contracts";
type Props = {
  current: BadgeTemplate | undefined;
  canRead: boolean;
  canManage: boolean;
  busy: boolean;
  loading: boolean;
  error: string;
  message: string;
  save: (document: BadgeTemplateDocument) => unknown;
  reload: () => unknown;
  preview: () => unknown;
};
const initial: BadgeTemplateDocument = {
  size: "large",
  layout: "centered",
  showAffiliation: true,
  showRegistrationNumber: true,
  footer: "",
};
export function BadgeTemplateScreen(props: Props) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    setDraft(props.current?.document ?? initial);
  }, [props.current]);
  if (props.loading)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p role="status">載入名牌模板…</p>
      </main>
    );
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">名牌模板</h1>
      <p>
        版本 {props.current?.version ?? 0}。既有批次保留建立時的模板；報到 QR
        碼固定顯示。
      </p>
      {props.error && <p role="alert">{props.error}</p>}
      {props.message && <p role="status">{props.message}</p>}
      {props.canRead && (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={props.busy}
              onClick={() => props.reload()}
            >
              重新載入
            </button>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => props.preview()}
            >
              下載已儲存模板預覽
            </button>
          </div>
          {props.canManage && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                props.save(draft);
              }}
            >
              <fieldset disabled={props.busy} className="space-y-4">
                <legend>版面設定</legend>
                <label className="block">
                  尺寸
                  <select
                    value={draft.size}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        size:
                          e.target.value === "credit_card"
                            ? "credit_card"
                            : "large",
                      })
                    }
                  >
                    <option value="large">大型名牌 100 × 140 mm</option>
                    <option value="credit_card">卡片 86 × 54 mm</option>
                  </select>
                </label>
                <label className="block">
                  文字排列
                  <select
                    value={draft.layout}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        layout: e.target.value === "left" ? "left" : "centered",
                      })
                    }
                  >
                    <option value="centered">置中</option>
                    <option value="left">靠左</option>
                  </select>
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={draft.showAffiliation}
                    onChange={(e) =>
                      setDraft({ ...draft, showAffiliation: e.target.checked })
                    }
                  />{" "}
                  顯示單位
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={draft.showRegistrationNumber}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        showRegistrationNumber: e.target.checked,
                      })
                    }
                  />{" "}
                  顯示報名編號
                </label>
                <label className="block">
                  頁尾文字（需能容納單行）
                  <input
                    maxLength={120}
                    value={draft.footer}
                    onChange={(e) =>
                      setDraft({ ...draft, footer: e.target.value })
                    }
                  />
                </label>
                <p>
                  預覽使用合成人名與無法核銷的 QR
                  碼。過長或不支援的文字會明確失敗，不截斷姓名。
                </p>
                <button type="submit">
                  {props.busy ? "處理中…" : "儲存新版本"}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </main>
  );
}
