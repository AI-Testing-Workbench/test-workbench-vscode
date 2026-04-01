"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import {
  DEN_ROLE_PERMISSION_OPTIONS,
  formatRoleLabel,
  getOrgAccessFlags,
  splitRoleString,
} from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type MembersTab = "members" | "roles" | "invitations";

function clonePermissionRecord(value: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(value).map(([resource, actions]) => [resource, [...actions]]),
  );
}

function toggleAction(
  value: Record<string, string[]>,
  resource: string,
  action: string,
  enabled: boolean,
) {
  const next = clonePermissionRecord(value);
  const current = new Set(next[resource] ?? []);

  if (enabled) {
    current.add(action);
  } else {
    current.delete(action);
  }

  next[resource] = [...current];
  return next;
}

function ActionButton({
  children,
  tone = "default",
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  tone?: "default" | "danger";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        tone === "danger"
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export function ManageMembersScreen() {
  const {
    activeOrg,
    orgContext,
    orgBusy,
    orgError,
    mutationBusy,
    inviteMember,
    cancelInvitation,
    updateMemberRole,
    removeMember,
    createRole,
    updateRole,
    deleteRole,
  } = useOrgDashboard();
  const [activeTab, setActiveTab] = useState<MembersTab>("members");
  const [pageError, setPageError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberRoleDraft, setMemberRoleDraft] = useState("member");
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleNameDraft, setRoleNameDraft] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<Record<string, string[]>>({});

  const assignableRoles = useMemo(
    () => (orgContext?.roles ?? []).filter((role) => !role.protected),
    [orgContext?.roles],
  );

  const access = useMemo(
    () =>
      getOrgAccessFlags(
        orgContext?.currentMember.role ?? "member",
        orgContext?.currentMember.isOwner ?? false,
      ),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role],
  );

  const pendingInvitations = useMemo(
    () =>
      (orgContext?.invitations ?? []).filter(
        (invitation) => invitation.status === "pending",
      ),
    [orgContext?.invitations],
  );

  function resetInviteForm() {
    setInviteEmail("");
    setInviteRole(assignableRoles[0]?.role ?? "member");
    setShowInviteForm(false);
  }

  function resetMemberEditor() {
    setEditingMemberId(null);
    setMemberRoleDraft(assignableRoles[0]?.role ?? "member");
  }

  function resetRoleEditor() {
    setEditingRoleId(null);
    setRoleNameDraft("");
    setRolePermissionDraft({});
    setShowRoleForm(false);
  }

  useEffect(() => {
    if (!assignableRoles[0]) {
      return;
    }

    setInviteRole((current) =>
      assignableRoles.some((role) => role.role === current)
        ? current
        : assignableRoles[0].role,
    );
    setMemberRoleDraft((current) =>
      assignableRoles.some((role) => role.role === current)
        ? current
        : assignableRoles[0].role,
    );
  }, [assignableRoles]);

  if (orgBusy && !orgContext) {
    return (
      <div className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
        <div className="rounded-[20px] border border-gray-100 bg-white px-5 py-8 text-[14px] text-gray-500">
          Loading organization details…
        </div>
      </div>
    );
  }

  if (!orgContext || !activeOrg) {
    return (
      <div className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
        <div className="rounded-[20px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {orgError ?? "Organization details are unavailable."}
        </div>
      </div>
    );
  }

  const inviteForm = showInviteForm && access.canInviteMembers ? (
    <div className="mb-5 rounded-[20px] border border-gray-100 bg-white p-5">
      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.7fr)_auto] md:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          setPageError(null);
          try {
            await inviteMember({ email: inviteEmail, role: inviteRole });
            resetInviteForm();
          } catch (error) {
            setPageError(
              error instanceof Error ? error.message : "Could not invite member.",
            );
          }
        }}
      >
        <label className="grid gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Email
          </span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="teammate@example.com"
            required
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-900/5"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Role
          </span>
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-900/5"
          >
            {assignableRoles.map((role) => (
              <option key={role.id} value={role.role}>
                {formatRoleLabel(role.role)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 md:justify-end">
          <ActionButton onClick={resetInviteForm}>Cancel</ActionButton>
          <button
            type="submit"
            className="rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={mutationBusy === "invite-member"}
          >
            {mutationBusy === "invite-member" ? "Sending..." : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const editMemberForm = editingMemberId && access.canManageMembers ? (
    <div className="mb-5 rounded-[20px] border border-gray-100 bg-white p-5">
      <form
        className="grid gap-3 md:grid-cols-[minmax(220px,0.9fr)_auto] md:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          setPageError(null);
          try {
            await updateMemberRole(editingMemberId, memberRoleDraft);
            resetMemberEditor();
          } catch (error) {
            setPageError(
              error instanceof Error
                ? error.message
                : "Could not update member role.",
            );
          }
        }}
      >
        <label className="grid gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Role
          </span>
          <select
            value={memberRoleDraft}
            onChange={(event) => setMemberRoleDraft(event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-900/5"
          >
            {assignableRoles.map((role) => (
              <option key={role.id} value={role.role}>
                {formatRoleLabel(role.role)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 md:justify-end">
          <ActionButton onClick={resetMemberEditor}>Cancel</ActionButton>
          <button
            type="submit"
            className="rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={mutationBusy === "update-member-role"}
          >
            {mutationBusy === "update-member-role" ? "Saving..." : "Save member"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  return (
    <div className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
      <div className="mb-8">
        <h1 className="mb-1 text-[22px] tracking-[-0.4px] text-gray-900">Members</h1>
        <p className="text-[14px] text-gray-400">
          Invite teammates, adjust roles, and keep access clean.
        </p>
      </div>

      {pageError ? (
        <div className="mb-5 rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {pageError}
        </div>
      ) : null}

      <div className="mb-8 flex gap-1 border-b border-gray-200">
        {(
          [
            ["members", "Members"],
            ["roles", "Roles"],
            ["invitations", "Invitations"],
          ] as Array<[MembersTab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={`border-b-2 px-4 pb-3 text-[14px] tracking-[-0.1px] transition-colors ${
              activeTab === value
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "members" ? (
        <div>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-[13px] text-gray-400">
              {access.canInviteMembers
                ? "Invite people, update their role, or remove them from the organization."
                : "View who is in the organization and what role they currently hold."}
            </p>
            {access.canInviteMembers ? (
              <button
                type="button"
                onClick={() => {
                  resetMemberEditor();
                  setShowInviteForm((current) => !current);
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-[13px] text-white transition-colors hover:bg-gray-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add member
              </button>
            ) : null}
          </div>

          {inviteForm}
          {editMemberForm}

          <div className="overflow-hidden rounded-[20px] border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_120px] gap-4 border-b border-gray-100 px-4 py-3 text-[12px] text-gray-400">
              <span>Member</span>
              <span>Role</span>
              <span>Joined</span>
              <span />
            </div>

            {orgContext.members.map((member) => (
              <div
                key={member.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_110px_120px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold uppercase text-white">
                    {member.user.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-gray-900">{member.user.name}</p>
                    <p className="truncate text-[12px] text-gray-400">{member.user.email}</p>
                  </div>
                </div>
                <span className="text-[13px] text-gray-600">
                  {splitRoleString(member.role).map(formatRoleLabel).join(", ")}
                </span>
                <span className="text-[13px] text-gray-500">
                  {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : "—"}
                </span>
                <div className="flex items-center gap-2">
                  {member.isOwner ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-500">
                      <Lock className="h-2.5 w-2.5" /> Locked
                    </span>
                  ) : access.canManageMembers ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMemberId(member.id);
                          setMemberRoleDraft(member.role);
                          setShowInviteForm(false);
                        }}
                        className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        aria-label={`Edit ${member.user.name}`}
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setPageError(null);
                          try {
                            await removeMember(member.id);
                            if (editingMemberId === member.id) {
                              resetMemberEditor();
                            }
                          } catch (error) {
                            setPageError(
                              error instanceof Error
                                ? error.message
                                : "Could not remove member.",
                            );
                          }
                        }}
                        disabled={mutationBusy === "remove-member"}
                        className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Remove ${member.user.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <span className="text-[12px] text-gray-400">Read only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "roles" ? (
        <div>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-[13px] text-gray-400">
              {access.canManageRoles
                ? "Default roles stay available, and owners can add, edit, or remove custom roles here."
                : "Role definitions are visible here, but only owners can change them."}
            </p>
            {access.canManageRoles ? (
              <button
                type="button"
                onClick={() => {
                  setShowRoleForm((current) => !current);
                  setEditingRoleId(null);
                  setRoleNameDraft("");
                  setRolePermissionDraft({});
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-[13px] text-white transition-colors hover:bg-gray-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add role
              </button>
            ) : null}
          </div>

          {(showRoleForm || editingRoleId) && access.canManageRoles ? (
            <div className="mb-5 rounded-[20px] border border-gray-100 bg-white p-5">
              <form
                className="grid gap-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setPageError(null);
                  try {
                    if (editingRoleId) {
                      await updateRole(editingRoleId, {
                        roleName: roleNameDraft,
                        permission: rolePermissionDraft,
                      });
                    } else {
                      await createRole({
                        roleName: roleNameDraft,
                        permission: rolePermissionDraft,
                      });
                    }
                    resetRoleEditor();
                  } catch (error) {
                    setPageError(
                      error instanceof Error ? error.message : "Could not save role.",
                    );
                  }
                }}
              >
                <label className="grid gap-2 md:max-w-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                    Role name
                  </span>
                  <input
                    type="text"
                    value={roleNameDraft}
                    onChange={(event) => setRoleNameDraft(event.target.value)}
                    placeholder="qa-reviewer"
                    required
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-900/5"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(DEN_ROLE_PERMISSION_OPTIONS).map(([resource, actions]) => (
                    <div key={resource} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <p className="mb-3 text-sm font-semibold text-gray-900">
                        {formatRoleLabel(resource)}
                      </p>
                      <div className="grid gap-2">
                        {actions.map((action) => {
                          const checked = (rolePermissionDraft[resource] ?? []).includes(action);
                          return (
                            <label
                              key={`${resource}-${action}`}
                              className="inline-flex items-center gap-2 text-sm text-gray-500"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setRolePermissionDraft((current) =>
                                    toggleAction(
                                      current,
                                      resource,
                                      action,
                                      event.target.checked,
                                    ),
                                  )
                                }
                              />
                              <span>{formatRoleLabel(action)}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={resetRoleEditor}>Cancel</ActionButton>
                  <button
                    type="submit"
                    className="rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={mutationBusy === "create-role" || mutationBusy === "update-role"}
                  >
                    {mutationBusy === "create-role" || mutationBusy === "update-role"
                      ? "Saving..."
                      : editingRoleId
                        ? "Save role"
                        : "Create role"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-[20px] border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-4 border-b border-gray-100 px-4 py-3 text-[12px] text-gray-400">
              <span>Role</span>
              <span>Type</span>
              <span />
            </div>

            {orgContext.roles.map((role) => (
              <div
                key={role.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
              >
                <span className="text-[14px] text-gray-900">{formatRoleLabel(role.role)}</span>
                <span className="text-[13px] text-gray-500">
                  {role.protected ? "System" : role.builtIn ? "Default" : "Custom"}
                </span>
                <div>
                  {access.canManageRoles && !role.protected ? (
                    <div className="flex gap-2">
                      <ActionButton
                        onClick={() => {
                          setShowRoleForm(false);
                          setEditingRoleId(role.id);
                          setRoleNameDraft(role.role);
                          setRolePermissionDraft(clonePermissionRecord(role.permission));
                        }}
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </ActionButton>
                      <ActionButton
                        tone="danger"
                        disabled={mutationBusy === "delete-role"}
                        onClick={async () => {
                          setPageError(null);
                          try {
                            await deleteRole(role.id);
                            if (editingRoleId === role.id) {
                              resetRoleEditor();
                            }
                          } catch (error) {
                            setPageError(
                              error instanceof Error
                                ? error.message
                                : "Could not delete role.",
                            );
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                        {mutationBusy === "delete-role" ? "Deleting..." : "Delete"}
                      </ActionButton>
                    </div>
                  ) : (
                    <span className="text-[12px] text-gray-400">Read only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "invitations" ? (
        <div>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-[13px] text-gray-400">
              Admins and owners can revoke pending invites before they are accepted.
            </p>
            {access.canInviteMembers ? (
              <button
                type="button"
                onClick={() => {
                  resetMemberEditor();
                  setShowInviteForm((current) => !current);
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-[13px] text-white transition-colors hover:bg-gray-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Invite member
              </button>
            ) : null}
          </div>

          {inviteForm}

          <div className="overflow-hidden rounded-[20px] border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_100px] gap-4 border-b border-gray-100 px-4 py-3 text-[12px] text-gray-400">
              <span>Email</span>
              <span>Role</span>
              <span>Expires</span>
              <span>Actions</span>
            </div>

            {pendingInvitations.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-gray-400">
                No pending invitations.
              </div>
            ) : (
              pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="grid grid-cols-[minmax(0,1fr)_110px_110px_100px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
                >
                  <span className="truncate text-[13px] text-gray-900">{invitation.email}</span>
                  <span className="text-[13px] text-gray-500">
                    {formatRoleLabel(invitation.role)}
                  </span>
                  <span className="text-[13px] text-gray-500">
                    {invitation.expiresAt
                      ? new Date(invitation.expiresAt).toLocaleDateString()
                      : "—"}
                  </span>
                  <div>
                    {access.canCancelInvitations ? (
                      <ActionButton
                        disabled={mutationBusy === "cancel-invitation"}
                        onClick={async () => {
                          setPageError(null);
                          try {
                            await cancelInvitation(invitation.id);
                          } catch (error) {
                            setPageError(
                              error instanceof Error
                                ? error.message
                                : "Could not cancel invitation.",
                            );
                          }
                        }}
                      >
                        {mutationBusy === "cancel-invitation" ? "Cancelling..." : "Cancel"}
                      </ActionButton>
                    ) : (
                      <span className="text-[12px] text-gray-400">Read only</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
