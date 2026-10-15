import { useReporting } from "./hooks/use-reporting.js";
import { ReportingScreen } from "./components/reporting-screen.js";
export function ReportingApp() {
  return <ReportingScreen {...useReporting()} />;
}
