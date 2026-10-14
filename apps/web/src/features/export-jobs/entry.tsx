import { useExportJobs } from "./hooks/use-export-jobs.js";
import { ExportJobsScreen } from "./components/export-jobs-screen.js";
export function ExportJobsApp() {
  return <ExportJobsScreen {...useExportJobs()} />;
}
