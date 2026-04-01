import { createContext, useContext, type ParentProps } from "solid-js";

import type { ModelControlsStore } from "./model-controls-store";

const ModelControlsContext = createContext<ModelControlsStore>();

export function ModelControlsProvider(props: ParentProps<{ store: ModelControlsStore }>) {
  return (
    <ModelControlsContext.Provider value={props.store}>
      {props.children}
    </ModelControlsContext.Provider>
  );
}

export function useModelControls() {
  const context = useContext(ModelControlsContext);
  if (!context) {
    throw new Error("useModelControls must be used within a ModelControlsProvider");
  }
  return context;
}
