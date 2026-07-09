import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { formatCurrency, formatDateTime, cn } from '../../lib/utils';
import Badge from '../../components/shared/Badge';
import StatCard from '../../components/shared/StatCard';
import PageHeader from '../../components/shared/PageHeader';
import { Receipt, DollarSign, Clock, CheckCircle, Printer, Globe, CreditCard, Table2, X, Users, GitMerge, Scissors, ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import PrintBill from '../../components/shared/PrintBill';
import { useState, useEffect } from 'react';
import { getSocket } from '../../lib/socket';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'CREDIT'];
const BILL_TYPES = ['NORMAL', 'EBM'];

export default function CashierDashboard() {
  const [selectedBill, setSelectedBill] = useState(null);
  const [printBill, setPrintBill] = useState(null);
  const [payMethod, setPayMethod] = useState('CASH');
  const [payAmount, setPayAmount] = useState('');
  const [creditInfo, setCreditInfo] = useState({ name: '', phone: '', role: '' });
  const [tableModal, setTableModal] = useState(null);
  const [genBillType, setGenBillType] = useState('NORMAL');

  // Mobile accordion state
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [billsOpen, setBillsOpen] = useState(true);

  // Merge state
  const [mergeModal, setMergeModal] = useState(false);
  const [mergeStep, setMergeStep] = useState('source'); // source | destination | seat | confirm
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeDest, setMergeDest] = useState(null);
  const [mergeDestSeat, setMergeDestSeat] = useState(null);
  const [mergeError, setMergeError] = useState('');

  // Separate state
  const [separateModal, setSeparateModal] = useState(false);
  const [separateStep, setSeparateStep] = useState('source'); // source | sourceSeat | items | destTable | destSeat | destChoice | confirm
  const [separateSourceTable, setSeparateSourceTable] = useState(null);
  const [separateSourceOrder, setSeparateSourceOrder] = useState(null);
  const [separateQuantities, setSeparateQuantities] = useState({});
  const [separateDestTable, setSeparateDestTable] = useState(null);
  const [separateDestSeat, setSeparateDestSeat] = useState(null);
  const [separateDestChoice, setSeparateDestChoice] = useState(null); // 'merge' | 'new'
  const [separateError, setSeparateError] = useState('');

  const qc = useQueryClient();

  const { data: bills } = useQuery({ queryKey: ['bills'], queryFn: () => api.get('/bills'), refetchInterval: 10000 });
  const { data: orders } = useQuery({ queryKey: ['orders', 'active'], queryFn: () => api.get('/orders?status=SERVED'), refetchInterval: 10000 });
  const { data: onlineOrders } = useQuery({ queryKey: ['online-orders', 'pending'], queryFn: () => api.get('/online/all-orders'), refetchInterval: 10000 });
  const { data: tables } = useQuery({ queryKey: ['tables'], queryFn: () => api.get('/tables'), refetchInterval: 15000 });

  const { data: tableDetail, isLoading: tableLoading } = useQuery({
    queryKey: ['table-detail', tableModal?.id],
    queryFn: () => api.get(`/tables/${tableModal.id}`),
    enabled: !!tableModal?.id,
  });

  // ── Separate: source table detail (to list seats with active orders) ──
  const { data: separateSourceTableDetail, isLoading: separateSourceLoading } = useQuery({
    queryKey: ['table-detail', 'separate-source', separateSourceTable?.id],
    queryFn: () => api.get(`/tables/${separateSourceTable.id}`),
    enabled: !!separateSourceTable?.id,
  });

  // ── Separate: destination table detail (to list seats) ──
  const { data: separateDestTableDetail } = useQuery({
    queryKey: ['table-detail', 'separate-dest', separateDestTable?.id],
    queryFn: () => api.get(`/tables/${separateDestTable.id}`),
    enabled: !!separateDestTable?.id,
  });

  // ── Separate: check if destination seat already has an open order ──
  const { data: destSeatOrderData } = useQuery({
    queryKey: ['seat-open-order', separateDestSeat?.id],
    queryFn: () => api.get(`/orders?seatId=${separateDestSeat?.id}&status=PENDING,PREPARING,READY,SERVED`),
    enabled: !!separateDestSeat?.id,
  });

  const confirmOnlinePayment = useMutation({
    mutationFn: (id) => api.patch(`/online/orders/${id}/confirm-payment`),
    onSuccess: () => qc.invalidateQueries(['online-orders']),
  });

  const updateOnlineStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/online/orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries(['online-orders']),
  });

  const genBill = useMutation({
    mutationFn: (data) => api.post('/bills', data),
    onSuccess: () => {
      qc.invalidateQueries(['bills']);
      qc.invalidateQueries(['orders', 'active']);
      qc.invalidateQueries(['table-detail', tableModal?.id]);
    },
  });

  const markPaid = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/bills/${id}/pay`, data),
    onSuccess: (data) => {
      qc.invalidateQueries(['bills']);
      setPrintBill(data.data?.bill || selectedBill);
      setSelectedBill(null);
    },
  });

  const mergeTables = useMutation({
    mutationFn: (data) => api.post('/orders/merge', data),
    onSuccess: () => {
      qc.invalidateQueries(['tables']);
      qc.invalidateQueries(['bills']);
      qc.invalidateQueries(['orders', 'active']);
      closeMergeModal();
    },
    onError: (err) => {
      setMergeError(err?.message || 'Merge failed. Please try again.');
    },
  });

  const separateItems = useMutation({
    mutationFn: (data) => api.post('/orders/separate', data),
    onSuccess: () => {
      qc.invalidateQueries(['tables']);
      qc.invalidateQueries(['bills']);
      qc.invalidateQueries(['orders', 'active']);
      qc.invalidateQueries({ queryKey: ['table-detail'] });
      qc.invalidateQueries({ queryKey: ['seat-open-order'] });
      closeSeparateModal();
    },
    onError: (err) => {
      setSeparateError(err?.message || 'Separation failed. Please try again.');
    },
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('bill:generated', () => qc.invalidateQueries(['bills']));
    socket.on('order:served', () => qc.invalidateQueries(['orders', 'active']));
    socket.on('tables:merged', () => {
      qc.invalidateQueries(['tables']);
      qc.invalidateQueries(['bills']);
      qc.invalidateQueries(['orders', 'active']);
    });
    socket.on('order:separated', () => {
      qc.invalidateQueries(['tables']);
      qc.invalidateQueries(['bills']);
      qc.invalidateQueries(['orders', 'active']);
      qc.invalidateQueries({ queryKey: ['table-detail'] });
    });
    return () => {
      socket.off('bill:generated');
      socket.off('order:served');
      socket.off('tables:merged');
      socket.off('order:separated');
    };
  }, []);

  const allServed = orders?.data || [];
  const billRequestedOrders = allServed.filter(o => o.billRequested && !o.bill);
  const waitingOrders = allServed.filter(o => !o.billRequested && !o.bill);
  const generatedBills = (bills?.data || []).filter(b => b.status === 'GENERATED');
  const paidToday = (bills?.data || []).filter(b => b.status === 'PAID' && new Date(b.updatedAt) > new Date(new Date().setHours(0, 0, 0, 0)));
  const totalToday = paidToday.reduce((s, b) => s + parseFloat(b.total), 0);
  const occupiedTables = (tables?.data || []).filter(t => t.status === 'OCCUPIED' || t.status === 'WAITING_PAYMENT');
  const allTables = tables?.data || [];

  const handleGenBill = (orderId) => genBill.mutate({ orderId, billType: genBillType });

  const handleMarkPaid = () => {
    if (!selectedBill) return;
    const payload = { id: selectedBill.id, method: payMethod, amount: payAmount || selectedBill.total };
    if (payMethod === 'CREDIT') {
      payload.creditCustomerName = creditInfo.name;
      payload.creditCustomerPhone = creditInfo.phone;
      payload.creditCustomerRole = creditInfo.role;
    }
    markPaid.mutate(payload);
  };

  const closeMergeModal = () => {
    setMergeModal(false);
    setMergeStep('source');
    setMergeSource(null);
    setMergeDest(null);
    setMergeDestSeat(null);
    setMergeError('');
  };

  const handleMergeConfirm = () => {
    if (!mergeSource || !mergeDest || !mergeDestSeat) return;
    mergeTables.mutate({
      sourceTableId: mergeSource.id,
      destinationTableId: mergeDest.id,
      destinationSeatId: mergeDestSeat.id,
    });
  };

  // ── Separate handlers ──────────────────────────────────────────────────
  const closeSeparateModal = () => {
    setSeparateModal(false);
    setSeparateStep('source');
    setSeparateSourceTable(null);
    setSeparateSourceOrder(null);
    setSeparateQuantities({});
    setSeparateDestTable(null);
    setSeparateDestSeat(null);
    setSeparateDestChoice(null);
    setSeparateError('');
  };

  const openSeparateModal = () => {
    setSeparateModal(true);
    setSeparateStep('source');
  };

  // Jump straight to item-selection when launched from an already-open order (Table Detail modal)
  const openSeparateForOrder = (order, table) => {
    setSeparateSourceTable(table);
    setSeparateSourceOrder(order);
    setSeparateQuantities({});
    setSeparateDestTable(null);
    setSeparateDestSeat(null);
    setSeparateDestChoice(null);
    setSeparateError('');
    setSeparateModal(true);
    setSeparateStep('items');
  };

  const pickSeparateSourceSeat = (order, table) => {
    setSeparateSourceOrder(order);
    setSeparateQuantities({});
    setSeparateStep('items');
  };

  const setItemQty = (item, qty) => {
    const clamped = Math.max(0, Math.min(qty, item.quantity));
    setSeparateQuantities(q => ({ ...q, [item.id]: clamped }));
  };

  const selectedItemsPayload = Object.entries(separateQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity: Number(quantity) }));

  const canContinueFromItems = selectedItemsPayload.length > 0;

  const goToDestTable = () => {
    if (!canContinueFromItems) return;
    setSeparateError('');
    setSeparateStep('destTable');
  };

  const pickSeparateDestTable = (table) => {
    setSeparateDestTable(table);
    setSeparateDestSeat(null);
    setSeparateStep('destSeat');
  };

  const pickSeparateDestSeat = (seat) => {
    if (separateSourceOrder && seat.id === separateSourceOrder.seatId) {
      setSeparateError('Destination seat must be different from the source seat.');
      return;
    }
    setSeparateError('');
    setSeparateDestSeat(seat);
    setSeparateDestChoice(null);
    setSeparateStep('__checking'); // brief transitional state while destSeatOrderData loads
  };

  // Once destSeatOrderData resolves for the chosen seat, decide next step
  useEffect(() => {
    if (separateStep !== '__checking' || !separateDestSeat) return;
    const existing = (destSeatOrderData?.data || []).find(o => o.id !== separateSourceOrder?.id);
    if (existing) {
      setSeparateStep('destChoice');
    } else {
      setSeparateDestChoice('new');
      setSeparateStep('confirm');
    }
  }, [separateStep, destSeatOrderData, separateDestSeat, separateSourceOrder]);

  const handleSeparateConfirm = () => {
    if (!separateSourceOrder || !separateDestTable || !separateDestSeat || selectedItemsPayload.length === 0) return;
    const payload = {
      sourceOrderId: separateSourceOrder.id,
      items: selectedItemsPayload,
      destinationTableId: separateDestTable.id,
      destinationSeatId: separateDestSeat.id,
    };
    if (separateDestChoice === 'merge') {
      const existing = (destSeatOrderData?.data || []).find(o => o.id !== separateSourceOrder.id);
      if (existing) payload.destinationOrderId = existing.id;
    }
    separateItems.mutate(payload);
  };

  const existingDestOrder = (destSeatOrderData?.data || []).find(o => o.id !== separateSourceOrder?.id);

  // Step indicator component (shared visual style, works for both modals)
  const StepIndicator = ({ steps, currentKey }) => {
    const currentIdx = steps.findIndex(s => s.key === currentKey);
    return (
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={cn(
              'w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center',
              i < currentIdx ? 'bg-purple-500 text-white' :
              i === currentIdx ? 'bg-purple-500 text-white ring-2 ring-purple-300/40' :
              'bg-accent text-muted-foreground'
            )}>
              {i < currentIdx ? '✓' : i + 1}
            </div>
            <span className={cn('text-xs hidden sm:inline', i === currentIdx ? 'text-foreground font-semibold' : 'text-muted-foreground')}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
          </div>
        ))}
      </div>
    );
  };

  const SEPARATE_STEPS = [
    { key: 'source', label: 'Table' },
    { key: 'items', label: 'Items' },
    { key: 'destTable', label: 'Dest. Table' },
    { key: 'destSeat', label: 'Dest. Seat' },
    { key: 'confirm', label: 'Confirm' },
  ];
  const separateStepIndicatorKey = separateStep === '__checking' ? 'destSeat' : (separateStep === 'destChoice' ? 'confirm' : separateStep);

  return (
    <div className="space-y-6">
      <PageHeader title="Cashier Dashboard" subtitle="Manage bills and payments" />

      {/* Stats: 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Pending Bills" value={generatedBills.length} icon={Receipt} color="orange" />
        <StatCard title="Paid Today" value={paidToday.length} icon={CheckCircle} color="green" />
        <StatCard title="Today's Revenue" value={formatCurrency(totalToday)} icon={DollarSign} color="primary" />
        <StatCard title="Bill Requests" value={billRequestedOrders.length} icon={Clock} color={billRequestedOrders.length > 0 ? 'primary' : 'blue'} subtitle={billRequestedOrders.length > 0 ? '⚡ Action needed' : 'No requests'} />
      </div>

      {/* Bill Type selector — stacks nicely on mobile already */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold text-muted-foreground">Default Bill Type:</span>
        <div className="flex gap-2">
          {BILL_TYPES.map(t => (
            <button key={t} onClick={() => setGenBillType(t)}
              className={cn('px-4 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all',
                genBillType === t ? (t === 'EBM' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-primary bg-primary/10 text-primary') : 'border-border hover:border-primary/40'
              )}>
              {t === 'EBM' ? '🔵 EBM Bill' : '⬜ Normal Bill'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {genBillType === 'EBM' ? 'EBM = Electronic Billing Machine (tax receipt)' : 'Normal = Standard receipt'}
        </span>
      </div>

      {/* ── Occupied Tables ── */}
      {occupiedTables.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Table2 className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Occupied Tables</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openSeparateModal}
                className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/40 text-blue-400 rounded-xl text-sm font-semibold transition-all"
              >
                <Scissors className="w-4 h-4" />
                <span className="hidden sm:inline">Separate Items</span>
                <span className="sm:hidden">Separate</span>
              </button>
              {occupiedTables.length >= 2 && (
                <button
                  onClick={() => { setMergeModal(true); setMergeStep('source'); }}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 text-purple-400 rounded-xl text-sm font-semibold transition-all"
                >
                  <GitMerge className="w-4 h-4" />
                  <span className="hidden sm:inline">Merge Tables</span>
                  <span className="sm:hidden">Merge</span>
                </button>
              )}
            </div>
          </div>
          {/* 2 cols on mobile, wrap freely on desktop */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
            {occupiedTables.map(table => (
              <button key={table.id} onClick={() => setTableModal(table)}
                className={cn(
                  'flex flex-col items-center justify-center rounded-xl border-2 font-bold text-sm transition-all hover:scale-105',
                  // On mobile fill the grid cell; on sm+ keep fixed size
                  'h-20 sm:w-20',
                  table.status === 'WAITING_PAYMENT'
                    ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                    : 'border-red-500/40 bg-red-500/5 text-red-300 hover:border-red-400'
                )}>
                <span className="text-2xl">{table.name}</span>
                <span className="text-[10px] mt-0.5 opacity-70">{table.status === 'WAITING_PAYMENT' ? '💳 Paying' : '🔴 Occupied'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Online Orders ── */}
      {(onlineOrders?.data || []).length > 0 && (
        <div className="bg-card border border-blue-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold">Online Orders</h3>
            <span className="ml-auto text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-semibold">
              {(onlineOrders?.data || []).length} pending
            </span>
          </div>
          <div className="space-y-3">
            {(onlineOrders?.data || []).map(order => (
              <div key={order.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-blue-400">#{order.orderNumber}</span>
                    <span className="text-xs bg-accent px-2 py-0.5 rounded-full">{order.deliveryType}</span>
                    <span className="text-xs bg-accent px-2 py-0.5 rounded-full">{order.paymentMethod?.replace('_', ' ')}</span>
                  </div>
                  <p className="font-semibold text-sm">{order.customer?.name || order.guestName}</p>
                  <p className="text-xs text-muted-foreground">{order.customer?.phone || order.guestPhone}</p>
                  <p className="text-xs text-muted-foreground">{order.items?.length} item(s)</p>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2">
                  <p className="text-xl font-bold text-primary">{formatCurrency(order.total)}</p>
                  {!order.isPaid && (
                    <button onClick={() => confirmOnlinePayment.mutate(order.id)} disabled={confirmOnlinePayment.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                      <CreditCard className="w-4 h-4" /> Confirm Payment
                    </button>
                  )}
                  {order.isPaid && order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && (
                    <div className="flex flex-col gap-1 items-end">
                      <span className="text-xs text-green-400 font-semibold">✓ Paid</span>
                      {order.status === 'ACCEPTED' && <button onClick={() => updateOnlineStatus.mutate({ id: order.id, status: 'PREPARING' })} className="px-3 py-1 bg-blue-500 text-white rounded-lg text-xs font-semibold">→ Mark Preparing</button>}
                      {order.status === 'PREPARING' && <button onClick={() => updateOnlineStatus.mutate({ id: order.id, status: 'READY' })} className="px-3 py-1 bg-purple-500 text-white rounded-lg text-xs font-semibold">→ Mark Ready</button>}
                      {order.status === 'READY' && <button onClick={() => updateOnlineStatus.mutate({ id: order.id, status: 'OUT_FOR_DELIVERY' })} className="px-3 py-1 bg-orange-500 text-white rounded-lg text-xs font-semibold">→ Out for Delivery</button>}
                      {order.status === 'OUT_FOR_DELIVERY' && <button onClick={() => updateOnlineStatus.mutate({ id: order.id, status: 'DELIVERED' })} className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs font-semibold">→ Delivered</button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Orders + Bills: side-by-side on desktop, collapsible accordion on mobile ── */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Served orders — collapsible on mobile */}
        <div className={cn('flex-1 border rounded-xl', billRequestedOrders.length > 0 ? 'bg-primary/5 border-primary/40' : 'bg-card border-border')}>
          {/* Accordion header (visible on mobile, static heading on desktop) */}
          <button
            className="w-full flex items-center justify-between p-5 lg:cursor-default"
            onClick={() => setOrdersOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Served Orders — Generate Bill</h3>
              {billRequestedOrders.length > 0 && (
                <span className="text-xs bg-primary text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                  {billRequestedOrders.length} requested!
                </span>
              )}
            </div>
            <span className="lg:hidden text-muted-foreground">
              {ordersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>

          <div className={cn('px-5 pb-5 space-y-2 max-h-72 overflow-y-auto', !ordersOpen && 'hidden lg:block')}>
            {billRequestedOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between p-3 bg-primary/10 border-2 border-primary/40 rounded-xl">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-mono text-xs text-primary font-bold">{order.orderNumber?.slice(-8)}</p>
                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded font-semibold">🧾 Bill Requested</span>
                  </div>
                  <p className="text-sm font-semibold">Table {order.table?.name} • {order.seat?.label}</p>
                  <p className="text-xs text-muted-foreground">Waiter: {order.waiter?.name}</p>
                </div>
                <button onClick={() => handleGenBill(order.id)} disabled={genBill.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 shadow-md shadow-primary/20">
                  Generate {genBillType}
                </button>
              </div>
            ))}
            {waitingOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between p-3 bg-accent/50 rounded-lg">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{order.orderNumber?.slice(-8)}</p>
                  <p className="text-sm font-medium">Table {order.table?.name} • {order.seat?.label}</p>
                  <p className="text-xs text-muted-foreground">Waiter: {order.waiter?.name}</p>
                </div>
                <button onClick={() => handleGenBill(order.id)} disabled={genBill.isPending}
                  className="px-3 py-1.5 bg-accent hover:bg-border border border-border rounded-lg text-sm font-medium">
                  Generate {genBillType}
                </button>
              </div>
            ))}
            {allServed.filter(o => !o.bill).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No pending billing</p>
            )}
          </div>
        </div>

        {/* Generated bills — collapsible on mobile */}
        <div className="flex-1 bg-card border border-border rounded-xl">
          <button
            className="w-full flex items-center justify-between p-5 lg:cursor-default"
            onClick={() => setBillsOpen(o => !o)}
          >
            <h3 className="font-semibold">Bills Awaiting Payment</h3>
            <span className="lg:hidden text-muted-foreground">
              {billsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>

          <div className={cn('px-5 pb-5 space-y-2 max-h-64 overflow-y-auto', !billsOpen && 'hidden lg:block')}>
            {generatedBills.map(bill => (
              <div key={bill.id} className={cn('flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all',
                selectedBill?.id === bill.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 bg-accent/30'
              )} onClick={() => { setSelectedBill(bill); setPayAmount(String(bill.total)); }}>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs text-primary">{bill.billNumber}</p>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold',
                      bill.billType === 'EBM' ? 'bg-blue-500/10 text-blue-400' : 'bg-accent text-muted-foreground'
                    )}>{bill.billType}</span>
                  </div>
                  <p className="text-sm font-medium">Table {bill.order?.table?.name} • {bill.order?.seat?.label}</p>
                  <p className="text-xs text-muted-foreground">{bill.order?.items?.length} items</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">{formatCurrency(bill.total)}</p>
                  <button onClick={(e) => { e.stopPropagation(); setPrintBill(bill); }}
                    className="p-1 mt-1 bg-accent hover:bg-border rounded text-muted-foreground" title="Print">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {generatedBills.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No bills awaiting payment</p>}
          </div>
        </div>
      </div>

      {/* Payment panel */}
      {selectedBill && (
        <div className="bg-card border border-primary/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Process Payment — {selectedBill.billNumber}</h3>
            <button onClick={() => setSelectedBill(null)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <div className="bg-accent/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(selectedBill.subtotal)}</span></div>
            {parseFloat(selectedBill.discount) > 0 && <div className="flex justify-between text-sm text-green-400"><span>Discount</span><span>-{formatCurrency(selectedBill.discount)}</span></div>}
            <div className="flex justify-between font-bold text-lg pt-2 border-t border-border"><span>Total</span><span className="text-primary">{formatCurrency(selectedBill.total)}</span></div>
          </div>
          <div className="text-sm space-y-1 max-h-32 overflow-y-auto">
            {selectedBill.order?.items?.map(item => (
              <div key={item.id} className="flex justify-between">
                <span>{item.quantity}× {item.product?.name}</span>
                <span>{formatCurrency(parseFloat(item.unitPrice) * item.quantity)}</span>
              </div>
            ))}
          </div>
          {/* Payment method + amount: stack on mobile, side-by-side on sm+ */}
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Payment Method</label>
              <div className="grid grid-cols-3 sm:grid-cols-2 gap-2">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setPayMethod(m)}
                    className={cn('py-2 px-3 rounded-lg text-xs font-medium border-2 transition-all',
                      payMethod === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                    )}>
                    {m === 'MOBILE_MONEY' ? 'MoMo' : m === 'CREDIT_CARD' ? 'Card' : m === 'DEBIT_CARD' ? 'Debit' : m === 'BANK_TRANSFER' ? 'Bank' : m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Amount Received</label>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Amount" />
              {parseFloat(payAmount) > parseFloat(selectedBill.total) && (
                <p className="text-green-400 text-sm mt-1">Change: {formatCurrency(parseFloat(payAmount) - parseFloat(selectedBill.total))}</p>
              )}
            </div>
          </div>
          {payMethod === 'CREDIT' && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-red-400">⚠️ Credit Sale — Customer Info Required</p>
              <div className="flex flex-col sm:grid sm:grid-cols-3 gap-3">
                <input value={creditInfo.name} onChange={e => setCreditInfo(c => ({ ...c, name: e.target.value }))} placeholder="Customer Name*" className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={creditInfo.phone} onChange={e => setCreditInfo(c => ({ ...c, phone: e.target.value }))} placeholder="Phone" className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={creditInfo.role} onChange={e => setCreditInfo(c => ({ ...c, role: e.target.value }))} placeholder="Role/Position" className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleMarkPaid}
              disabled={markPaid.isPending || (!payAmount && payMethod !== 'CREDIT') || (payMethod === 'CREDIT' && !creditInfo.name)}
              className="flex-1 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              <CheckCircle className="w-5 h-5" />
              {markPaid.isPending ? 'Processing…' : `Mark PAID — ${formatCurrency(selectedBill.total)}`}
            </button>
            <button onClick={() => setPrintBill(selectedBill)} className="px-4 py-4 bg-accent hover:bg-border rounded-xl font-medium" title="Print">
              <Printer className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Table Detail Modal */}
      {tableModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <Table2 className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-lg">Table {tableModal.name} — Details</h3>
                <Badge status={tableModal.status} />
              </div>
              <button onClick={() => setTableModal(null)} className="p-1.5 hover:bg-accent rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {tableLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading table details…</p>}
              {tableDetail?.data?.seats?.map(seat => {
                const activeOrders = seat.orders?.filter(o => o.status !== 'CANCELLED') || [];
                if (!seat.isOccupied && activeOrders.length === 0) return null;
                return (
                  <div key={seat.id} className="bg-accent/30 border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="font-semibold">Seat {seat.label}</span>
                      {seat.isOccupied && <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">Occupied</span>}
                    </div>
                    {activeOrders.map(order => (
                      <div key={order.id} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="font-mono text-xs text-primary font-bold">#{order.orderNumber?.slice(-6)}</span>
                          <span className="text-xs text-muted-foreground">by {order.waiter?.name}</span>
                          <Badge status={order.status} />
                          {order.bill && (
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold ml-auto',
                              order.bill.status === 'PAID' ? 'bg-green-500/10 text-green-400' : 'bg-orange-500/10 text-orange-400'
                            )}>
                              {order.bill.status === 'PAID' ? '✓ PAID' : `Bill: ${formatCurrency(order.bill.total)}`}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 ml-2">
                          {order.items?.map(item => (
                            <div key={item.id} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{item.quantity}× {item.product?.name}</span>
                              <span>{formatCurrency(parseFloat(item.unitPrice) * item.quantity)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between font-semibold pt-1 border-t border-border/50 text-sm">
                            <span>Order Total</span>
                            <span className="text-primary">{formatCurrency(order.items?.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0))}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          {order.status === 'SERVED' && !order.bill && (
                            <button onClick={() => handleGenBill(order.id)} disabled={genBill.isPending}
                              className="flex-1 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                              Generate {genBillType} Bill
                            </button>
                          )}
                          {order.bill?.status !== 'PAID' && order.items?.length > 0 && (
                            <button
                              onClick={() => { setTableModal(null); openSeparateForOrder(order, tableModal); }}
                              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/40 text-blue-400 text-sm font-semibold rounded-xl transition-all"
                            >
                              <Scissors className="w-3.5 h-3.5" /> Separate
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!tableLoading && tableDetail?.data?.seats?.every(s => !s.isOccupied && (s.orders?.length === 0)) && (
                <p className="text-sm text-muted-foreground text-center py-8">No active orders at this table</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Merge Tables Modal ── */}
      {mergeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <GitMerge className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-lg">Merge Tables</h3>
              </div>
              <button onClick={closeMergeModal} className="p-1.5 hover:bg-accent rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <StepIndicator
                steps={[
                  { key: 'source', label: 'Source' },
                  { key: 'destination', label: 'Destination' },
                  { key: 'seat', label: 'Seat' },
                  { key: 'confirm', label: 'Confirm' },
                ]}
                currentKey={mergeStep}
              />

              {/* Step 1: Pick source table */}
              {mergeStep === 'source' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Which table's orders do you want to move?</p>
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
                    {occupiedTables.map(table => (
                      <button key={table.id}
                        onClick={() => { setMergeSource(table); setMergeDest(null); setMergeDestSeat(null); setMergeStep('destination'); }}
                        className={cn(
                          'flex flex-col items-center justify-center h-20 rounded-xl border-2 font-bold text-sm transition-all hover:scale-105 sm:w-20',
                          mergeSource?.id === table.id
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : 'border-border hover:border-purple-500/50 bg-accent/50'
                        )}>
                        <span className="text-2xl">{table.name}</span>
                        <span className="text-[9px] opacity-60 mt-0.5">{table.seats?.filter(s => s.isOccupied).length} occupied</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Pick destination table */}
              {mergeStep === 'destination' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Move orders from <strong className="text-purple-400">Table {mergeSource?.name}</strong> into which table?
                  </p>
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
                    {occupiedTables.filter(t => t.id !== mergeSource?.id).map(table => (
                      <button key={table.id}
                        onClick={() => { setMergeDest(table); setMergeDestSeat(null); setMergeStep('seat'); }}
                        className={cn(
                          'flex flex-col items-center justify-center h-20 rounded-xl border-2 font-bold text-sm transition-all hover:scale-105 sm:w-20',
                          mergeDest?.id === table.id
                            ? 'border-green-500 bg-green-500/20 text-green-300'
                            : 'border-border hover:border-green-500/50 bg-accent/50'
                        )}>
                        <span className="text-2xl">{table.name}</span>
                        <span className="text-[9px] opacity-60 mt-0.5">{table.seats?.filter(s => s.isOccupied).length} occupied</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setMergeStep('source')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Step 3: Pick destination seat */}
              {mergeStep === 'seat' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Which seat on <strong className="text-green-400">Table {mergeDest?.name}</strong> should receive the orders?
                  </p>
                  <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2">
                    {mergeDest?.seats?.map(seat => (
                      <button key={seat.id}
                        onClick={() => { setMergeDestSeat(seat); setMergeStep('confirm'); }}
                        className={cn(
                          'flex flex-col items-center justify-center h-16 rounded-xl border-2 font-bold text-sm transition-all sm:w-16',
                          mergeDestSeat?.id === seat.id
                            ? 'border-green-500 bg-green-500/20 text-green-300'
                            : seat.isOccupied
                              ? 'border-red-500/50 bg-red-500/10 text-red-300 hover:border-green-500/50'
                              : 'border-green-500/40 bg-green-500/5 text-green-300 hover:border-green-500'
                        )}>
                        <span className="text-sm">{seat.label}</span>
                        <span className="text-[9px] mt-0.5 opacity-70">{seat.isOccupied ? '🔴 Occupied' : '🟢 Free'}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">You can pick an occupied seat — the orders will be added to it.</p>
                  <button onClick={() => setMergeStep('destination')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Step 4: Confirm */}
              {mergeStep === 'confirm' && (
                <div className="space-y-4">
                  <div className="bg-accent/50 border border-border rounded-xl p-4 space-y-3 text-sm">
                    <div className="flex items-center justify-center gap-4 font-semibold text-base flex-wrap">
                      <span className="px-3 py-1.5 bg-purple-500/20 text-purple-300 rounded-lg">Table {mergeSource?.name}</span>
                      <span className="text-muted-foreground text-lg">→</span>
                      <span className="px-3 py-1.5 bg-green-500/20 text-green-300 rounded-lg">Table {mergeDest?.name} • {mergeDestSeat?.label}</span>
                    </div>
                    <div className="pt-2 space-y-1 text-muted-foreground">
                      <p>• All open orders from <strong className="text-foreground">Table {mergeSource?.name}</strong> will move to <strong className="text-foreground">Table {mergeDest?.name} — Seat {mergeDestSeat?.label}</strong></p>
                      <p>• Table {mergeSource?.name} will become <span className="text-green-400 font-semibold">Available</span></p>
                      <p>• Kitchen & Bar screens will update immediately</p>
                    </div>
                  </div>

                  {mergeError && (
                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{mergeError}</p>
                  )}

                  <div className="flex gap-3">
                    <button onClick={() => setMergeStep('seat')} className="flex-1 py-3 bg-accent hover:bg-border rounded-xl text-sm font-semibold">
                      ← Back
                    </button>
                    <button
                      onClick={handleMergeConfirm}
                      disabled={mergeTables.isPending}
                      className="flex-1 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <GitMerge className="w-4 h-4" />
                      {mergeTables.isPending ? 'Merging…' : 'Confirm Merge'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Separate Items Modal ── */}
      {separateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <Scissors className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-lg">Separate Items</h3>
              </div>
              <button onClick={closeSeparateModal} className="p-1.5 hover:bg-accent rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              <StepIndicator steps={SEPARATE_STEPS} currentKey={separateStepIndicatorKey} />

              {/* Step: pick source table (skipped if launched from Table Detail modal) */}
              {separateStep === 'source' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Which table has the items you want to separate?</p>
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
                    {occupiedTables.map(table => (
                      <button key={table.id}
                        onClick={() => { setSeparateSourceTable(table); setSeparateStep('sourceSeat'); }}
                        className={cn(
                          'flex flex-col items-center justify-center h-20 rounded-xl border-2 font-bold text-sm transition-all hover:scale-105 sm:w-20',
                          separateSourceTable?.id === table.id
                            ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                            : 'border-border hover:border-blue-500/50 bg-accent/50'
                        )}>
                        <span className="text-2xl">{table.name}</span>
                        <span className="text-[9px] opacity-60 mt-0.5">{table.seats?.filter(s => s.isOccupied).length} occupied</span>
                      </button>
                    ))}
                  </div>
                  {occupiedTables.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No occupied tables right now</p>}
                </div>
              )}

              {/* Step: pick source seat/order */}
              {separateStep === 'sourceSeat' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Which seat's order on <strong className="text-blue-400">Table {separateSourceTable?.name}</strong> has the items?
                  </p>
                  {separateSourceLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>}
                  <div className="space-y-2">
                    {separateSourceTableDetail?.data?.seats?.map(seat => {
                      const activeOrder = (seat.orders || []).find(o => o.status !== 'CANCELLED' && o.bill?.status !== 'PAID');
                      if (!activeOrder || !activeOrder.items?.length) return null;
                      return (
                        <button key={seat.id}
                          onClick={() => pickSeparateSourceSeat(activeOrder, separateSourceTable)}
                          className="w-full flex items-center justify-between p-3 rounded-xl border-2 border-border hover:border-blue-500/50 bg-accent/30 transition-all text-left"
                        >
                          <div>
                            <p className="font-semibold text-sm">Seat {seat.label} — #{activeOrder.orderNumber?.slice(-6)}</p>
                            <p className="text-xs text-muted-foreground">{activeOrder.items.length} item line(s)</p>
                          </div>
                          <Badge status={activeOrder.status} />
                        </button>
                      );
                    })}
                    {separateSourceTableDetail && !separateSourceTableDetail.data?.seats?.some(s => (s.orders || []).some(o => o.status !== 'CANCELLED' && o.bill?.status !== 'PAID' && o.items?.length)) && (
                      <p className="text-sm text-muted-foreground text-center py-6">No open orders with items on this table</p>
                    )}
                  </div>
                  <button onClick={() => setSeparateStep('source')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Step: choose items + quantities */}
              {separateStep === 'items' && separateSourceOrder && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Table <strong className="text-blue-400">{separateSourceOrder.table?.name || separateSourceTable?.name}</strong> • Seat <strong className="text-blue-400">{separateSourceOrder.seat?.label}</strong> — choose how many of each item to separate out.
                  </p>
                  <div className="space-y-2">
                    {separateSourceOrder.items?.map(item => {
                      const qty = separateQuantities[item.id] || 0;
                      return (
                        <div key={item.id} className="flex items-center justify-between p-3 bg-accent/30 border border-border rounded-xl">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.product?.name}</p>
                            <p className="text-xs text-muted-foreground">{item.quantity} ordered • {formatCurrency(parseFloat(item.unitPrice))} each</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => setItemQty(item, qty - 1)} disabled={qty <= 0}
                              className="w-7 h-7 rounded-lg bg-accent hover:bg-border disabled:opacity-30 flex items-center justify-center">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-bold">{qty}</span>
                            <button onClick={() => setItemQty(item, qty + 1)} disabled={qty >= item.quantity}
                              className="w-7 h-7 rounded-lg bg-accent hover:bg-border disabled:opacity-30 flex items-center justify-center">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {separateError && (
                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{separateError}</p>
                  )}
                  <div className="flex gap-3">
                    <button onClick={() => (separateSourceTable ? setSeparateStep('sourceSeat') : closeSeparateModal())} className="flex-1 py-3 bg-accent hover:bg-border rounded-xl text-sm font-semibold">
                      ← Back
                    </button>
                    <button onClick={goToDestTable} disabled={!canContinueFromItems}
                      className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step: pick destination table (any status) */}
              {separateStep === 'destTable' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Which table should receive the separated items? (Any table — available or occupied.)</p>
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
                    {allTables.map(table => (
                      <button key={table.id}
                        onClick={() => pickSeparateDestTable(table)}
                        className={cn(
                          'flex flex-col items-center justify-center h-20 rounded-xl border-2 font-bold text-sm transition-all hover:scale-105 sm:w-20',
                          separateDestTable?.id === table.id
                            ? 'border-green-500 bg-green-500/20 text-green-300'
                            : table.status === 'AVAILABLE'
                              ? 'border-green-500/40 bg-green-500/5 text-green-300 hover:border-green-500/60'
                              : 'border-border hover:border-green-500/50 bg-accent/50'
                        )}>
                        <span className="text-2xl">{table.name}</span>
                        <span className="text-[9px] opacity-60 mt-0.5">{table.status === 'AVAILABLE' ? 'Available' : `${table.seats?.filter(s => s.isOccupied).length} occupied`}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setSeparateStep('items')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Step: pick destination seat */}
              {separateStep === 'destSeat' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Which seat on <strong className="text-green-400">Table {separateDestTable?.name}</strong> should receive the items?
                  </p>
                  <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2">
                    {(separateDestTableDetail?.data?.seats || separateDestTable?.seats)?.map(seat => (
                      <button key={seat.id}
                        onClick={() => pickSeparateDestSeat(seat)}
                        disabled={separateSourceOrder && seat.id === separateSourceOrder.seatId}
                        className={cn(
                          'flex flex-col items-center justify-center h-16 rounded-xl border-2 font-bold text-sm transition-all sm:w-16',
                          separateSourceOrder && seat.id === separateSourceOrder.seatId
                            ? 'border-border bg-accent/30 text-muted-foreground opacity-40 cursor-not-allowed'
                            : seat.isOccupied
                              ? 'border-red-500/50 bg-red-500/10 text-red-300 hover:border-green-500/50'
                              : 'border-green-500/40 bg-green-500/5 text-green-300 hover:border-green-500'
                        )}>
                        <span className="text-sm">{seat.label}</span>
                        <span className="text-[9px] mt-0.5 opacity-70">{seat.isOccupied ? '🔴 Occupied' : '🟢 Free'}</span>
                      </button>
                    ))}
                  </div>
                  {separateError && (
                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{separateError}</p>
                  )}
                  <button onClick={() => setSeparateStep('destTable')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Transitional: checking for existing order on destination seat */}
              {separateStep === '__checking' && (
                <p className="text-sm text-muted-foreground text-center py-8">Checking destination seat…</p>
              )}

              {/* Step: merge into existing order, or create new */}
              {separateStep === 'destChoice' && existingDestOrder && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Seat <strong className="text-green-400">{separateDestSeat?.label}</strong> on Table <strong className="text-green-400">{separateDestTable?.name}</strong> already has an open order (#{existingDestOrder.orderNumber?.slice(-6)}). What should happen?
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    <button onClick={() => { setSeparateDestChoice('merge'); setSeparateStep('confirm'); }}
                      className={cn('p-4 rounded-xl border-2 text-left transition-all',
                        separateDestChoice === 'merge' ? 'border-blue-500 bg-blue-500/10' : 'border-border hover:border-blue-500/40 bg-accent/30'
                      )}>
                      <p className="font-semibold text-sm">Merge into existing order</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Items get added to order #{existingDestOrder.orderNumber?.slice(-6)}</p>
                    </button>
                    <button onClick={() => { setSeparateDestChoice('new'); setSeparateStep('confirm'); }}
                      className={cn('p-4 rounded-xl border-2 text-left transition-all',
                        separateDestChoice === 'new' ? 'border-blue-500 bg-blue-500/10' : 'border-border hover:border-blue-500/40 bg-accent/30'
                      )}>
                      <p className="font-semibold text-sm">Create a brand new separate order</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Items become their own order on this seat</p>
                    </button>
                  </div>
                  <button onClick={() => setSeparateStep('destSeat')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
                </div>
              )}

              {/* Step: confirm */}
              {separateStep === 'confirm' && (
                <div className="space-y-4">
                  <div className="bg-accent/50 border border-border rounded-xl p-4 space-y-3 text-sm">
                    <div className="flex items-center justify-center gap-4 font-semibold text-base flex-wrap">
                      <span className="px-3 py-1.5 bg-blue-500/20 text-blue-300 rounded-lg">
                        Table {separateSourceOrder?.table?.name || separateSourceTable?.name} • {separateSourceOrder?.seat?.label}
                      </span>
                      <span className="text-muted-foreground text-lg">→</span>
                      <span className="px-3 py-1.5 bg-green-500/20 text-green-300 rounded-lg">
                        Table {separateDestTable?.name} • {separateDestSeat?.label}
                      </span>
                    </div>
                    <div className="pt-2 space-y-1">
                      <p className="text-muted-foreground font-semibold">Items to separate:</p>
                      {separateSourceOrder?.items
                        ?.filter(i => (separateQuantities[i.id] || 0) > 0)
                        .map(i => (
                          <div key={i.id} className="flex justify-between">
                            <span>{separateQuantities[i.id]}× {i.product?.name}</span>
                            <span className="text-primary font-medium">{formatCurrency(parseFloat(i.unitPrice) * separateQuantities[i.id])}</span>
                          </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      {separateDestChoice === 'merge'
                        ? `These items will be added to the existing order on Table ${separateDestTable?.name} • ${separateDestSeat?.label}.`
                        : `These items will become a new order on Table ${separateDestTable?.name} • ${separateDestSeat?.label}.`}
                      {' '}Bills already generated will be recalculated automatically.
                    </p>
                  </div>

                  {separateError && (
                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{separateError}</p>
                  )}

                  <div className="flex gap-3">
                    <button onClick={() => setSeparateStep(existingDestOrder ? 'destChoice' : 'destSeat')} className="flex-1 py-3 bg-accent hover:bg-border rounded-xl text-sm font-semibold">
                      ← Back
                    </button>
                    <button
                      onClick={handleSeparateConfirm}
                      disabled={separateItems.isPending}
                      className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Scissors className="w-4 h-4" />
                      {separateItems.isPending ? 'Separating…' : 'Confirm Separate'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {printBill && <PrintBill bill={printBill} onClose={() => setPrintBill(null)} />}
    </div>
  );
}