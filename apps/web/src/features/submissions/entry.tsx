import { useSubmissions } from "./hooks/use-submissions.js";
import { SubmissionsScreen } from "./components/submissions-screen.js";
export function SubmissionsApp({ admin = false }: { admin?: boolean }) {
  return <SubmissionsScreen {...useSubmissions(admin)} />;
}
