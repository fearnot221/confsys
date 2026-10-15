import { useFinanceReminders } from "./hooks/use-finance-reminders.js";
import { FinanceRemindersScreen } from "./components/finance-reminders-screen.js";
export default function FinanceRemindersApp() {
  return <FinanceRemindersScreen {...useFinanceReminders()} />;
}
