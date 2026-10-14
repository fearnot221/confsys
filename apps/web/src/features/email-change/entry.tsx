import { useEmailChange } from "./hooks/use-email-change.js";
import { EmailChangeScreen } from "./components/email-change-screen.js";
export default function EmailChangeApp({
  conferenceName,
}: {
  conferenceName: string;
}) {
  return (
    <EmailChangeScreen conferenceName={conferenceName} {...useEmailChange()} />
  );
}
