import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import Badge from '../../components/shared/Badge';
import { cn } from '../../lib/utils';
import { useEffect, useState } from 'react';
import { getSocket } from '../../lib/socket';
import { useAuthStore } from '../../store/authStore';
import { Plus, Edit2, Trash2, PlusCircle, MinusCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';

const tableColors = {
  AVAILABLE: 'border-green-500/50 bg-green-500/5',
  OCCUPIED: 'border-red-500/50 bg-red-500/5',
  WAITING_PAYMENT: 'border-orange-500/50 bg-orange-500/5',
  CLOSED: 'border-border',
};

export default function TablesPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = ['ADMIN', 'MANAGER'].includes(user?.role);

  const [showAdd, setShowAdd] = useState(false);
  const [editTable, setEditTable] = useState(null);
  const [form, setForm] = useState({ name: '', seatCount: 4 });

  const { data } = useQuery({ queryKey: ['tables'], queryFn: () => api.get('/tables'), refetchInterval: 15000 });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('table:updated', () => qc.invalidateQueries(['tables']));
    socket.on('order:new', () => qc.invalidateQueries(['tables']));
    return () => { socket.off('table:updated'); socket.off('order:new'); };
  }, []);

  const createTable = useMutation({
    mutationFn: (d) => api.post('/tables', d),
    onSuccess: () => { qc.invalidateQueries(['tables']); setShowAdd(false); setForm({ name: '', seatCount: 4 }); toast.success('Table created'); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to create table'),
  });

  const updateTable = useMutation({
    mutationFn: ({ id, ...d }) => api.put(`/tables/${id}`, d),
    onSuccess: () => { qc.invalidateQueries(['tables']); setEditTable(null); toast.success('Table updated'); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update table'),
  });

  const deleteTable = useMutation({
    mutationFn: (id) => api.delete(`/tables/${id}`),
    onSuccess: () => { qc.invalidateQueries(['tables']); toast.success('Table deleted'); },
    onError: (e) => toast.error(e.response?.data?.message || 'Cannot delete table'),
  });

  const addSeat = useMutation({
    mutationFn: (tableId) => api.post(`/tables/${tableId}/seats`),
    onSuccess: () => { qc.invalidateQueries(['tables']); toast.success('Seat added'); },
  });

  const removeSeat = useMutation({
    mutationFn: ({ tableId, seatId }) => api.delete(`/tables/${tableId}/seats/${seatId}`),
    onSuccess: () => { qc.invalidateQueries(['tables']); toast.success('Seat removed'); },
    onError: (e) => toast.error(e.response?.data?.message || 'Cannot remove seat'),
  });

  const tables = data?.data || [];
  const stats = {
    available: tables.filter(t => t.status === 'AVAILABLE').length,
    occupied: tables.filter(t => t.status === 'OCCUPIED').length,
    waiting: tables.filter(t => t.status === 'WAITING_PAYMENT').length,
  };

  const openEdit = (table) => {
    setEditTable(table);
    setForm({ name: table.name, seatCount: table.seats?.length || 0 });
  };

  const handleDelete = (table) => {
    if (!window.confirm(`Delete table "${table.name}"? This cannot be undone.`)) return;
    deleteTable.mutate(table.id);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Table Management">
        {canManage && (
          <button onClick={() => { setShowAdd(true); setForm({ name: '', seatCount: 4 }); }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Table
          </button>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="flex gap-4 text-sm flex-wrap">
        <span className="px-3 py-1.5 bg-green-500/10 text-green-400 rounded-xl font-semibold">✓ {stats.available} Available</span>
        <span className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-xl font-semibold">● {stats.occupied} Occupied</span>
        <span className="px-3 py-1.5 bg-orange-500/10 text-orange-400 rounded-xl font-semibold">💳 {stats.waiting} Waiting Payment</span>
        <span className="px-3 py-1.5 bg-accent text-muted-foreground rounded-xl font-semibold">{tables.length} Total Tables</span>
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {tables.map(table => (
          <div key={table.id} className={cn('rounded-2xl border-2 p-5 space-y-3 transition-all relative', tableColors[table.status] || 'border-border')}>
            {/* Admin/Manager controls */}
            {canManage && (
              <div className="absolute top-2 right-2 flex gap-1">
                <button onClick={() => openEdit(table)}
                  className="p-1.5 bg-accent/80 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                  <Edit2 className="w-3 h-3" />
                </button>
                <button onClick={() => handleDelete(table)}
                  className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex items-center justify-between pr-12">
              <span className="text-3xl font-black">{table.name}</span>
              <Badge status={table.status} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {table.seats?.map(seat => (
                <div key={seat.id} className={cn('w-10 h-10 rounded-lg border-2 text-xs font-bold flex items-center justify-center relative group',
                  seat.isOccupied ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-green-500/50 bg-green-500/10 text-green-400')}>
                  {seat.label}
                  {canManage && !seat.isOccupied && (
                    <button onClick={() => removeSeat.mutate({ tableId: table.id, seatId: seat.id })}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full hidden group-hover:flex items-center justify-center">
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  )}
                </div>
              ))}
              {canManage && (
                <button onClick={() => addSeat.mutate(table.id)}
                  className="w-10 h-10 rounded-lg border-2 border-dashed border-border text-xs font-bold flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{table.seats?.filter(s => s.isOccupied).length}/{table.seats?.length} occupied</p>
          </div>
        ))}
      </div>

      {/* Add Table Modal */}
      {(showAdd || editTable) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-4">{editTable ? `Edit Table: ${editTable.name}` : 'Add New Table'}</h3>
            <form onSubmit={e => {
              e.preventDefault();
              if (editTable) updateTable.mutate({ id: editTable.id, name: form.name, seatCount: parseInt(form.seatCount) });
              else createTable.mutate({ name: form.name, seatCount: parseInt(form.seatCount) });
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Table Name / Number</label>
                <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. T1, Table 5, VIP..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Number of Seats</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setForm(f => ({ ...f, seatCount: Math.max(1, f.seatCount - 1) }))}
                    className="p-2 bg-accent rounded-lg hover:bg-accent/80">
                    <MinusCircle className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold w-12 text-center">{form.seatCount}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, seatCount: f.seatCount + 1 }))}
                    className="p-2 bg-accent rounded-lg hover:bg-accent/80">
                    <PlusCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={createTable.isPending || updateTable.isPending}
                  className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {createTable.isPending || updateTable.isPending ? 'Saving...' : editTable ? 'Update Table' : 'Create Table'}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); setEditTable(null); }} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
