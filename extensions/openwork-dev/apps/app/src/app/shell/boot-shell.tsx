import { createWorkspaceShellLayout } from "../lib/workspace-shell-layout";

export default function BootShell() {
  const { leftSidebarWidth } = createWorkspaceShellLayout({ expandedRightWidth: 280 });

  return (
    <div class="h-[100dvh] min-h-screen w-full overflow-hidden bg-[var(--dls-app-bg)] p-3 md:p-4 text-dls-text font-sans">
      <div class="flex h-full w-full gap-3 md:gap-4">
        <aside
          class="relative hidden lg:flex shrink-0 flex-col overflow-hidden rounded-[24px] border border-dls-border bg-dls-sidebar p-2.5"
          style={{
            width: `${leftSidebarWidth()}px`,
            "min-width": `${leftSidebarWidth()}px`,
          }}
          aria-hidden="true"
        />

        <main
          class="min-w-0 flex-1 overflow-hidden rounded-[24px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
