import {
  useCompetitions,
  usePublicCompetitionAwards,
} from "./hooks/use-competitions.js";
import {
  CompetitionsScreen,
  PublicCompetitionAwardsScreen,
} from "./components/competitions-screen.js";
export function CompetitionsApp({
  mode = "author",
}: {
  mode?: "author" | "admin" | "judge";
}) {
  return <CompetitionsScreen {...useCompetitions(mode)} />;
}

export function AwardsApp() {
  return <PublicCompetitionAwardsScreen {...usePublicCompetitionAwards()} />;
}
