import { createContext, useContext, type ParentProps } from "solid-js";

import type { OpenworkServerStore } from "./openwork-server-store";

const OpenworkServerContext = createContext<OpenworkServerStore>();

export function OpenworkServerProvider(props: ParentProps<{ store: OpenworkServerStore }>) {
  return (
    <OpenworkServerContext.Provider value={props.store}>
      {props.children}
    </OpenworkServerContext.Provider>
  );
}

export function useOpenworkServer() {
  const context = useContext(OpenworkServerContext);
  if (!context) {
    throw new Error("useOpenworkServer must be used within an OpenworkServerProvider");
  }
  return context;
}
