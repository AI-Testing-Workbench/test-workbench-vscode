import type { JSX } from "solid-js";

import { ChevronRight } from "lucide-solid";

import {
  iconTileClass,
  interactiveCardClass,
  sectionBodyClass,
  sectionTitleClass,
} from "./modal-styles";

export default function WorkspaceOptionCard(props: {
  title: string;
  description: string;
  icon: (props: { size?: number; class?: string }) => JSX.Element;
  onClick?: () => void;
  disabled?: boolean;
  endAdornment?: JSX.Element;
}) {
  const Icon = props.icon;

  return (
    <button
      type="button"
      onClick={() => props.onClick?.()}
      disabled={props.disabled}
      class={`${interactiveCardClass} group flex w-full items-center gap-4 disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <div class={iconTileClass}>
        <Icon size={18} />
      </div>
      <div class="min-w-0 flex-1">
        <div class={sectionTitleClass}>{props.title}</div>
        <div class={sectionBodyClass}>{props.description}</div>
      </div>
      {props.endAdornment ?? (
        <ChevronRight size={18} class="shrink-0 text-dls-secondary transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
