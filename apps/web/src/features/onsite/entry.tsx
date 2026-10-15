import { useOnsite } from "./hooks/use-onsite.js";
import { OnsiteScreen } from "./components/onsite-screen.js";
export function OnsiteApp({ admin = false }: { admin?: boolean }) {
  return <OnsiteScreen {...useOnsite(admin)} />;
}
