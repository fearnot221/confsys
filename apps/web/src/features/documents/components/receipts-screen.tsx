import { useState } from "react";
import type { Receipt } from "@confsys/contracts";
type Props = {
  loading: boolean;
  busy: boolean;
  expired: boolean;
  error: string;
  message: string;
  items: (Receipt & { amountLabel: string })[];
  administrative: boolean;
  canManage: boolean;
  offset: number;
  nextOffset: number | null;
  onPage: (offset: number) => void;
  onRefresh: () => void;
  onIssue: (input: unknown) => void;
  onCorrect: (input: unknown) => void;
  onReissue: (input: unknown) => void;
  onInspect: (id: string) => void;
  onVoid: (input: unknown) => void;
  onDownload: (receipt: Receipt, revision?: number) => void;
};
export function ReceiptsScreen(p: Props) {
  const [orderId, setOrderId] = useState(""),
    [buyerName, setBuyerName] = useState(""),
    [buyerTaxId, setBuyerTaxId] = useState(""),
    [buyerAddress, setBuyerAddress] = useState(""),
    [reason, setReason] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = p.items.find((item) => item.id === selectedId) ?? null;
  const select = (receipt: Receipt) => {
    setSelectedId(receipt.id);
    setBuyerName(receipt.snapshot.buyerName);
    setBuyerTaxId(receipt.snapshot.buyerTaxId);
    setBuyerAddress(receipt.snapshot.buyerAddress);
    setReason("");
  };
  return (
    <main className="layout">
      <header>
        <h1>{p.administrative ? "收據管理" : "我的收據"}</h1>
        <a href="/auth/account">帳號</a>
      </header>
      <p>收據為會議收款紀錄，不代表法定電子發票。作廢收據不會自動退款。</p>
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      {p.expired ? (
        <a href="/auth/login">重新登入</a>
      ) : (
        <button disabled={p.busy} onClick={p.onRefresh}>
          重新整理
        </button>
      )}
      {p.administrative && p.canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const buyer = { buyerName, buyerTaxId, buyerAddress, reason };
            if (selected)
              p.onCorrect({
                ...buyer,
                receiptId: selected.id,
                expectedRevision: selected.currentRevision,
              });
            else p.onIssue({ ...buyer, orderId });
          }}
        >
          <h2>
            {selected
              ? `${selected.state === "void" ? "重開" : "更正"} ${selected.snapshot.number}`
              : "發行收據"}
          </h2>
          {!selected && (
            <label>
              已全額核帳的訂單 ID
              <input
                required
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              />
            </label>
          )}
          <label>
            收據抬頭
            <input
              required
              maxLength={160}
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />
          </label>
          <label>
            統一編號／識別號
            <input
              maxLength={30}
              value={buyerTaxId}
              onChange={(e) => setBuyerTaxId(e.target.value)}
            />
          </label>
          <label>
            地址
            <input
              maxLength={300}
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
            />
          </label>
          <label>
            操作理由
            <input
              required
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={p.busy || selected?.state === "void"} type="submit">
            {selected ? "保存更正版本" : "確認發行"}
          </button>
          {selected && (
            <>
              {selected.state === "void" && !selected.replacedBy && (
                <button
                  type="button"
                  disabled={
                    p.busy || reason.trim().length < 3 || !buyerName.trim()
                  }
                  onClick={() =>
                    p.onReissue({
                      receiptId: selected.id,
                      expectedRevision: selected.currentRevision,
                      buyerName,
                      buyerTaxId,
                      buyerAddress,
                      reason,
                    })
                  }
                >
                  以新號碼重開已作廢收據
                </button>
              )}
              <button
                type="button"
                disabled={
                  p.busy ||
                  selected.state === "void" ||
                  reason.trim().length < 3
                }
                onClick={() =>
                  p.onVoid({
                    receiptId: selected.id,
                    expectedRevision: selected.currentRevision,
                    reason,
                  })
                }
              >
                確認作廢此收據
              </button>
              <button type="button" onClick={() => setSelectedId(null)}>
                返回發行
              </button>
            </>
          )}
        </form>
      )}
      {p.loading ? (
        <p role="status">載入中…</p>
      ) : !p.items.length ? (
        <p>尚無收據。</p>
      ) : (
        <ul>
          {p.items.map((receipt) => (
            <li key={receipt.id}>
              <h2>
                {receipt.snapshot.number} ·{" "}
                {receipt.state === "void" ? "已作廢" : "已發行"}
              </h2>
              <p>
                {receipt.snapshot.buyerName} · {receipt.amountLabel} · 第{" "}
                {receipt.currentRevision} 版
              </p>
              {receipt.voidReason && <p>作廢理由：{receipt.voidReason}</p>}
              {receipt.reissuedFrom && (
                <p>
                  重開來源：
                  <button
                    disabled={p.busy}
                    onClick={() => p.onInspect(receipt.reissuedFrom!.id)}
                  >
                    {receipt.reissuedFrom.number}
                  </button>
                  ；理由：{receipt.reissueReason}
                </p>
              )}
              {receipt.replacedBy && (
                <p>
                  已重開為：
                  <button
                    disabled={p.busy}
                    onClick={() => p.onInspect(receipt.replacedBy!.id)}
                  >
                    {receipt.replacedBy.number}
                  </button>
                </p>
              )}
              <button disabled={p.busy} onClick={() => p.onDownload(receipt)}>
                下載／重印 PDF
              </button>
              {receipt.currentRevision > 1 && (
                <label>
                  歷史版本
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value)
                        p.onDownload(receipt, Number(e.target.value));
                    }}
                  >
                    <option value="">選擇版本下載</option>
                    {Array.from({ length: receipt.currentRevision }, (_, i) => (
                      <option key={i} value={i + 1}>
                        第 {i + 1} 版
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {p.administrative && p.canManage && (
                <button disabled={p.busy} onClick={() => select(receipt)}>
                  {receipt.state === "void" ? "檢視／重開" : "更正／作廢"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="收據分頁">
        <button
          disabled={p.offset === 0 || p.busy}
          onClick={() => p.onPage(Math.max(0, p.offset - 20))}
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
