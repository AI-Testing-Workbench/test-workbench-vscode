import { createContext, useContext, type ParentProps } from "solid-js";

import type { SessionActionsStore } from "./actions-store";

const SessionActionsContext = createContext<SessionActionsStore>();

export function SessionActionsProvider(props: ParentProps<{ store: SessionActionsStore }>) {
  return (
    <SessionActionsContext.Provider value={props.store}>
      {props.children}
    </SessionActionsContext.Provider>
  );
}

export function useSessionActions() {
  const context = useContext(SessionActionsContext);
  if (!context) {
    throw new Error("useSessionActions must be used within a SessionActionsProvider");
  }
  return context;
}
