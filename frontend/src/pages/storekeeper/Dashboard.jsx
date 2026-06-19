import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/shared/PageHeader';
import { formatCurrency, formatDate, formatDateTime } from '../../lib/utils';
import { Package, ShoppingBag, AlertTriangle, ClipboardList, TrendingDown, Plus, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Fulfill Modal ────────────────────────────────────────────────────────────
function FulfillModal({ requisition, suppliers, inventory, onClose, onSuccess }) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  // Per-item state: { [requisitionItemId]: { inventoryItemId, quantityPurchased, unitCost } }
  const [itemData, setItemData] = useState(() =>
    Object.fromEntries(
      requisition.items.map(item => [
        item.id,
        { inventoryItemId: '', quantityPurchased: String(parseFloat(item.quantity)), unitCost: '' },
      ])
    )
  );

  const qc = useQueryClient();

  const fulfill = useMutation({
    mutationFn: (body) => api.post(`/requisitions/${requisition.id}/fulfill`, body),
    onSuccess: () => {
      qc.invalidateQueries(['requisitions', 'APPROVED']);
      qc.invalidateQueries(['inventory']);
      qc.invalidateQueries(['movements', 'recent']);
      toast.success('Requisition fulfilled & stock updated!');
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'Failed to fulfill requisition');
    },
  });

  const setField = (itemId, field, value) => {
    setItemData(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  };

  const totalCost = Object.values(itemData).reduce((sum, d) => {
    const qty = parseFloat(d.quantityPurchased) || 0;
    const cost = parseFloat(d.unitCost) || 0;
    return sum + qty * cost;
  }, 0);

  const handleSubmit = () => {
    if (!supplierId) return toast.error('Please select a supplier');
    for (const item of requisition.items) {
      const d = itemData[item.id];
      if (!d.inventoryItemId) return toast.error(`Select an inventory item for: ${item.name}`);
      if (!d.quantityPurchased || parseFloat(d.quantityPurchased) <= 0) return toast.error(`Enter a valid quantity for: ${item.name}`);
      if (d.unitCost === '' || parseFloat(d.unitCost) < 0) return toast.error(`Enter a valid unit cost for: ${item.name}`);
    }

    fulfill.mutate({
      supplierId,
      notes,
      items: requisition.items.map(item => ({
        requisitionItemId: item.id,
        inventoryItemId: itemData[item.id].inventoryItemId,
        quantityPurchased: parseFloat(itemData[item.id].quantityPurchased),
        unitCost: parseFloat(itemData[item.id].unitCost),
      })),
    });
  };

  const inventoryOptions = inventory || [];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl my-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-semibold text-lg">Fulfill Requisition</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{requisition.title} · {requisition.category}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Supplier */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Supplier <span className="text-red-400">*</span></label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select supplier...</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Per-item rows */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
              Items to Purchase
            </h4>
            <div className="space-y-3">
              {requisition.items.map(item => {
                const d = itemData[item.id];
                const lineTotal = (parseFloat(d.quantityPurchased) || 0) * (parseFloat(d.unitCost) || 0);
                return (
                  <div key={item.id} className="border border-border rounded-xl p-4 space-y-3">
                    {/* Item header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Requested: {parseFloat(item.quantity)} {item.unit}
                          {item.estimatedCost && ` · Est. ${formatCurrency(item.estimatedCost)} RWF/unit`}
                        </p>
                      </div>
                      {lineTotal > 0 && (
                        <span className="text-xs font-semibold text-primary">
                          {lineTotal.toLocaleString()} RWF
                        </span>
                      )}
                    </div>

                    {/* Inventory item selector */}
                    <div>
                      <label className="block text-xs font-medium mb-1 text-muted-foreground">
                        Link to Inventory Item <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={d.inventoryItemId}
                        onChange={e => setField(item.id, 'inventoryItemId', e.target.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">Select inventory item...</option>
                        {inventoryOptions.map(inv => (
                          <option key={inv.id} value={inv.id}>
                            {inv.name} ({parseFloat(inv.quantity).toFixed(2)} {inv.unit} in stock)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Qty + Cost */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1 text-muted-foreground">
                          Qty Purchased ({item.unit}) <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={d.quantityPurchased}
                          onChange={e => setField(item.id, 'quantityPurchased', e.target.value)}
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder={String(parseFloat(item.quantity))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-muted-foreground">
                          Unit Cost (RWF) <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={d.unitCost}
                          onChange={e => setField(item.id, 'unitCost', e.target.value)}
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Delivery notes, invoice number, etc."
              className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Total */}
          {totalCost > 0 && (
            <div className="bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-medium">Total Purchase Cost</span>
              <span className="text-lg font-bold text-primary">{totalCost.toLocaleString()} RWF</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={fulfill.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            {fulfill.isPending ? 'Processing...' : 'Confirm Purchase & Update Stock'}
          </button>
          <button
            onClick={onClose}
            disabled={fulfill.isPending}
            className="px-5 py-2.5 bg-accent hover:bg-accent/80 rounded-xl font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function StorekeeperDashboard() {
  const qc = useQueryClient();
  const [showPurchase, setShowPurchase] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState(null); // requisition being fulfilled
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: '', product: '', quantity: '', unit: 'kg', unitCost: '', notes: '' });

  const { data: inventory } = useQuery({ queryKey: ['inventory'], queryFn: () => api.get('/inventory'), refetchInterval: 30000 });
  const { data: requisitions } = useQuery({ queryKey: ['requisitions', 'APPROVED'], queryFn: () => api.get('/requisitions?status=APPROVED') });
  const { data: pendingReqs } = useQuery({ queryKey: ['requisitions', 'PENDING'], queryFn: () => api.get('/requisitions?status=PENDING') });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers') });
  const { data: recentMovements } = useQuery({ queryKey: ['movements', 'recent'], queryFn: () => api.get('/inventory/movements') });

  const createPurchase = useMutation({
    mutationFn: (d) => api.post('/purchases', d),
    onSuccess: () => {
      qc.invalidateQueries(['inventory']);
      setShowPurchase(false);
      toast.success('Purchase recorded');
    },
  });

  const items = inventory?.data || [];
  const lowStock = items.filter(i => i.isLowStock || i.isOutOfStock);
  const approvedReqs = requisitions?.data || [];
  const pendingReqCount = pendingReqs?.data?.length || 0;
  const supplierList = suppliers?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader title="Storekeeper Dashboard" subtitle="Stock & Supply Management" />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 text-center">
          <p className="text-3xl font-bold">{items.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Total Items</p>
        </div>
        <div className={cn('bg-card border rounded-xl p-5 text-center', lowStock.length > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-border')}>
          <p className={cn('text-3xl font-bold', lowStock.length > 0 ? 'text-red-400' : '')}>{lowStock.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Low/Out of Stock</p>
        </div>
        <div className={cn('bg-card border rounded-xl p-5 text-center', approvedReqs.length > 0 ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-border')}>
          <p className={cn('text-3xl font-bold', approvedReqs.length > 0 ? 'text-yellow-400' : '')}>{approvedReqs.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Approved Requisitions</p>
        </div>
        <div className={cn('bg-card border rounded-xl p-5 text-center', pendingReqCount > 0 ? 'border-orange-500/40 bg-orange-500/5' : 'border-border')}>
          <p className={cn('text-3xl font-bold', pendingReqCount > 0 ? 'text-orange-400' : '')}>{pendingReqCount}</p>
          <p className="text-sm text-muted-foreground mt-1">Pending Requisitions</p>
        </div>
      </div>

      {/* Low Stock Alerts */}
      {lowStock.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-5">
          <h3 className="font-semibold text-red-400 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" /> Low Stock Alerts
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {lowStock.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-card rounded-lg px-3 py-2 border border-red-500/20">
                <span className="text-sm font-medium">{item.name}</span>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded', item.isOutOfStock ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400')}>
                  {item.isOutOfStock ? 'OUT' : `${parseFloat(item.quantity).toFixed(1)} ${item.unit}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Requisitions — with Fulfill button */}
      {approvedReqs.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-primary" /> Approved Requisitions — Ready to Purchase
          </h3>
          <div className="space-y-3">
            {approvedReqs.map(r => (
              <div key={r.id} className="border border-yellow-500/30 bg-yellow-500/5 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {r.category} · {r.items?.length} item{r.items?.length !== 1 ? 's' : ''} · by {r.requestedBy?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full',
                      r.urgency === 'URGENT' ? 'bg-red-500/20 text-red-400' :
                      r.urgency === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                      r.urgency === 'LOW' ? 'bg-green-500/20 text-green-400' :
                      'bg-blue-500/20 text-blue-400'
                    )}>{r.urgency}</span>
                    <button
                      onClick={() => setFulfillTarget(r)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      Fulfill
                    </button>
                  </div>
                </div>

                {/* Item chips */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.items?.map(item => (
                    <span key={item.id} className="text-xs bg-accent px-2 py-1 rounded-lg border border-border/50">
                      <span className="font-medium">{parseFloat(item.quantity)} {item.unit}</span> {item.name}
                      {item.estimatedCost && (
                        <span className="text-muted-foreground ml-1">~{formatCurrency(item.estimatedCost)} RWF</span>
                      )}
                    </span>
                  ))}
                </div>

                {r.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">Notes: {r.notes}</p>
                )}
                {r.reviewNote && (
                  <p className="text-xs text-blue-400 mt-1">Manager note: {r.reviewNote}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Purchase */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" /> Record Ad-hoc Purchase
          </h3>
          <button onClick={() => setShowPurchase(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> New Purchase
          </button>
        </div>
        <div className="space-y-2">
          {(recentMovements?.data || []).filter(m => m.type === 'IN').slice(0, 6).map(m => (
            <div key={m.id} className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
              <div>
                <span className="font-medium">{m.inventoryItem?.name}</span>
                <span className="text-muted-foreground ml-2">+{parseFloat(m.quantity)} {m.inventoryItem?.unit}</span>
                {m.reason && <span className="text-xs text-muted-foreground ml-2">· {m.reason}</span>}
              </div>
              <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
            </div>
          ))}
          {(recentMovements?.data || []).filter(m => m.type === 'IN').length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No recent purchases</p>
          )}
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="font-semibold">Current Stock Levels</h3></div>
        <table className="w-full text-sm">
          <thead className="bg-accent/50 border-b border-border">
            <tr>{['Item', 'Category', 'Stock', 'Unit', 'Min Stock', 'Status'].map(h => (
              <th key={h} className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className={cn('border-b border-border/50 hover:bg-accent/30', item.isOutOfStock && 'bg-red-500/5', item.isLowStock && !item.isOutOfStock && 'bg-orange-500/5')}>
                <td className="px-4 py-3 font-medium">
                  {item.name}
                  {item.isLiquor && <span className="ml-2 text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">Liquor</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{item.category}</td>
                <td className="px-4 py-3 font-bold">{parseFloat(item.quantity).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                <td className="px-4 py-3 text-muted-foreground">{parseFloat(item.minimumStock)}</td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold', item.isOutOfStock ? 'bg-red-500/15 text-red-400' : item.isLowStock ? 'bg-orange-500/15 text-orange-400' : 'bg-green-500/15 text-green-400')}>
                    {item.isOutOfStock ? 'OUT' : item.isLowStock ? 'LOW' : 'OK'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ad-hoc Purchase Modal */}
      {showPurchase && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-4">Record Ad-hoc Purchase</h3>
            <form onSubmit={e => { e.preventDefault(); createPurchase.mutate(purchaseForm); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Supplier</label>
                <select value={purchaseForm.supplierId} onChange={e => setPurchaseForm(f => ({ ...f, supplierId: e.target.value }))} required
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none">
                  <option value="">Select supplier...</option>
                  {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {[['product', 'Product/Item Name', 'text'], ['quantity', 'Quantity', 'number'], ['unit', 'Unit', 'text'], ['unitCost', 'Unit Cost (RWF)', 'number']].map(([k, l, t]) => (
                <div key={k}>
                  <label className="block text-sm font-medium mb-1">{l}</label>
                  <input type={t} required={k !== 'unit'} step={t === 'number' ? '0.01' : undefined}
                    value={purchaseForm[k]} onChange={e => setPurchaseForm(f => ({ ...f, [k]: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <input type="text" value={purchaseForm.notes} onChange={e => setPurchaseForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none" />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={createPurchase.isPending} className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50">
                  {createPurchase.isPending ? 'Recording...' : 'Record Purchase'}
                </button>
                <button type="button" onClick={() => setShowPurchase(false)} className="flex-1 py-2.5 bg-accent rounded-xl">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fulfill Modal */}
      {fulfillTarget && (
        <FulfillModal
          requisition={fulfillTarget}
          suppliers={supplierList}
          inventory={items}
          onClose={() => setFulfillTarget(null)}
          onSuccess={() => setFulfillTarget(null)}
        />
      )}
    </div>
  );
}