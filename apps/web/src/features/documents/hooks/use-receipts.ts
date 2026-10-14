import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient, createReceiptsClient, ApiError } from "@confsys/sdk";
import { receiptList, receiptSchema, type Receipt } from "@confsys/contracts";
const client = createReceiptsClient(),
  auth = createAuthClient();
function amountLabel(receipt: Receipt) {
  const formatter = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: receipt.snapshot.currency,
  });
  return formatter.format(
    Number(receipt.snapshot.amount) /
      10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2),
  );
}
export function useReceipts(administrative = false) {
  const queries = useQueryClient(),
    epoch = useRef(0),
    active = useRef<AbortController | null>(null);
  const [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [expired, setExpired] = useState(false);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    enabled: !expired,
    retry: false,
  });
  const canManage =
      !expired &&
      (account.data?.user.permissions.includes("finance.receipt") ?? false),
    canRead =
      !!account.data &&
      !account.error &&
      !expired &&
      (!administrative || canManage);
  const list = useQuery({
    queryKey: ["private", "receipts", administrative, offset],
    queryFn: async ({ signal }) =>
      receiptList.parse(
        await client.operation(
          administrative ? "receiptAdmin" : "receiptMine",
          { offset },
          signal,
        ),
      ),
    enabled: canRead,
    retry: false,
  });
  const expire = () => {
    ++epoch.current;
    active.current?.abort();
    setExpired(true);
    setBusy(false);
    setMessage("");
    setError("登入已失效或權限已變更，請重新登入。");
    void queries.cancelQueries({ queryKey: ["private"] });
    queries.removeQueries({ queryKey: ["private"] });
  };
  useEffect(() => {
    const e = account.error ?? list.error;
    if (
      e instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
    )
      expire();
  }, [account.error, list.error]);
  useEffect(
    () => () => {
      ++epoch.current;
      active.current?.abort();
    },
    [],
  );
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(c.signal);
    } catch (e) {
      if (ticket === epoch.current && !c.signal.aborted) {
        if (
          e instanceof ApiError &&
          ["SESSION_EXPIRED", "FORBIDDEN"].includes(e.code)
        )
          expire();
        else
          setError(
            e instanceof ApiError && e.code === "CONFLICT"
              ? "訂單尚未全額核帳、收據已作廢或版本已更新。請重新整理。"
              : "操作失敗，請檢查輸入後重試。",
          );
      }
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  const mutate = (
    operation: "receiptIssue" | "receiptCorrect" | "receiptVoid",
    input: unknown,
  ) =>
    void perform(async (signal) => {
      const receipt = receiptSchema.parse(
        await client.operation(operation, input, signal),
      );
      if (signal.aborted) return;
      setMessage(`收據 ${receipt.snapshot.number} 已更新。`);
      await queries.invalidateQueries({ queryKey: ["private", "receipts"] });
    });
  return {
    loading: !expired && (account.isPending || (canRead && list.isPending)),
    busy,
    expired,
    error:
      error ||
      (!account.isPending && !canRead
        ? "沒有收據管理權限。"
        : list.error
          ? "讀取失敗，請重試。"
          : ""),
    message,
    items: canRead
      ? (list.data?.items ?? []).map((receipt) => ({
          ...receipt,
          amountLabel: amountLabel(receipt),
        }))
      : [],
    administrative,
    canManage,
    offset,
    nextOffset: list.data?.nextOffset ?? null,
    onPage: setOffset,
    onRefresh: () => {
      void queries.invalidateQueries({ queryKey: ["private", "receipts"] });
    },
    onIssue: (input: unknown) => mutate("receiptIssue", input),
    onCorrect: (input: unknown) => mutate("receiptCorrect", input),
    onVoid: (input: unknown) => mutate("receiptVoid", input),
    onDownload: (receipt: Receipt, revision = receipt.currentRevision) =>
      void perform(async (signal) => {
        const blob = await client.download(receipt, revision, signal);
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = `receipt-${receipt.snapshot.number}-v${revision}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
  };
}
