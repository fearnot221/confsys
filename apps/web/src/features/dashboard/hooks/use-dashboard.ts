import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createAuthClient,
  createRegistrationClient,
  createSubmissionClient,
  createFinanceClient,
  createActivitiesClient,
  createReceiptsClient,
  createReviewClient,
  createReportingClient,
  createProgramClient,
} from "@confsys/sdk";
import {
  registrationList,
  registrationConfigResult,
  submissionListSchema,
  submissionConfigSchema,
  financeDashboard,
  activityBookings,
  receiptList,
  programPublicSchema,
  type Permission,
} from "@confsys/contracts";
import type {
  DashboardSection,
  DashboardView,
} from "../components/dashboard-screen.js";
const auth = createAuthClient(),
  registration = createRegistrationClient(),
  submissions = createSubmissionClient(),
  finance = createFinanceClient(),
  activities = createActivitiesClient(),
  receipts = createReceiptsClient(),
  reviews = createReviewClient(),
  reporting = createReportingClient(),
  program = createProgramClient();
const managementLinks: readonly {
  permission: Permission;
  title: string;
  href: string;
}[] = [
  {
    permission: "accounts.directory.read",
    title: "本地帳號管理",
    href: "/access/accounts",
  },
  {
    permission: "access.roles.manage",
    title: "角色邀請",
    href: "/admin/invitations",
  },
  {
    permission: "site.draft.read",
    title: "官網內容與發布",
    href: "/admin/site",
  },
  {
    permission: "registration.manage",
    title: "報名與候補管理",
    href: "/admin/registration",
  },
  {
    permission: "finance.read",
    title: "人工核帳、團體分配與退款",
    href: "/admin/finance",
  },
  {
    permission: "finance.receipt",
    title: "收據發行與更正",
    href: "/admin/receipts",
  },
  {
    permission: "registration.configure",
    title: "餐飲活動管理",
    href: "/admin/activities",
  },
  {
    permission: "submissions.read_all",
    title: "投稿行政工作台",
    href: "/admin/submissions",
  },
  { permission: "reviews.manage", title: "審查與主席工作台", href: "/reviews" },
  { permission: "reviews.assigned", title: "我的審查任務", href: "/reviews" },
  {
    permission: "program.manage",
    title: "議程安排與發布",
    href: "/admin/program",
  },
  {
    permission: "competitions.manage",
    title: "競賽管理",
    href: "/admin/competitions",
  },
  { permission: "competitions.score", title: "競賽評分", href: "/judging" },
  { permission: "onsite.read", title: "報到與活動核銷", href: "/admin/onsite" },
  {
    permission: "onsite.read",
    title: "批次名牌文件",
    href: "/admin/documents",
  },
  {permission: "submissions.manage", title: "報告者變更審批", href: "/admin/presenter-changes"},
  {permission: "documents.template.manage", title: "名牌模板", href: "/admin/badge-template"},
  {
    permission: "reporting.read",
    title: "統計與受控作者預覽",
    href: "/notifications",
  },
  {
    permission: "reporting.export",
    title: "完整資料匯出",
    href: "/admin/exports",
  },
  {
    permission: "notifications.manage",
    title: "批次通知管理",
    href: "/admin/notifications",
  },
];
export function useDashboard(): DashboardView {
  const cache = useQueryClient(),
    [expired, setExpired] = useState(false);
  const account = useQuery({
    queryKey: ["private", "account"],
    queryFn: ({ signal }) => auth.me(signal),
    retry: false,
    enabled: !expired,
  });
  const allowed = !!account.data && !account.error && !expired;
  const query = useQuery({
    queryKey: ["private", "dashboard", account.data?.user.id],
    enabled: allowed,
    retry: false,
    queryFn: async ({ signal }) => {
      const [
        reg,
        papers,
        money,
        bookings,
        docs,
        results,
        notices,
        regConfig,
        paperConfig,
        personalProgram,
        assignedReviews,
      ] = await Promise.all([
        registration
          .call("registrationMine", { offset: 0 }, signal)
          .then((value) => registrationList.parse(value)),
        submissions("submissionList", { scope: "own", offset: 0 }, signal).then(
          (value) => submissionListSchema.parse(value),
        ),
        finance
          .call("financeDashboard", { scope: "own", offset: 0 }, signal)
          .then((value) => financeDashboard.parse(value)),
        activities
          .call("activitiesMine", { offset: 0 }, signal)
          .then((value) => activityBookings.parse(value)),
        receipts
          .operation("receiptMine", { offset: 0 }, signal)
          .then((value) => receiptList.parse(value)),
        reviews.results(0, signal),
        reporting.notifications(0, signal),
        registration
          .call("registrationConfig", null, signal)
          .then((value) => registrationConfigResult.parse(value)),
        submissions("submissionConfig", null, signal).then((value) =>
          submissionConfigSchema.parse(value),
        ),
        program("programMine",null,signal).then(value=>programPublicSchema.parse(value)),
        account.data!.user.permissions.includes('reviews.assigned')?reviews.assigned(0,signal):Promise.resolve(null),
      ]);
      const sections: DashboardSection[] = [
        {
          title: "報名",
          href: "/registration",
          rows: reg.items.map((row) => ({
            id: row.id,
            text: `#${row.number} ${row.badgeName} · ${row.ticketName} · ${row.state}`,
          })),
          more: reg.nextOffset !== null,
        },
        {
          title: "訂單與付款",
          href: "/finance",
          rows: money.orders.map((row) => ({
            id: row.id,
            text: `#${row.registrationNumber} ${row.state} · ${row.amount} ${row.currency}（最小單位）；已分配 ${row.paid}，退款紀錄 ${row.refunded}`,
          })),
          more: money.nextOffset !== null,
        },
        {
          title: "投稿",
          href: "/submissions",
          rows: papers.items.map((row) => ({
            id: row.id,
            text: `#${row.number} ${row.document.title} · ${row.state} · 版本 ${row.version}`,
          })),
          more: papers.nextOffset !== null,
        },
        {
          title: "已發布結果",
          href: "/reviews",
          rows: results.items.map((row) => ({
            id: row.submissionId,
            text: `${row.outcome} · ${row.authorMessage}`,
          })),
          more: results.nextOffset !== null,
        },
        {
          title: "餐飲與活動",
          href: "/activities",
          rows: bookings.items.map((row) => ({
            id: row.id,
            text: `${row.snapshot.name} · ${row.quantity} 名 · ${row.state}`,
          })),
          more: bookings.nextOffset !== null,
        },
        {
          title: "收據",
          href: "/receipts",
          rows: docs.items.map((row) => ({
            id: row.id,
            text: `${row.snapshot.number} · ${row.state} · 修訂 ${row.currentRevision}`,
          })),
          more: docs.nextOffset !== null,
        },
        {
          title: "最新通知",
          href: "/notifications",
          rows: notices.items.map((row) => ({
            id: row.id,
            text: `${row.readAt ? "已讀" : "未讀"} · ${row.subject}`,
          })),
          more: notices.nextOffset !== null,
        },
      ];
      sections.push({title:'我的已發布發表時段',href:'/program',more:false,rows:personalProgram.sessions.flatMap(session=>session.slots.map(slot=>({id:slot.id,text:`${slot.title} · ${slot.startsAt}–${slot.endsAt} · ${session.venue} ${session.roomName}${slot.posterNumber?` · 壁報 ${slot.posterNumber}`:''}`})))});
      if(assignedReviews)sections.push({title:'我的審查任務',href:'/reviews',more:assignedReviews.nextOffset!==null,rows:assignedReviews.items.map(assignment=>({id:assignment.id,text:`${assignment.paper.title} · ${assignment.state} · 截止 ${assignment.form.document.closesAt}`}))});
      const deadlines = [
        ...(assignedReviews?.items.filter(item=>["invited","accepted"].includes(item.state)).map(item=>({title:`審查：${item.paper.title}`,at:item.form.document.closesAt}))??[]),
        ...(regConfig.document
          ? [{ title: "報名截止", at: regConfig.document.closesAt }]
          : []),
        ...(paperConfig.tracks.length && paperConfig.closesAt
          ? [{ title: "投稿截止", at: paperConfig.closesAt }]
          : []),
        ...results.items.flatMap((row) =>
          row.revisionDeadline
            ? [{ title: "補件截止", at: row.revisionDeadline }]
            : [],
        ),
      ];
      return { sections, deadlines };
    },
  });
  const denied = [account.error, query.error].some(
    (error) =>
      error instanceof ApiError &&
      ["SESSION_EXPIRED", "FORBIDDEN"].includes(error.code),
  );
  useEffect(() => {
    if (denied) {
      setExpired(true);
      void cache
        .cancelQueries({ queryKey: ["private"] })
        .then(() => cache.removeQueries({ queryKey: ["private"] }));
    }
  }, [denied, cache]);
  const visible = allowed && !denied;
  const basicLinks = [
    { title: "報名與名牌 QR", href: "/registration" },
    { title: "付款與團體授權", href: "/finance" },
    { title: "投稿與修訂", href: "/submissions" },
    { title: "報告者變更與邀請", href: "/presenter-changes" },
    { title: "餐飲活動預訂", href: "/activities" },
    { title: "我的私有檔案", href: "/account/files" },
    { title: "參加競賽", href: "/competitions" },
    { title: "收據文件", href: "/receipts" },
    { title: "通知中心", href: "/notifications" },
  ];
  return {
    loading: account.isPending || (allowed && query.isPending),
    expired: expired || denied,
    email: visible ? account.data!.user.email : "",
    error:
      denied || expired
        ? "登入已失效或權限已變更，請重新登入。"
        : account.error || query.error
          ? "資料載入失敗；尚未取得的資料不視為零筆。請重試。"
          : "",
    sections: visible && !query.error ? (query.data?.sections ?? []) : [],
    deadlines: visible && !query.error ? (query.data?.deadlines ?? []) : [],
    links: visible
      ? [
          ...basicLinks,
          ...managementLinks
            .filter((link) =>
              account.data!.user.permissions.includes(link.permission),
            )
            .map(({ title, href }) => ({ title, href })),
        ]
      : [],
    onRetry: () => {
      void cache.invalidateQueries({ queryKey: ["private"] });
    },
  };
}
