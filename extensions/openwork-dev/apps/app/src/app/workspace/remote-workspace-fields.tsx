import { Show } from "solid-js";

import { Globe } from "lucide-solid";

import {
  iconTileClass,
  inputClass,
  inputHintClass,
  inputLabelClass,
  pillSecondaryClass,
  surfaceCardClass,
} from "./modal-styles";

export default function RemoteWorkspaceFields(props: {
  hostUrl: string;
  onHostUrlInput: (value: string) => void;
  token: string;
  tokenVisible: boolean;
  onTokenInput: (value: string) => void;
  onToggleTokenVisible: () => void;
  displayName: string;
  onDisplayNameInput: (value: string) => void;
  directory?: string;
  onDirectoryInput?: (value: string) => void;
  showDirectory?: boolean;
  submitting?: boolean;
  hostInputRef?: HTMLInputElement | undefined;
  title: string;
  description: string;
}) {
  return (
    <div class={surfaceCardClass}>
      <div class="flex items-start gap-3">
        <div class={iconTileClass}>
          <Globe size={17} />
        </div>
        <div class="min-w-0">
          <div class="text-[15px] font-medium tracking-[-0.2px] text-dls-text">{props.title}</div>
          <div class="mt-1 text-[13px] leading-relaxed text-dls-secondary">{props.description}</div>
        </div>
      </div>

      <div class="mt-5 grid gap-4">
        <label class="grid gap-2">
          <span class={inputLabelClass}>Worker URL</span>
          <input
            ref={props.hostInputRef}
            type="url"
            value={props.hostUrl}
            onInput={(event) => props.onHostUrlInput(event.currentTarget.value)}
            placeholder="https://worker.example.com"
            disabled={props.submitting}
            class={inputClass}
          />
          <span class={inputHintClass}>Paste the OpenWork worker URL you want to connect to.</span>
        </label>

        <label class="grid gap-2">
          <span class={inputLabelClass}>Access token</span>
          <div class="flex items-center gap-2 rounded-xl border border-dls-border bg-dls-surface p-1.5">
            <input
              type={props.tokenVisible ? "text" : "password"}
              value={props.token}
              onInput={(event) => props.onTokenInput(event.currentTarget.value)}
              placeholder="Optional"
              disabled={props.submitting}
              class="min-w-0 flex-1 border-none bg-transparent px-2 py-1.5 text-[14px] text-dls-text outline-none placeholder:text-dls-secondary"
            />
            <button
              type="button"
              class={pillSecondaryClass}
              onClick={props.onToggleTokenVisible}
              disabled={props.submitting}
            >
              {props.tokenVisible ? "Hide" : "Show"}
            </button>
          </div>
          <span class={inputHintClass}>Add a token only if the worker requires one.</span>
        </label>

        <Show when={props.showDirectory}>
          <label class="grid gap-2">
            <span class={inputLabelClass}>Remote directory</span>
            <input
              type="text"
              value={props.directory ?? ""}
              onInput={(event) => props.onDirectoryInput?.(event.currentTarget.value)}
              placeholder="Optional"
              disabled={props.submitting}
              class={inputClass}
            />
            <span class={inputHintClass}>Optionally target a directory within that remote worker.</span>
          </label>
        </Show>

        <label class="grid gap-2">
          <span class={inputLabelClass}>Display name <span class="font-normal text-dls-secondary">(optional)</span></span>
          <input
            type="text"
            value={props.displayName}
            onInput={(event) => props.onDisplayNameInput(event.currentTarget.value)}
            placeholder="Worker name"
            disabled={props.submitting}
            class={inputClass}
          />
        </label>
      </div>
    </div>
  );
}
