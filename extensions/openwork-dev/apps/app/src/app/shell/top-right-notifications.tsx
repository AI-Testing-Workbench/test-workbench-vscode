import ReloadWorkspaceToast from "../components/reload-workspace-toast";
import { StatusToastsViewport } from "./status-toasts";

import type { ReloadTrigger } from "../types";

export type TopRightNotificationsProps = {
  reloadOpen: boolean;
  reloadTitle: string;
  reloadDescription: string;
  reloadTrigger?: ReloadTrigger | null;
  reloadError?: string | null;
  reloadLabel: string;
  dismissLabel: string;
  reloadBusy?: boolean;
  canReload: boolean;
  hasActiveRuns: boolean;
  onReload: () => void;
  onDismissReload: () => void;
};

export default function TopRightNotifications(props: TopRightNotificationsProps) {
  return (
    <div class="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] max-w-full flex-col gap-3 sm:right-6 sm:top-6">
      <div class="pointer-events-auto">
        <ReloadWorkspaceToast
          open={props.reloadOpen}
          title={props.reloadTitle}
          description={props.reloadDescription}
          trigger={props.reloadTrigger}
          error={props.reloadError}
          reloadLabel={props.reloadLabel}
          dismissLabel={props.dismissLabel}
          busy={props.reloadBusy}
          canReload={props.canReload}
          hasActiveRuns={props.hasActiveRuns}
          onReload={props.onReload}
          onDismiss={props.onDismissReload}
        />
      </div>

      <StatusToastsViewport />
    </div>
  );
}
