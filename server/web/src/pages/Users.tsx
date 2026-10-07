import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart3, MonitorSmartphone, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { api, auth, timeAgo } from '../api';
import type { AdminUser, Group, Role, Session } from '../api';
import { Badge, Button, Card, Checkbox, Empty, IconButton, Input, Modal, Select, Spinner, Toggle, errMsg, useConfirm, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';

type Draft = { id?: number; email: string; name: string; password: string; role: Role; disabled: boolean; group_ids: number[] };

const blank: Draft = { email: '', name: '', password: '', role: 'user', disabled: false, group_ids: [] };

export default function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sessionsFor, setSessionsFor] = useState<AdminUser | null>(null);
  const [filter, setFilter] = useState('');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/admin/users') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/admin/groups') });
  const me = auth.user();

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      if (d.id) {
        await api.patch(`/admin/users/${d.id}`, {
          name: d.name,
          role: d.role,
          disabled: d.disabled,
          group_ids: d.group_ids,
          ...(d.password ? { password: d.password } : {}),
        });
      } else {
        await api.post('/admin/users', d);
      }
    },
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      toast(d.id ? 'User updated' : 'User created');
      setDraft(null);
    },
    onError: (e) => toast(errMsg(e), 'danger'),
  });

  const toggleDisabled = useMutation({
    mutationFn: (u: AdminUser) => api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast(errMsg(e), 'danger'),
  });

  async function remove(u: AdminUser) {
    if (!(await confirm(`Delete ${u.email}? Their personal folders are removed too. Shared music is not affected.`))) return;
    try {
      await api.del(`/admin/users/${u.id}`);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('User deleted');
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft) save.mutate(draft);
  }

  const groupName = (id: number) => groups.data?.find((g) => g.id === id)?.name;
  const shown = (users.data ?? []).filter((u) => `${u.email} ${u.name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="pb-10">
      <PageHeader
        title="Users"
        subtitle="Create accounts, reset passwords and choose which groups people belong to."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setDraft({ ...blank })}>
            New user
          </Button>
        }
      />
      <div className="px-4 sm:px-8">
        <Card>
          <div className="relative border-b border-line/60 p-4">
            <Search className="pointer-events-none absolute top-1/2 left-8 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder="Search users" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-11" />
          </div>
          {users.isLoading ? (
            <div className="p-8">
              <Spinner />
            </div>
          ) : !shown.length ? (
            <Empty icon={<UserRound className="size-6" />} title="No users found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line/60">
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Groups</th>
                    <th className="px-5 py-3 font-medium">Own tracks</th>
                    <th className="px-5 py-3 font-medium">Active</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className="border-b border-line/40 last:border-0">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-brand">
                            {(u.name || u.email)[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-medium">
                              {u.name || u.email.split('@')[0]}
                              {u.role === 'admin' && <Badge tone="brand">Admin</Badge>}
                            </p>
                            <p className="truncate text-xs text-muted">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.group_ids.length ? u.group_ids.map((g) => <Badge key={g}>{groupName(g)}</Badge>) : <span className="text-muted">—</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-muted">{u.tracks}</td>
                      <td className="px-5 py-3">
                        <Toggle
                          label={`${u.disabled ? 'Enable' : 'Disable'} ${u.email}`}
                          checked={!u.disabled}
                          onChange={() => u.id !== me?.id && toggleDisabled.mutate(u)}
                        />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Link
                            to={`/users/${u.id}`}
                            aria-label="Listening activity"
                            title="Listening activity"
                            className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-white"
                          >
                            <BarChart3 className="size-4" />
                          </Link>
                          <IconButton label="Signed-in devices" onClick={() => setSessionsFor(u)}>
                            <MonitorSmartphone className="size-4" />
                          </IconButton>
                          <IconButton
                            label="Edit"
                            onClick={() => setDraft({ id: u.id, email: u.email, name: u.name, password: '', role: u.role, disabled: u.disabled, group_ids: u.group_ids })}
                          >
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="Delete" disabled={u.id === me?.id} onClick={() => remove(u)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!draft}
        title={draft?.id ? 'Edit user' : 'New user'}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={save.isPending}>
              {draft?.id ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="user-form" onSubmit={submit} className="space-y-4 pb-2">
            <Input label="Email" type="email" required disabled={!!draft.id} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input
              label={draft.id ? 'New password (leave empty to keep)' : 'Password'}
              type="password"
              minLength={8}
              required={!draft.id}
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
            <Select label="Role" value={draft.role} disabled={draft.id === me?.id} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
              <option value="user">User — uses the app</option>
              <option value="admin">Admin — can open this console</option>
            </Select>
            {!!groups.data?.length && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Groups</p>
                <div className="rounded-xl border border-line">
                  {groups.data.map((g) => (
                    <Checkbox
                      key={g.id}
                      checked={draft.group_ids.includes(g.id)}
                      onChange={(v) => setDraft({ ...draft, group_ids: v ? [...draft.group_ids, g.id] : draft.group_ids.filter((x) => x !== g.id) })}
                    >
                      {g.name}
                    </Checkbox>
                  ))}
                </div>
              </div>
            )}
            {draft.id && draft.password && <p className="text-xs text-muted">Changing the password signs this user out on every device.</p>}
          </form>
        )}
      </Modal>

      <SessionsModal user={sessionsFor} onClose={() => setSessionsFor(null)} />
    </div>
  );
}

function SessionsModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['sessions', user?.id],
    queryFn: () => api.get<Session[]>(`/admin/users/${user!.id}/sessions`),
    enabled: !!user,
  });
  return (
    <Modal open={!!user} title={`Devices — ${user?.email ?? ''}`} onClose={onClose}>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <p className="pb-4 text-sm text-muted">Not signed in on any device.</p>
      ) : (
        <ul className="divide-y divide-line/60 pb-4">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3 text-sm">
              <span>{s.device_name || 'Unknown device'}</span>
              <span className="text-muted">{timeAgo(s.last_used_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
