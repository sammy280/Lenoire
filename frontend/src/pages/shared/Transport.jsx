import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Bus, Plus, Calendar } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

export default function Transport() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isManager = ['MANAGER', 'ADMIN'].includes(user?.role);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ employeeId: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });

  const { data: list } = useQuery({
    queryKey: isManager ? ['transport'] : ['transport', 'my'],
    queryFn: () => isManager ? api.get('/transport') : api.get('/transport/my'),
  });

  const { data: report } = useQuery({
    queryKey: ['transport', 'report', month],
    queryFn: () => api.get(`/transport/report?month=${month}`),
    enabled: isManager,
  });

  const { data: employees } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: isManager && showAdd,
  });

  const addAllowance = useMutation({
    mutationFn: (d) => api.post('/transport', d),
    onSuccess: () => {
      qc.invalidateQueries(['transport']);
      qc.invalidateQueries(['expenses']);
      setShowAdd(false);
      toast.success('Allowance recorded (also logged as an expense)');
    },
  });

  const records = list?.data || [];
  const reportData = report?.data || [];
  const employeeOptions = (employees?.data || []).filter(u => u.isActive !== false);

  const openAdd = () => {
    setForm({ employeeId: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
    setShowAdd(true);
  };

  const selectSelf = () => {
    setForm(f => ({ ...f, employeeId: user.id }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Transport Allowances" subtitle="Daily transport allowance tracking (separate from salary)">
        {isManager && (
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> Record Allowance
          </button>
        )}
      </PageHeader>

      {isManager && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> Monthly Report</h3>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm" />
          </div>
          {reportData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No transport data for {month}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>{['Employee', 'Role', 'Days', 'Total Amount'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs uppercase text-muted-foreground font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {reportData.map(r => (
                  <tr key={r.employeeId} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-2 px-3 font-medium">{r.employeeName}</td>
                    <td className="py-2 px-3 text-muted-foreground">{r.role}</td>
                    <td className="py-2 px-3">{r.days}</td>
                    <td className="py-2 px-3 font-bold">{formatCurrency(r.total)}</td>
                  </tr>
                ))}
                <tr className="bg-accent/30 font-bold">
                  <td colSpan={3} className="py-2 px-3">Total</td>
                  <td className="py-2 px-3">{formatCurrency(reportData.reduce((s, r) => s + r.total, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="font-semibold">Allowance Records</h3></div>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No records found</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-accent/50 border-b border-border">
              <tr>{(isManager ? ['Employee', 'Date', 'Amount', 'Notes', 'Recorded By'] : ['Date', 'Amount', 'Notes']).map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase text-muted-foreground font-semibold">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/30">
                  {isManager && <td className="px-4 py-3 font-medium">{r.employee?.name}</td>}
                  <td className="px-4 py-3">{formatDate(r.date)}</td>
                  <td className="px-4 py-3 font-bold">{formatCurrency(r.amount)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.notes || '—'}</td>
                  {isManager && <td className="px-4 py-3 text-muted-foreground">{r.recordedBy?.name}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-4">Record Transport Allowance</h3>
            <form onSubmit={e => { e.preventDefault(); addAllowance.mutate({ ...form, amount: parseFloat(form.amount) }); }} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">Employee</label>
                  <button type="button" onClick={selectSelf} className="text-xs text-primary font-medium hover:underline">
                    Pay myself
                  </button>
                </div>
                <select value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} required
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Select employee...</option>
                  {employeeOptions.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role}){u.id === user.id ? ' — me' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount (RWF)</label>
                <input type="number" required min="0" step="100" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <p className="text-xs text-muted-foreground">
                This will also be logged as a "Transport" expense, reducing today's cash total.
              </p>
              <div className="flex gap-3">
                <button type="submit" disabled={addAllowance.isPending} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {addAllowance.isPending ? 'Saving...' : 'Record Allowance'}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}