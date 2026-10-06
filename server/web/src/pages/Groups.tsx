import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, Group } from '../api';
import { Button, Card, Checkbox, Empty, IconButton, Input, Modal, Spinner, errMsg, useConfirm, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';

export default function Groups() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/admin/groups') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/admin/users') });
  const [edit, setEdit] = useState<{ id?: number; name: string; user_ids: number[] } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!edit || !edit.name.trim()) return;
    setSaving(true);
    try {
      let id = edit.id;
      if (id) await api.patch(`/admin/groups/${id}`, { name: edit.name });
      else id = (await api.post<{ id: number }>('/admin/groups', { name: edit.name })).id;
      await api.put(`/admin/groups/${id}/members`, { user_ids: edit.user_ids });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(edit.id ? 'Group updated' : 'Group created');
      setEdit(null);
    } catch (e) {
      toast(errMsg(e), 'danger');
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Group) {
    if (!(await confirm(`Delete the group "${g.name}"? Members lose access to folders shared with this group.`))) return;
    try {
      await api.del(`/admin/groups/${g.id}`);
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  const email = (id: number) => users.data?.find((u) => u.id === id)?.name || users.data?.find((u) => u.id === id)?.email;

  return (
    <div className="pb-10">
      <PageHeader
        title="Groups"
        subtitle="Share folders with many people at once, e.g. Family or Gym."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', user_ids: [] })}>
            New group
          </Button>
        }
      />
      <div className="px-4 sm:px-8">
        {groups.isLoading ? (
          <Spinner />
        ) : !groups.data?.length ? (
          <Card>
            <Empty icon={<UsersRound className="size-6" />} title="No groups yet">
              Create a group, add people to it, then share Library folders with the whole group.
            </Empty>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.data.map((g) => (
              <Card key={g.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-xs text-muted">{g.user_ids.length} members</p>
                  </div>
                  <div className="flex">
                    <IconButton label="Edit" onClick={() => setEdit({ id: g.id, name: g.name, user_ids: g.user_ids })}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="Delete" onClick={() => remove(g)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-muted">{g.user_ids.map(email).filter(Boolean).join(', ') || 'No members yet'}</p>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!edit}
        title={edit?.id ? 'Edit group' : 'New group'}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!edit?.name.trim()} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4 pb-2">
            <Input label="Name" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Members</p>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
                {users.data?.map((u) => (
                  <Checkbox
                    key={u.id}
                    checked={edit.user_ids.includes(u.id)}
                    onChange={(v) => setEdit({ ...edit, user_ids: v ? [...edit.user_ids, u.id] : edit.user_ids.filter((x) => x !== u.id) })}
                  >
                    {u.name || u.email} <span className="text-muted">· {u.email}</span>
                  </Checkbox>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
