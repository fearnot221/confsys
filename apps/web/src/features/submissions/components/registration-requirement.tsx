import type { SubmissionRegistrationRequirement } from "@confsys/contracts";
export function RegistrationRequirement({
  requirement,
  administrative = false,
}: {
  requirement: SubmissionRegistrationRequirement | null;
  administrative?: boolean;
}) {
  if (!requirement || requirement.state === "not_required") return null;
  const status = {
    pending: "尚待完成報名",
    overdue: "已超過錄取後報名期限",
    satisfied: "已完成報名",
  }[requirement.state];
  return (
    <aside aria-label="錄取後報名要求">
      <p>
        {status}。截止：{requirement.deadline}（UTC）。
      </p>
      <p>
        此要求以已確認的報名為準，不代表已付款。逾期未報名會限制新增議程與競賽操作，不會自動撤稿或改寫已發布內容。
      </p>
      {!administrative && requirement.state !== "satisfied" && (
        <a href="/registration">前往報名</a>
      )}
    </aside>
  );
}
