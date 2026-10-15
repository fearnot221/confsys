import {useEffect,useState} from "react";
import { useInstance } from "../instance/hooks/use-instance.js";
import { useHealth } from "./hooks/use-health.js";
import { HealthScreen } from "./components/health-screen.js";
export function App() {
  const state = useHealth();
  const instance = useInstance();
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.title =
      locale === "zh"
        ? `${instance.data?.conferenceName ?? "研討會"} · 系統狀態`
        : `${instance.data?.conferenceName ?? "Conference"} · System status`;
  }, [locale, instance.data]);
  return (
    <HealthScreen
      {...state}
      conferenceName={instance.data?.conferenceName ?? "研討會"}
      onRefresh={state.refresh}
      locale={locale}
      onLocaleChange={() => setLocale(locale === "zh" ? "en" : "zh")}
    />
  );
}
