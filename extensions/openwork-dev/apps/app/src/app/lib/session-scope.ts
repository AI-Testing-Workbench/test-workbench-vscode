import { normalizeDirectoryPath } from "../utils";
import { normalizeDirectoryQueryPath } from "../utils";

type WorkspaceType = "local" | "remote";

export function resolveScopedClientDirectory(input: {
  directory?: string | null;
  targetRoot?: string | null;
  workspaceType?: WorkspaceType | null;
}) {
  const directory = toSessionTransportDirectory(input.directory);
  if (directory) return directory;

  if (input.workspaceType === "remote") return "";

  return toSessionTransportDirectory(input.targetRoot);
}

export function toSessionTransportDirectory(input?: string | null) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  if (/^\\\\\?\\UNC\\/i.test(trimmed)) {
    return `\\${trimmed.slice(7)}`;
  }

  if (/^\\\\\?\\[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed.slice(4);
  }

  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(trimmed)) {
    return trimmed;
  }

  return normalizeDirectoryQueryPath(trimmed);
}

export function describeDirectoryScope(input?: string | null) {
  const raw = input ?? "";
  const trimmed = raw.trim();
  const transport = toSessionTransportDirectory(trimmed);
  const normalized = normalizeDirectoryPath(trimmed);
  return {
    raw: trimmed || null,
    transport: transport || null,
    normalized: normalized || null,
  };
}

export function scopedRootsMatch(a?: string | null, b?: string | null) {
  const left = normalizeDirectoryPath(a ?? "");
  const right = normalizeDirectoryPath(b ?? "");
  if (!left || !right) return false;
  return left === right;
}

export function shouldApplyScopedSessionLoad(input: {
  loadedScopeRoot?: string | null;
  workspaceRoot?: string | null;
}) {
  const workspaceRoot = normalizeDirectoryPath(input.workspaceRoot ?? "");
  if (!workspaceRoot) return true;
  return scopedRootsMatch(input.loadedScopeRoot, workspaceRoot);
}

export function shouldRedirectMissingSessionAfterScopedLoad(input: {
  loadedScopeRoot?: string | null;
  workspaceRoot?: string | null;
  hasMatchingSession: boolean;
}) {
  if (input.hasMatchingSession) return false;

  const workspaceRoot = normalizeDirectoryPath(input.workspaceRoot ?? "");
  if (!workspaceRoot) return false;

  return scopedRootsMatch(input.loadedScopeRoot, workspaceRoot);
}
