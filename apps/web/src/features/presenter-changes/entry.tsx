import { usePresenterChanges } from "./hooks/use-presenter-changes.js";
import { PresenterChangesScreen } from "./components/presenter-changes-screen.js";
export default function PresenterChangesApp({admin=false}:{admin?:boolean}) { return <PresenterChangesScreen {...usePresenterChanges(admin)}/>; }
