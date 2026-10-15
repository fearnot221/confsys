import { useInvitations } from "./hooks/use-invitations.js";
import { useInvitationAcceptance } from "./hooks/use-invitation-acceptance.js";
import { InvitationsScreen } from "./components/invitations-screen.js";
import { InvitationAcceptanceScreen } from "./components/invitation-acceptance-screen.js";
export function InvitationsApp() {
  return <InvitationsScreen {...useInvitations()} />;
}

export function InvitationAcceptApp() {
  return <InvitationAcceptanceScreen {...useInvitationAcceptance()} />;
}
