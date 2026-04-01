import { createContext, useContext, type ParentProps } from "solid-js";

import type { ConnectionsStore } from "./store";

const ConnectionsContext = createContext<ConnectionsStore>();

export function ConnectionsProvider(props: ParentProps<{ store: ConnectionsStore }>) {
  return (
    <ConnectionsContext.Provider value={props.store}>
      {props.children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections() {
  const context = useContext(ConnectionsContext);
  if (!context) {
    throw new Error("useConnections must be used within a ConnectionsProvider");
  }
  return context;
}
