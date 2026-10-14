import { useRegistration } from "./hooks/use-registration.js";
import { RegistrationScreen } from "./components/registration-screen.js";
export function RegistrationApp({ admin = false }: { admin?: boolean }) {
  return <RegistrationScreen {...useRegistration(admin)} />;
}
