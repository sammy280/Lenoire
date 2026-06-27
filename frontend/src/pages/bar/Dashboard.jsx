import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { cn } from '../../lib/utils';
import Badge from '../../components/shared/Badge';
import { Wine, Clock, CheckCircle, PlayCircle } from 'lucide-react';
import { useEffect } from 'react';
import { getSocket } from '../../lib/socket';

export default function BarDashboard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['bar-orders'],
    queryFn: () => api.get('/bar'),
    refetchInterval: 10000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/bar/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries(['bar-orders']),
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('bar:updated', () => qc.invalidateQueries(['bar-orders']));
    socket.on('order:new', () => qc.invalidateQueries(['bar-orders']));
    socket.on('order:updated', () => qc.invalidateQueries(['bar-orders']));
    return () => {
      socket.off('bar:updated');
      socket.off('order:new');
      socket.off('order:updated');
    };
  }, []);

  const orders = data?.data || [];
  const pending = orders.filter(o => o.status === 'PENDING');
  const preparing = orders.filter(o => o.status === 'PREPARING');
  const ready = orders.filter(o => o.status === 'READY');

  const BarCard = ({ order }) => {
    const elapsed = Math.floor((Date.now() - new Date(order.createdAt)) / 60000);

    // ── BATCH FILTER ──────────────────────────────────────────────────────────
    // Only show items from the current batch (the latest addition wave).
    // Old items from previous batches (already served) are hidden.
    const currentBatch = order.currentBatch ?? 1;
    const itemsToShow = (order.order?.items ?? []).filter(
      item => (item.batchNumber ?? 1) === currentBatch
    );

    return (
      <div className="order-card">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-primary">{order.order?.orderNumber?.slice(-8)}</p>
            <p className="font-bold text-lg">Table {order.order?.table?.name} • {order.order?.seat?.label}</p>
            <p className="text-sm text-muted-foreground">Waiter: {order.order?.waiter?.name}</p>
            {currentBatch > 1 && (
              <span className="text-xs px-2 py-0.5 bg-orange-500/15 text-orange-400 rounded-full font-semibold">
                ➕ Addition #{currentBatch}
              </span>
            )}
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> {elapsed}m
          </span>
        </div>

        {/* Drink items — current batch only */}
        <div className="space-y-1.5 mt-3">
          {itemsToShow.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <span className="w-7 h-7 bg-yellow-500/20 text-yellow-400 rounded-lg flex items-center justify-center font-bold text-xs">
                {item.quantity}x
              </span>
              <span className="font-medium">🍺 {item.product?.name}</span>
              {item.notes && <span className="text-xs text-orange-400 italic">"{item.notes}"</span>}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-3">
          {order.status === 'PENDING' && (
            <button
              onClick={() => updateStatus.mutate({ id: order.id, status: 'PREPARING' })}
              className="flex-1 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
            >
              <PlayCircle className="w-4 h-4" /> Start Preparing
            </button>
          )}
          {order.status === 'PREPARING' && (
            <button
              onClick={() => updateStatus.mutate({ id: order.id, status: 'READY' })}
              className="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Drinks Ready
            </button>
          )}
          {order.status === 'READY' && (
            <div className="flex-1 py-2 bg-green-500/10 text-green-400 rounded-lg text-sm font-medium text-center">
              ✓ Ready — Awaiting waiter
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Wine className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Bar Queue</h1>
        <div className="ml-auto flex gap-3 text-sm">
          <span className="px-3 py-1 bg-yellow-500/10 text-yellow-400 rounded-full font-semibold">{pending.length} Pending</span>
          <span className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full font-semibold">{preparing.length} Preparing</span>
          <span className="px-3 py-1 bg-green-500/10 text-green-400 rounded-full font-semibold">{ready.length} Ready</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 h-[calc(100vh-160px)]">
        {['PENDING', 'PREPARING', 'READY'].map((col, ci) => {
          const colOrders = orders.filter(o => o.status === col);
          return (
            <div key={col} className="flex flex-col gap-3">
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl',
                col === 'PENDING' ? 'bg-yellow-500/10' : col === 'PREPARING' ? 'bg-blue-500/10' : 'bg-green-500/10'
              )}>
                <div
                  className={cn('w-2 h-2 rounded-full', col !== 'READY' && 'animate-pulse')}
                  style={{ background: ['#eab308', '#3b82f6', '#22c55e'][ci] }}
                />
                <span
                  className="font-semibold"
                  style={{ color: ['#eab308', '#3b82f6', '#22c55e'][ci] }}
                >
                  {col} ({colOrders.length})
                </span>
              </div>
              <div className="flex-1 overflow-auto space-y-3">
                {colOrders.map(o => <BarCard key={o.id} order={o} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}