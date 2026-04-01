import PresentationalMcpView from "../pages/mcp";

import { useConnections } from "./provider";

export type ConnectionsMcpViewProps = {
  busy: boolean;
  selectedWorkspaceRoot: string;
  isRemoteWorkspace: boolean;
  showHeader?: boolean;
};

export default function ConnectionsMcpView(props: ConnectionsMcpViewProps) {
  const connections = useConnections();

  return (
    <PresentationalMcpView
      showHeader={props.showHeader}
      busy={props.busy}
      selectedWorkspaceRoot={props.selectedWorkspaceRoot}
      isRemoteWorkspace={props.isRemoteWorkspace}
      readConfigFile={connections.readMcpConfigFile}
      mcpServers={connections.mcpServers()}
      mcpStatus={connections.mcpStatus()}
      mcpLastUpdatedAt={connections.mcpLastUpdatedAt()}
      mcpStatuses={connections.mcpStatuses()}
      mcpConnectingName={connections.mcpConnectingName()}
      selectedMcp={connections.selectedMcp()}
      setSelectedMcp={connections.setSelectedMcp}
      quickConnect={connections.quickConnect}
      connectMcp={connections.connectMcp}
      authorizeMcp={connections.authorizeMcp}
      logoutMcpAuth={connections.logoutMcpAuth}
      removeMcp={connections.removeMcp}
    />
  );
}
