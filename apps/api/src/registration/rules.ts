import { visibleRegistrationFields } from "@confsys/contracts";
import type { RegistrationConfig, RegistrationInput } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export function validateRegistrationConfig(d: RegistrationConfig) {
  if (
    Date.parse(d.opensAt) >= Date.parse(d.closesAt) ||
    new Set(d.fields.map((x) => x.key)).size !== d.fields.length ||
    new Set(d.tickets.map((x) => x.id)).size !== d.tickets.length
  )
    throw new AuthError("INVALID_REQUEST");
  for (const f of d.fields)
    if (
      (f.type === "select" || f.type === "multiselect") &&
      (!f.options.length || new Set(f.options).size !== f.options.length)
    )
      throw new AuthError("INVALID_REQUEST");
  for (let index = 0; index < d.fields.length; index++) {
    const condition = d.fields[index]!.showWhen;
    if (!condition) continue;
    const parent = d.fields
      .slice(0, index)
      .find((field) => field.key === condition.fieldKey);
    if (!parent || ["description", "multiselect"].includes(parent.type))
      throw new AuthError("INVALID_REQUEST");
    const valid =
      parent.type === "checkbox"
        ? typeof condition.equals === "boolean"
        : parent.type === "number"
          ? typeof condition.equals === "number"
          : typeof condition.equals === "string" &&
            (parent.type !== "select" ||
              parent.options.includes(condition.equals));
    if (!valid) throw new AuthError("INVALID_REQUEST");
  }
  for (const t of d.tickets) {
    const rates = [...t.rates].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    for (let i = 0; i < rates.length; i++) {
      const r = rates[i]!;
      if (
        Date.parse(r.startsAt) >= Date.parse(r.endsAt) ||
        (i > 0 && Date.parse(rates[i - 1]!.endsAt) > Date.parse(r.startsAt))
      )
        throw new AuthError("INVALID_REQUEST");
    }
  }
}
export function registrationPrice(
  d: RegistrationConfig,
  ticketId: string,
  now: Date,
) {
  const stamp = now.getTime();
  if (stamp < Date.parse(d.opensAt) || stamp >= Date.parse(d.closesAt))
    throw new AuthError("CONFLICT");
  const ticket = d.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new AuthError("INVALID_REQUEST");
  const rate = ticket.rates.find(
    (r) => stamp >= Date.parse(r.startsAt) && stamp < Date.parse(r.endsAt),
  );
  if (!rate) throw new AuthError("CONFLICT");
  return { ticket, amount: rate.amount };
}
export function validateAnswers(
  d: RegistrationConfig,
  answers: RegistrationInput["answers"],
) {
  if (
    Object.keys(answers).some(
      (k) => !d.fields.some((f) => f.key === k && f.type !== "description"),
    )
  )
    throw new AuthError("INVALID_REQUEST");
  const visible = visibleRegistrationFields(d.fields, answers);
  if (
    Object.keys(answers).some(
      (key) => !visible.some((field) => field.key === key),
    )
  )
    throw new AuthError("INVALID_REQUEST");
  for (const f of visible) {
    const v = answers[f.key];
    if (f.type === "description") continue;
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) {
      if (f.required) throw new AuthError("INVALID_REQUEST");
      continue;
    }
    const valid =
      f.type === "checkbox"
        ? typeof v === "boolean" && (!f.required || v)
        : f.type === "number"
          ? typeof v === "number"
          : f.type === "multiselect"
            ? Array.isArray(v) &&
              new Set(v).size === v.length &&
              v.every((x) => f.options.includes(x))
            : typeof v === "string" &&
              (f.type === "select"
                ? f.options.includes(v)
                : f.type === "date"
                  ? /^\d{4}-\d{2}-\d{2}$/.test(v) &&
                    !Number.isNaN(Date.parse(v)) &&
                    new Date(v).toISOString().slice(0, 10) === v
                  : f.type === "text"
                    ? v.length <= 300
                    : true);
    if (!valid) throw new AuthError("INVALID_REQUEST");
  }
}
