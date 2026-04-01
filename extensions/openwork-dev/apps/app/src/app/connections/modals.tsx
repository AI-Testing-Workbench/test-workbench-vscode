import type { Client } from "../types";
import type { Language } from "../../i18n";
import McpAuthModal from "../components/mcp-auth-modal";

import { useConnections } from "./provider";

export type ConnectionsModalsProps = {
  client: Client | null;
  projectDir: string;
  language: Language;
  reloadBlocked: boolean;
  activeSessions: Array<{ id: string; title: string }>;
  isRemoteWorkspace: boolean;
  onForceStopSession: (sessionID: string) => void | Promise<void>;
  onReloadEngine: () => void | Promise<void>;
};

export default function ConnectionsModals(props: ConnectionsModalsProps) {
  const connections = useConnections();

  return (
    <McpAuthModal
      open={connections.mcpAuthModalOpen()}
      client={props.client}
      entry={connections.mcpAuthEntry()}
      projectDir={props.projectDir}
      language={props.language}
      reloadRequired={connections.mcpAuthNeedsReload()}
      reloadBlocked={props.reloadBlocked}
      activeSessions={props.activeSessions}
      isRemoteWorkspace={props.isRemoteWorkspace}
      onForceStopSession={props.onForceStopSession}
      onClose={connections.closeMcpAuthModal}
      onComplete={connections.completeMcpAuthModal}
      onReloadEngine={props.onReloadEngine}
    />
  );
}
