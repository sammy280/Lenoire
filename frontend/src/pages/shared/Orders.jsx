import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import Badge from '../../components/shared/Badge';
import { formatDateTime } from '../../lib/utils';
import { useState } from 'react';
import { Search } from 'lucide-react';

const STATUSES = ['', 'PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelId, setCancelId] = useState(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['orders', status],
    queryFn: () => api.get(`/orders${status ? `?status=${status}` : ''}`),
    refetchInterval: 15000,
  });

  const cancelOrder = useMutation({
    mutationFn: ({ id, reason }) => api.patch(`/orders/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries(['orders']); setCancelId(null); setCancelReason(''); },
  });

  const orders = (data?.data || []).filter(o =>
    !search ||
    o.orderNumber.includes(search.toUpperCase()) ||
    o.table?.name.includes(search.toUpperCase()) ||
    o.waiter?.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" subtitle={`${orders.length} orders`} />

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search orders..."
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                status === s ? 'border-primary bg-primary/10 text-primary' : 'border-border'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {orders.length === 0 && (
          <p className="text-center py-10 text-muted-foreground text-sm">No orders found</p>
        )}
        {orders.map(order => (
          <div key={order.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-primary font-semibold">{order.orderNumber}</span>
              <Badge status={order.status} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Table</span>
              <span>Table {order.table?.name} · {order.seat?.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Waiter</span>
              <span>{order.waiter?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Items</span>
              <span>{order.items?.length} items</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Time</span>
              <span className="text-xs">{formatDateTime(order.createdAt)}</span>
            </div>
            {!['CANCELLED', 'SERVED'].includes(order.status) && (
              <button
                onClick={() => setCancelId(order.id)}
                className="w-full mt-1 px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20"
              >
                Cancel Order
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-accent/50 border-b border-border">
            <tr>
              {['Order #', 'Table', 'Seat', 'Waiter', 'Items', 'Status', 'Time', 'Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id} className="border-b border-border/50 hover:bg-accent/30">
                <td className="px-4 py-3 font-mono text-xs text-primary">{order.orderNumber}</td>
                <td className="px-4 py-3">Table {order.table?.name}</td>
                <td className="px-4 py-3">{order.seat?.label}</td>
                <td className="px-4 py-3">{order.waiter?.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{order.items?.length} items</td>
                <td className="px-4 py-3"><Badge status={order.status} /></td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{formatDateTime(order.createdAt)}</td>
                <td className="px-4 py-3">
                  {!['CANCELLED', 'SERVED'].includes(order.status) && (
                    <button
                      onClick={() => setCancelId(order.id)}
                      className="px-2 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs hover:bg-red-500/20"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cancel modal */}
      {cancelId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Cancel Order</h3>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              className="w-full p-3 bg-background border border-border rounded-xl text-sm resize-none focus:outline-none"
              rows={3}
              placeholder="Reason for cancellation..."
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => cancelOrder.mutate({ id: cancelId, reason: cancelReason })}
                disabled={!cancelReason || cancelOrder.isPending}
                className="flex-1 py-2 bg-red-500 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {cancelOrder.isPending ? 'Cancelling...' : 'Cancel Order'}
              </button>
              <button
                onClick={() => { setCancelId(null); setCancelReason(''); }}
                className="flex-1 py-2 bg-accent rounded-xl font-medium"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}