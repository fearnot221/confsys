import { useSite } from "./hooks/use-site.js";
import { SiteScreen } from "./components/site-screen.js";
export function SiteApp() {
  const state = useSite();
  return <SiteScreen {...state} />;
}
