import {
  useProgram,
  usePublicProgram,
} from "./hooks/use-program.js";
import {
  ProgramScreen,
  PublicProgramScreen,
} from "./components/program-screen.js";
export function ProgramApp() {
  return <ProgramScreen {...useProgram()} />;
}

export function PublicProgramApp() {
  return <PublicProgramScreen {...usePublicProgram()} />;
}
