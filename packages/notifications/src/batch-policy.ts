export type NotificationBatchKind = "general" | "payment_reminder";
export function notificationBatchPermission(kind: NotificationBatchKind) {
  return kind === "payment_reminder"
    ? "finance.reconcile"
    : "notifications.manage";
}
