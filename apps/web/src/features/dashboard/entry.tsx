import {useDashboard} from "./hooks/use-dashboard.js";
import {DashboardScreen} from "./components/dashboard-screen.js";
export function DashboardApp(){return <DashboardScreen {...useDashboard()}/>;}
