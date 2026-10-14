import { useFiles } from "./hooks/use-files.js";
import { FilesScreen } from "./components/files-screen.js";
export function FilesApp() {
  return <FilesScreen {...useFiles()} />;
}
