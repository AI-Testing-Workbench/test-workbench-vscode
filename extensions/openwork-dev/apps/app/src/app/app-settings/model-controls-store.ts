import type { Accessor } from "solid-js";

export type ModelBehaviorOption = { value: string | null; label: string };

export type ModelControlsStore = ReturnType<typeof createModelControlsStore>;

export function createModelControlsStore(options: {
  selectedSessionModelLabel: Accessor<string>;
  openSessionModelPicker: (options?: { returnFocusTarget?: "none" | "composer" }) => void;
  sessionModelVariantLabel: Accessor<string>;
  sessionModelVariant: Accessor<string | null>;
  sessionModelBehaviorOptions: Accessor<ModelBehaviorOption[]>;
  setSessionModelVariant: (value: string | null) => void;
  defaultModelLabel: Accessor<string>;
  defaultModelRef: Accessor<string>;
  openDefaultModelPicker: () => void;
  autoCompactContext: Accessor<boolean>;
  toggleAutoCompactContext: () => void;
  autoCompactContextBusy: Accessor<boolean>;
  defaultModelVariantLabel: Accessor<string>;
  editDefaultModelVariant: () => void;
}) {
  return options;
}
