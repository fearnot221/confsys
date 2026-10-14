import type { ProgramDraft } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export function assertInterval(start: string, end: string) {
  if (
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    Date.parse(start) >= Date.parse(end)
  )
    throw new AuthError("INVALID_REQUEST");
}
export function contains(
  parent: { startsAt: string; endsAt: string },
  child: { startsAt: string; endsAt: string },
) {
  return (
    Date.parse(child.startsAt) >= Date.parse(parent.startsAt) &&
    Date.parse(child.endsAt) <= Date.parse(parent.endsAt)
  );
}
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new AuthError("CONFLICT");
}
export function assertIdKind(
  draft: ProgramDraft,
  id: string,
  kind: "room" | "blocked" | "session" | "slot",
) {
  const lists = {
    room: draft.rooms,
    blocked: draft.blocked,
    session: draft.sessions,
    slot: draft.slots,
  };
  if (
    Object.entries(lists).some(
      ([key, items]) => key !== kind && items.some((item) => item.id === id),
    )
  )
    throw new AuthError("CONFLICT");
  const limit =
    kind === "room"
      ? 100
      : kind === "blocked"
        ? 1000
        : kind === "session"
          ? 500
          : 5000;
  if (!lists[kind].some((v) => v.id === id) && lists[kind].length >= limit)
    throw new AuthError("CONFLICT");
}
