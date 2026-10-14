import { useNotificationBatches } from "./hooks/use-notification-batches.js";
import { NotificationBatchesScreen } from "./components/notification-batches-screen.js";
export function NotificationBatchesApp() {
  return <NotificationBatchesScreen {...useNotificationBatches()} />;
}
