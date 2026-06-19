import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import { formatCurrency, formatDate, formatDateTime } from '../../lib/utils';
import { DollarSign, History, CreditCard, Edit2, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function SalaryManagement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('history');
  const [showUpdateSalary, setShowUpdateSalary] = useState(null); // {userId, name, currentSalary}
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [salaryForm, setSalaryForm] = useState({ baseSalary: '', reason: '' });
  const [advanceForm, setAdvanceForm] = useState({ employeeId: '', amount: '', period: new Date().toISOString().slice(0, 7), reason: '' });

  const { data: history } = useQuery({ queryKey: ['salary', 'history'], queryFn: () => api.get('/salary/history') });
  const { data: advances } = useQuery({ queryKey: ['salary', 'advances'], queryFn: () => api.get('/salary/advances') });
  const { data: employees } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });

  const updateSalary = useMutation({
    mutationFn: ({ userId, data }) => api.patch(`/salary/base/${userId}`, data),
    onSuccess: () => { qc.invalidateQueries(['salary']); setShowUpdateSalary(null); toast.success('Base salary updated'); },
  });

  const addAdvance = useMutation({
    mutationFn: (d) => api.post('/salary/advances', d),
    onSuccess: () => { qc.invalidateQueries(['salary']); setShowAddAdvance(false); toast.success('Advance recorded'); },
  });

  const historyList = history?.data || [];
  const advanceList = advances?.data || [];
  const empList = (employees?.data || []).filter(u => u.role !== 'ADMIN');

  return (
    <div className="space-y-6">
      <PageHeader title="Salary Management" subtitle="Base salary configuration, history, and advances" />

      {/* Tabs */}
      <div className="flex gap-1 bg-accent/50 rounded-xl p-1 w-fit">
        {[['history', 'Salary History', History], ['advances', 'Advances', CreditCard]].map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all', tab === key ? 'bg-card shadow text-foreground' : 'text-muted-foreground')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Employee Base Salaries */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Employee Base Salaries</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-accent/50 border-b border-border">
            <tr>{['Name', 'Role', 'Base Salary', 'Action'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs uppercase text-muted-foreground font-semibold">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {empList.map(emp => (
              <tr key={emp.id} className="border-b border-border/50 hover:bg-accent/30">
                <td className="px-4 py-3 font-medium">{emp.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{emp.role}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(emp.profile?.baseSalary || 0)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => { setShowUpdateSalary({ userId: emp.id, name: emp.name, currentSalary: parseFloat(emp.profile?.baseSalary || 0) }); setSalaryForm({ baseSalary: parseFloat(emp.profile?.baseSalary || 0), reason: '' }); }}
                    className="flex items-center gap-1 text-xs px-2 py-1 bg-primary/10 text-primary border border-primary/30 rounded-lg">
                    <Edit2 className="w-3 h-3" /> Update
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* History Tab */}
      {tab === 'history' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border"><h3 className="font-semibold">Salary Change History</h3></div>
          {historyList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No salary changes recorded</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-accent/50 border-b border-border">
                <tr>{['Employee', 'Old Salary', 'New Salary', 'Change', 'Reason', 'Changed By', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs uppercase text-muted-foreground font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {historyList.map(h => {
                  const diff = parseFloat(h.newSalary) - parseFloat(h.oldSalary);
                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium">{h.employee?.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatCurrency(h.oldSalary)}</td>
                      <td className="px-4 py-3 font-bold">{formatCurrency(h.newSalary)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('flex items-center gap-1 text-xs font-semibold', diff >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {diff >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {diff >= 0 ? '+' : ''}{formatCurrency(Math.abs(diff))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{h.reason}</td>
                      <td className="px-4 py-3 text-muted-foreground">{h.changedBy}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(h.changedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Advances Tab */}
      {tab === 'advances' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Salary Advances</h3>
            <button onClick={() => setShowAddAdvance(true)} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" /> Record Advance
            </button>
          </div>
          {advanceList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No advances recorded</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-accent/50 border-b border-border">
                <tr>{['Employee', 'Amount', 'Period', 'Reason', 'Status', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs uppercase text-muted-foreground font-semibold">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {advanceList.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">{a.employee?.name}</td>
                    <td className="px-4 py-3 font-bold text-red-400">{formatCurrency(a.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.period}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.reason || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold', a.status === 'APPROVED' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400')}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Update Salary Modal */}
      {showUpdateSalary && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-1">Update Base Salary</h3>
            <p className="text-sm text-muted-foreground mb-4">{showUpdateSalary.name} · Current: {formatCurrency(showUpdateSalary.currentSalary)}</p>
            <form onSubmit={e => { e.preventDefault(); updateSalary.mutate({ userId: showUpdateSalary.userId, data: { baseSalary: parseFloat(salaryForm.baseSalary), reason: salaryForm.reason } }); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">New Base Salary (RWF)</label>
                <input type="number" required min="0" step="1000" value={salaryForm.baseSalary} onChange={e => setSalaryForm(f => ({ ...f, baseSalary: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason for Change</label>
                <input type="text" required value={salaryForm.reason} onChange={e => setSalaryForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Annual review, promotion..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={updateSalary.isPending} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {updateSalary.isPending ? 'Updating...' : 'Update Salary'}
                </button>
                <button type="button" onClick={() => setShowUpdateSalary(null)} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Advance Modal */}
      {showAddAdvance && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-4">Record Salary Advance</h3>
            <form onSubmit={e => { e.preventDefault(); addAdvance.mutate({ ...advanceForm, amount: parseFloat(advanceForm.amount) }); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Employee</label>
                <select value={advanceForm.employeeId} onChange={e => setAdvanceForm(f => ({ ...f, employeeId: e.target.value }))} required
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Select employee...</option>
                  {empList.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount (RWF)</label>
                <input type="number" required min="0" step="1000" value={advanceForm.amount} onChange={e => setAdvanceForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Pay Period (YYYY-MM)</label>
                <input type="month" required value={advanceForm.period} onChange={e => setAdvanceForm(f => ({ ...f, period: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <input type="text" value={advanceForm.reason} onChange={e => setAdvanceForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={addAdvance.isPending} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {addAdvance.isPending ? 'Recording...' : 'Record Advance'}
                </button>
                <button type="button" onClick={() => setShowAddAdvance(false)} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
