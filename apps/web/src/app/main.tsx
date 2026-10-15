import React,{Component,lazy,Suspense,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AppBar,type AppBarLink} from "@confsys/ui";
import "../design/styles.css";
const App=lazy(()=>import("../features/health/entry.js").then(module=>({default:module.App})));
const PresenterChangesApp=lazy(()=>import("../features/presenter-changes/entry.js"));
const EmailChangeApp=lazy(()=>import("../features/email-change/entry.js"));
const AuthApp=lazy(()=>import("../features/auth/entry.js").then(module=>({default:module.AuthApp})));
const AccessApp=lazy(()=>import("../features/access/entry.js").then(module=>({default:module.AccessApp})));
const SiteApp=lazy(()=>import("../features/site/entry.js").then(module=>({default:module.SiteApp})));
const SubmissionsApp=lazy(()=>import("../features/submissions/entry.js").then(module=>({default:module.SubmissionsApp})));
const FinanceRemindersApp=lazy(()=>import("../features/finance-reminders/entry.js"));
const FinanceApp=lazy(()=>import("../features/finance/entry.js").then(module=>({default:module.FinanceApp})));
const FilesApp=lazy(()=>import("../features/files/entry.js").then(module=>({default:module.FilesApp})));
const RegistrationApp=lazy(()=>import("../features/registration/entry.js").then(module=>({default:module.RegistrationApp})));
const InvitationsApp=lazy(()=>import("../features/invitations/entry.js").then(module=>({default:module.InvitationsApp})));
const InvitationAcceptApp=lazy(()=>import("../features/invitations/entry.js").then(module=>({default:module.InvitationAcceptApp})));
const ReceiptsApp=lazy(()=>import("../features/documents/entry.js").then(module=>({default:module.ReceiptsApp})));
const DocumentJobsApp=lazy(()=>import("../features/documents/entry.js").then(module=>({default:module.DocumentJobsApp})));
const ReviewsApp=lazy(()=>import("../features/reviews/entry.js").then(module=>({default:module.ReviewsApp})));
const ProgramApp=lazy(()=>import("../features/program/entry.js").then(module=>({default:module.ProgramApp})));
const PublicProgramApp=lazy(()=>import("../features/program/entry.js").then(module=>({default:module.PublicProgramApp})));
const ActivitiesApp=lazy(()=>import("../features/activities/entry.js").then(module=>({default:module.ActivitiesApp})));
const OnsiteApp=lazy(()=>import("../features/onsite/entry.js").then(module=>({default:module.OnsiteApp})));
const ReportingApp=lazy(()=>import("../features/reporting/entry.js").then(module=>({default:module.ReportingApp})));
const CompetitionsApp=lazy(()=>import("../features/competitions/entry.js").then(module=>({default:module.CompetitionsApp})));
const AwardsApp=lazy(()=>import("../features/competitions/entry.js").then(module=>({default:module.AwardsApp})));
const NotificationBatchesApp=lazy(()=>import("../features/notification-batches/entry.js").then(module=>({default:module.NotificationBatchesApp})));
const ExportJobsApp=lazy(()=>import("../features/export-jobs/entry.js").then(module=>({default:module.ExportJobsApp})));
const DashboardApp=lazy(()=>import("../features/dashboard/entry.js").then(module=>({default:module.DashboardApp})));
const BadgeTemplateApp=lazy(()=>import("../features/documents/entry.js").then(module=>({default:module.BadgeTemplateApp})));
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="layout">
        <h1>畫面發生錯誤 / Something went wrong</h1>
        <p>請重新載入頁面。 / Please reload the page.</p>
        <button onClick={() => window.location.reload()}>
          重新載入 / Reload
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const pages:Record<string,ReactNode>={
 "/auth/email-change":<EmailChangeApp/>,
 "/presenter-changes":<PresenterChangesApp/>,
 "/admin/presenter-changes":<PresenterChangesApp admin/>,
 "/dashboard":<DashboardApp/>,
 "/admin/badge-template":<BadgeTemplateApp/>,
 "/admin/exports":<ExportJobsApp/>,
 "/admin/notifications":<NotificationBatchesApp/>,
 "/onsite/pass":<OnsiteApp/>,
 "/admin/onsite":<OnsiteApp admin/>,
 "/admin/documents":<DocumentJobsApp/>,
 "/notifications":<ReportingApp/>,
 "/competitions":<CompetitionsApp/>,
 "/admin/competitions":<CompetitionsApp mode='admin'/>,
 "/judging":<CompetitionsApp mode='judge'/>,
 "/competition-awards":<AwardsApp/>,
 "/activities":<ActivitiesApp/>,
 "/admin/activities":<ActivitiesApp admin/>,
 "/reviews":<ReviewsApp/>,
 "/receipts":<ReceiptsApp/>,
 "/admin/receipts":<ReceiptsApp admin/>,
 "/admin/program":<ProgramApp/>,
 "/program":<PublicProgramApp/>,
 "/finance":<FinanceApp/>,
 "/finance/reminders":<FinanceRemindersApp/>,
 "/admin/finance":<FinanceApp admin/>,
 "/submissions":<SubmissionsApp/>,
 "/admin/submissions":<SubmissionsApp admin/>,
 "/account/files":<FilesApp/>,
 "/registration":<RegistrationApp/>,
 "/admin/registration":<RegistrationApp admin/>,
 "/admin/invitations":<InvitationsApp/>,
 "/auth/invitation":<InvitationAcceptApp/>,
 "/admin/site":<SiteApp/>,
 "/access/accounts":<AccessApp/>,
};
const queryClient=new QueryClient();
const pathname=window.location.pathname;
const page=pages[pathname]??(pathname.startsWith('/auth/')?<AuthApp/>:<App/>);
// Workspace routes share a navigation bar; sign-in flows and /system/status keep their own focused chrome.
const showAppBar=pathname in pages||pathname==="/auth/account";
// Plain navigation only: each destination enforces its own server authorization.
const workspaceLinks:AppBarLink[]=[
 {href:"/dashboard",label:"工作台"},
 {href:"/program",label:"議程"},
 {href:"/",label:"官網"},
 {href:"/auth/account",label:"帳號"},
];
createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><QueryClientProvider client={queryClient}>{showAppBar&&<AppBar title="研討會工作區" links={workspaceLinks} currentPath={pathname}/>}<Suspense fallback={<main className='layout'><p role='status'>載入工作區…</p></main>}>{page}</Suspense></QueryClientProvider></ErrorBoundary></React.StrictMode>);
