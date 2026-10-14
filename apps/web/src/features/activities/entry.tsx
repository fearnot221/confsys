import { useActivities } from "./hooks/use-activities.js";
import { ActivitiesScreen } from "./components/activities-screen.js";
export function ActivitiesApp({ admin = false }: { admin?: boolean }) {
  return <ActivitiesScreen {...useActivities(admin)} />;
}
