import { Show } from "solid-js";

import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-solid";

import type { AppStatusToastTone } from "../../shell/status-toasts";

export type ComposerNotice = {
  title: string;
  description?: string | null;
  tone?: AppStatusToastTone;
  actionLabel?: string;
  onAction?: () => void;
};

export default function ComposerNotice(props: { notice: ComposerNotice | null }) {
  const tone = () => props.notice?.tone ?? "info";

  return (
    <Show when={props.notice}>
      {(notice) => (
        <div class="absolute bottom-full right-0 mb-3 z-30 w-[min(26rem,calc(100vw-2rem))] max-w-full overflow-hidden rounded-[1.2rem] border border-dls-border bg-dls-surface px-4 py-3 shadow-[var(--dls-shell-shadow)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div class="flex items-start gap-3">
            <div
              class={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${
                tone() === "success"
                  ? "border-emerald-6/40 bg-emerald-4/80 text-emerald-11"
                  : tone() === "warning"
                    ? "border-amber-6/40 bg-amber-4/80 text-amber-11"
                    : tone() === "error"
                      ? "border-red-6/40 bg-red-4/80 text-red-11"
                      : "border-sky-6/40 bg-sky-4/80 text-sky-11"
              }`.trim()}
            >
              <Show
                when={tone() === "success"}
                fallback={
                  tone() === "warning" ? (
                    <AlertTriangle size={18} />
                  ) : tone() === "error" ? (
                    <CircleAlert size={18} />
                  ) : (
                    <Info size={18} />
                  )
                }
              >
                <CheckCircle2 size={18} />
              </Show>
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium leading-relaxed text-dls-text">
                {notice().title}
              </div>
              <Show when={notice().description?.trim()}>
                <p class="mt-1 text-[12px] leading-relaxed text-dls-secondary">
                  {notice().description}
                </p>
              </Show>
              <Show when={notice().actionLabel && notice().onAction}>
                <button
                  type="button"
                  class="mt-3 inline-flex items-center justify-center rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-[12px] font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => notice().onAction?.()}
                >
                  {notice().actionLabel}
                </button>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
