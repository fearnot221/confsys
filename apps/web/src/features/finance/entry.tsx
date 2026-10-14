import { useFinance } from "./hooks/use-finance.js";
import { FinanceScreen } from "./components/finance-screen.js";
export function FinanceApp({ admin = false }: { admin?: boolean }) {
  return <FinanceScreen {...useFinance(admin)} />;
}
