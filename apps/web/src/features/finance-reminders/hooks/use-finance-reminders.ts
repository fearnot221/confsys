import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFinanceReminderClient } from "@confsys/sdk";
const api = createFinanceReminderClient();
export function useFinanceReminders() {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const cache = useQueryClient(),
    [audienceOffset, setAudienceOffset] = useState(0),
    [batchOffset, setBatchOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState("");
  const audience = useQuery({
      queryKey: ["finance-reminder-audience", audienceOffset],
      queryFn: ({ signal }) => api.preview(audienceOffset, signal),
    }),
    batches = useQuery({
      queryKey: ["finance-reminder-batches", batchOffset],
      queryFn: ({ signal }) => api.list(batchOffset, signal),
    });
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["finance-reminder-audience"] }),
      cache.invalidateQueries({ queryKey: ["finance-reminder-batches"] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () => {
      const fingerprint = JSON.stringify({
        selected: [...selected].sort(),
        reason: reason.trim(),
      });
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      return api.create(
        { idempotencyKey: attempt.current.key, recipientIds: selected, reason },
        new AbortController().signal,
      );
    },
    onSuccess: async () => {
      attempt.current = null;
      setSelected([]);
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.cancel({ id, reason }, new AbortController().signal),
    onSuccess: refresh,
  });
  const error = audience.error ?? batches.error ?? create.error ?? cancel.error;
  return {
    audience: audience.data,
    batches: batches.data,
    audienceOffset,
    batchOffset,
    selected,
    reason,
    setReason,
    pending: create.isPending || cancel.isPending,
    loading: audience.isPending || batches.isPending,
    error:
      error instanceof Error ? error.message : error ? "Request failed" : null,
    queued: create.isSuccess,
    onRefresh: () => void refresh(),
    onToggle: (id: string) =>
      setSelected((ids) =>
        ids.includes(id)
          ? ids.filter((x) => x !== id)
          : ids.length < 100
            ? [...ids, id]
            : ids,
      ),
    onAudiencePage: (offset: number) => {
      setAudienceOffset(offset);
      setSelected([]);
    },
    onBatchPage: setBatchOffset,
    onCreate: () => create.mutate(),
    onCancel: (id: string) => cancel.mutate(id),
  };
}
