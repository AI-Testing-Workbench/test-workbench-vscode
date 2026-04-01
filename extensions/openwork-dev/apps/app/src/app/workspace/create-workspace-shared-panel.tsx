import { For, Show, createMemo } from "solid-js";

import { Boxes, Cloud, Loader2, RefreshCcw, Search } from "lucide-solid";

import type { DenOrgSummary, DenWorkerSummary } from "../lib/den";
import {
  errorBannerClass,
  iconTileClass,
  inputClass,
  modalBodyClass,
  pillGhostClass,
  pillPrimaryClass,
  pillSecondaryClass,
  sectionBodyClass,
  sectionTitleClass,
  surfaceCardClass,
  tagClass,
} from "./modal-styles";

type WorkerStatusMeta = {
  label: string;
  tone: "ready" | "warning" | "neutral" | "error";
  canOpen: boolean;
};

const statusBadgeClass = (kind: WorkerStatusMeta["tone"]) => {
  switch (kind) {
    case "ready":
      return "border-emerald-7/30 bg-emerald-3/40 text-emerald-11";
    case "warning":
      return "border-amber-7/30 bg-amber-3/40 text-amber-11";
    case "error":
      return "border-red-7/30 bg-red-3/40 text-red-11";
    default:
      return "border-dls-border bg-dls-hover text-dls-secondary";
  }
};

export default function CreateWorkspaceSharedPanel(props: {
  signedIn: boolean;
  orgs: DenOrgSummary[];
  activeOrgId: string;
  onActiveOrgChange: (orgId: string) => void;
  orgsBusy: boolean;
  orgsError: string | null;
  workers: DenWorkerSummary[];
  workersBusy: boolean;
  workersError: string | null;
  workerSearch: string;
  onWorkerSearchInput: (value: string) => void;
  filteredWorkers: DenWorkerSummary[];
  openingWorkerId: string | null;
  workerStatusMeta: (status: string) => WorkerStatusMeta;
  workerSecondaryLine: (worker: DenWorkerSummary) => string;
  onOpenWorker: (worker: DenWorkerSummary) => void;
  onOpenCloudSignIn: () => void;
  onRefreshWorkers: () => void;
  onOpenCloudDashboard: () => void;
}) {
  const activeOrg = createMemo(
    () => props.orgs.find((org) => org.id === props.activeOrgId) ?? null,
  );

  return (
    <div class={modalBodyClass}>
      <Show
        when={props.signedIn}
        fallback={
          <div class="flex min-h-[320px] items-center justify-center">
            <div class={`${surfaceCardClass} w-full max-w-[420px] p-8 text-center`}>
              <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover text-dls-text">
                <Cloud size={24} />
              </div>
              <div class="mt-5 text-[20px] font-semibold tracking-[-0.3px] text-dls-text">Sign in to OpenWork Cloud</div>
              <div class="mt-2 text-[14px] leading-6 text-dls-secondary">Access remote workers shared with your organization.</div>
              <div class="mt-6 flex justify-center">
                <button type="button" class={pillPrimaryClass} onClick={props.onOpenCloudSignIn}>
                  Continue with Cloud
                </button>
              </div>
              <div class="mt-3 text-[12px] text-dls-secondary">You’ll pick a team and connect to an existing workspace next.</div>
            </div>
          </div>
        }
      >
        <div class="space-y-4">
          <div class={surfaceCardClass}>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class={sectionTitleClass}>Shared workspaces</div>
                <div class={sectionBodyClass}>Choose your organization, then connect to a cloud worker in one step.</div>
              </div>
              <div class="flex min-w-0 items-center gap-2">
                <select
                  value={props.activeOrgId}
                  onChange={(event) => props.onActiveOrgChange(event.currentTarget.value)}
                  disabled={props.orgsBusy || props.orgs.length === 0}
                  class={`${inputClass} h-11 min-w-[180px] py-2 font-medium`}
                >
                  <For each={props.orgs}>
                    {(org) => <option value={org.id}>{org.name}</option>}
                  </For>
                </select>
                <button
                  type="button"
                  class={pillSecondaryClass}
                  onClick={props.onRefreshWorkers}
                  disabled={props.workersBusy || !props.activeOrgId.trim()}
                  title={activeOrg()?.name ?? undefined}
                >
                  <RefreshCcw size={13} class={props.workersBusy ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>

            <div class="mt-4">
              <label class="flex items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3">
                <Search size={15} class="shrink-0 text-dls-secondary" />
                <input
                  type="text"
                  value={props.workerSearch}
                  onInput={(event) => props.onWorkerSearchInput(event.currentTarget.value)}
                  placeholder="Search shared workspaces"
                  class="min-w-0 flex-1 border-none bg-transparent text-[14px] text-dls-text outline-none placeholder:text-dls-secondary"
                />
              </label>
            </div>
          </div>

          <Show when={props.orgsError}>{(value) => <div class={errorBannerClass}>{value()}</div>}</Show>
          <Show when={props.workersError}>{(value) => <div class={errorBannerClass}>{value()}</div>}</Show>

          <Show when={props.workersBusy && props.workers.length === 0}>
            <div class={`${surfaceCardClass} text-[14px] text-dls-secondary`}>Loading shared workspaces…</div>
          </Show>

          <Show when={!props.workersBusy && props.filteredWorkers.length === 0}>
            <div class={`${surfaceCardClass} text-[14px] text-dls-secondary`}>
              {props.workerSearch.trim()
                ? "No shared workspaces match that search."
                : "No shared workspaces available yet."}
            </div>
          </Show>

          <div class="space-y-3">
            <For each={props.filteredWorkers}>
              {(worker) => {
                const status = createMemo(() => props.workerStatusMeta(worker.status));
                return (
                  <div class={`${surfaceCardClass} transition-all duration-150 hover:border-dls-border hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]`}>
                    <div class="flex items-center gap-4">
                      <div class={iconTileClass}>
                        <Boxes size={18} />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="truncate text-[14px] font-medium text-dls-text">{worker.workerName}</div>
                          <span class={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadgeClass(status().tone)}`.trim()}>
                            <span class="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                            {status().label}
                          </span>
                        </div>
                        <div class="mt-1 truncate text-[12px] text-dls-secondary">{props.workerSecondaryLine(worker)}</div>
                      </div>
                      <button
                        type="button"
                        class={pillSecondaryClass}
                        disabled={props.openingWorkerId !== null || !status().canOpen}
                        title={!status().canOpen ? "This workspace is not ready to connect yet." : undefined}
                        onClick={() => props.onOpenWorker(worker)}
                      >
                        <Show when={props.openingWorkerId === worker.workerId} fallback="Connect">
                          <span class="inline-flex items-center gap-2">
                            <Loader2 size={13} class="animate-spin" />
                            Connecting
                          </span>
                        </Show>
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={props.workersBusy && props.workers.length > 0}>
            <div class="text-[12px] text-dls-secondary">Refreshing workspaces…</div>
          </Show>

          <div class="pt-2">
            <button type="button" class={pillGhostClass} onClick={props.onOpenCloudDashboard}>
              Open cloud dashboard
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
