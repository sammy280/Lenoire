import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import { formatDateTime } from '../../lib/utils';
import { RotateCcw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const statusColors = {
  PENDING: 'bg-yellow-500/15 text-yellow-400',
  APPROVED_BY_BAR: 'bg-blue-500/15 text-blue-400',
  APPROVED_BY_KITCHEN: 'bg-blue-500/15 text-blue-400',
  REJECTED: 'bg-red-500/15 text-red-400',
  MANAGER_APPROVED: 'bg-green-500/15 text-green-400',
  MANAGER_REJECTED: 'bg-red-500/15 text-red-400',
};

const statusLabel = {
  PENDING: 'Pending Review',
  APPROVED_BY_BAR: 'Bar Approved',
  APPROVED_BY_KITCHEN: 'Kitchen Approved',
  REJECTED: 'Rejected',
  MANAGER_APPROVED: 'Manager Approved',
  MANAGER_REJECTED: 'Manager Rejected',
};

export default function Returns() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [form, setForm] = useState({ orderId: '', reason: '', items: [] });

  const { data: returns, isLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.get('/returns'),
  });

  const { data: orders } = useQuery({
    queryKey: ['orders', 'served'],
    queryFn: () => api.get('/orders?status=SERVED'),
    enabled: showCreate,
  });

  const createReturn = useMutation({
    mutationFn: (d) => api.post('/returns', d),
    onSuccess: () => { qc.invalidateQueries(['returns']); setShowCreate(false); toast.success('Return request submitted'); },
  });

  const reviewReturn = useMutation({
    mutationFn: ({ id, action, note }) => api.patch(`/returns/${id}/review`, { action, note }),
    onSuccess: () => { qc.invalidateQueries(['returns']); setSelectedReturn(null); toast.success('Review submitted'); },
  });

  const managerReview = useMutation({
    mutationFn: ({ id, action, note }) => api.patch(`/returns/${id}/manager-review`, { action, note }),
    onSuccess: () => { qc.invalidateQueries(['returns']); setSelectedReturn(null); toast.success('Manager decision saved'); },
  });

  const list = returns?.data || [];
  const isWaiter = user?.role === 'WAITER';
  const isBar = user?.role === 'BAR';
  const isKitchen = user?.role === 'KITCHEN';
  const isManager = ['MANAGER', 'ADMIN'].includes(user?.role);

  const canReviewDept = isBar || isKitchen;
  const canManagerReview = isManager;

  const handleOrderSelect = (orderId) => {
    const order = (orders?.data || []).find(o => o.id === orderId);
    if (!order) return;
    setForm(f => ({
      ...f,
      orderId,
      items: order.items.map(i => ({ orderItemId: i.id, quantity: 0, maxQty: i.quantity, name: i.product?.name, reason: '' })),
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Product Returns" subtitle="Return requests and approval workflow">
        {isWaiter && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium">
            <RotateCcw className="w-4 h-4" /> New Return Request
          </button>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading returns...</div>
      ) : (
        <div className="space-y-3">
          {list.length === 0 && <div className="text-center py-12 text-muted-foreground">No return requests found</div>}
          {list.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold">Return #{r.id.slice(-6).toUpperCase()}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold', statusColors[r.status])}>
                      {statusLabel[r.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Order #{r.order?.orderNumber} · by {r.requestedBy?.name} · {formatDateTime(r.createdAt)}
                  </p>
                  <p className="text-sm mt-1">Reason: {r.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.items?.map(item => (
                      <span key={item.id} className="text-xs bg-accent px-2 py-0.5 rounded">
                        {item.quantity}× {item.orderItem?.product?.name}
                      </span>
                    ))}
                  </div>
                  {r.reviewNote && (
                    <p className="text-xs text-muted-foreground mt-2 border-t border-border/50 pt-2">
                      Dept note: {r.reviewNote} — {r.reviewedBy?.name}
                    </p>
                  )}
                  {r.managerNote && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Manager note: {r.managerNote} — {r.managerApprover?.name}
                    </p>
                  )}
                  {r.restockDone && <p className="text-xs text-green-400 mt-1">✓ Stock restored</p>}
                </div>
                <div className="ml-4 flex gap-2">
                  {canReviewDept && r.status === 'PENDING' && (
                    <button onClick={() => { setSelectedReturn({ ...r, mode: 'dept' }); setReviewNote(''); }}
                      className="px-3 py-1.5 bg-primary/10 text-primary border border-primary/30 rounded-lg text-sm font-medium">
                      Review
                    </button>
                  )}
                  {canManagerReview && (r.status === 'APPROVED_BY_BAR' || r.status === 'APPROVED_BY_KITCHEN') && (
                    <button onClick={() => { setSelectedReturn({ ...r, mode: 'manager' }); setReviewNote(''); }}
                      className="px-3 py-1.5 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded-lg text-sm font-medium">
                      Final Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Return Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg my-4">
            <h3 className="font-semibold mb-4">Submit Return Request</h3>
            <form onSubmit={e => {
              e.preventDefault();
              const items = form.items.filter(i => i.quantity > 0).map(i => ({ orderItemId: i.orderItemId, quantity: parseInt(i.quantity), reason: i.reason }));
              if (items.length === 0) return toast.error('Select at least one item to return');
              createReturn.mutate({ orderId: form.orderId, reason: form.reason, items });
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Select Order</label>
                <select value={form.orderId} onChange={e => handleOrderSelect(e.target.value)} required
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
                  <option value="">Choose order...</option>
                  {(orders?.data || []).map(o => (
                    <option key={o.id} value={o.id}>#{o.orderNumber} — Table {o.table?.name} {o.seat?.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Overall Reason</label>
                <input type="text" required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Customer complained, wrong item..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
              </div>
              {form.items.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Items to Return</label>
                  {form.items.map((item, idx) => (
                    <div key={item.orderItemId} className="flex items-center gap-3 bg-accent/30 rounded-lg p-3">
                      <span className="flex-1 text-sm">{item.name}</span>
                      <span className="text-xs text-muted-foreground">max {item.maxQty}</span>
                      <input type="number" min="0" max={item.maxQty} value={item.quantity}
                        onChange={e => setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it) }))}
                        className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-center" />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3">
                <button type="submit" disabled={createReturn.isPending} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {createReturn.isPending ? 'Submitting...' : 'Submit Request'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {selectedReturn && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-1">
              {selectedReturn.mode === 'manager' ? 'Manager Final Review' : 'Department Review'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">Return #{selectedReturn.id.slice(-6).toUpperCase()}</p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Note (optional)</label>
              <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm resize-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => {
                if (selectedReturn.mode === 'manager') {
                  managerReview.mutate({ id: selectedReturn.id, action: 'approve', note: reviewNote });
                } else {
                  reviewReturn.mutate({ id: selectedReturn.id, action: 'approve', note: reviewNote });
                }
              }} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => {
                if (selectedReturn.mode === 'manager') {
                  managerReview.mutate({ id: selectedReturn.id, action: 'reject', note: reviewNote });
                } else {
                  reviewReturn.mutate({ id: selectedReturn.id, action: 'reject', note: reviewNote });
                }
              }} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium flex items-center justify-center gap-2">
                <XCircle className="w-4 h-4" /> Reject
              </button>
              <button onClick={() => setSelectedReturn(null)} className="px-4 py-2.5 bg-accent rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
