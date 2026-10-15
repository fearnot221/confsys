import {useBadgeTemplate} from "./hooks/use-badge-template.js";
import {BadgeTemplateScreen} from "./components/badge-template-screen.js";
import { useDocumentJobs } from "./hooks/use-document-jobs.js";
import { DocumentJobsScreen } from "./components/document-jobs-screen.js";
import { useReceipts } from "./hooks/use-receipts.js";
import { ReceiptsScreen } from "./components/receipts-screen.js";
export function ReceiptsApp({ admin = false }: { admin?: boolean }) {
  return <ReceiptsScreen {...useReceipts(admin)} />;
}

export function DocumentJobsApp() {
  return <DocumentJobsScreen {...useDocumentJobs()} />;
}

export function BadgeTemplateApp(){return <BadgeTemplateScreen {...useBadgeTemplate()}/>;}
