import { createMemo } from "solid-js";

import { normalizeDirectoryPath } from "../utils";

export function createWorkspaceContextKey(options: {
  selectedWorkspaceId: () => string;
  selectedWorkspaceRoot: () => string;
  runtimeWorkspaceId?: () => string | null;
  workspaceType?: () => "local" | "remote";
}) {
  return createMemo(() => {
    const workspaceId = options.selectedWorkspaceId().trim();
    const root = normalizeDirectoryPath(options.selectedWorkspaceRoot().trim());
    const runtimeWorkspaceId = (options.runtimeWorkspaceId?.() ?? "").trim();
    const workspaceType = options.workspaceType?.() ?? "local";
    return `${workspaceType}:${workspaceId}:${root}:${runtimeWorkspaceId}`;
  });
}
