import { Outlet, useLocation, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { cn } from '../../lib/utils';
import {
  LayoutDashboard, ShoppingCart, MapPin, Receipt, Clock,
  ChefHat, Wine, Warehouse, ClipboardCheck, RotateCcw,
  PackageOpen, Bell,
} from 'lucide-react';

const bottomNavConfig = {
  ADMIN: [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/admin' },
    { label: 'Orders',    icon: ShoppingCart,    href: '/orders' },
    { label: 'Tables',    icon: MapPin,          href: '/tables' },
    { label: 'Bills',     icon: Receipt,         href: '/bills' },
    { label: 'Alerts',    icon: Bell,            href: '/notifications' },
  ],
  MANAGER: [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/manager' },
    { label: 'Orders',    icon: ShoppingCart,    href: '/orders' },
    { label: 'Tables',    icon: MapPin,          href: '/tables' },
    { label: 'Bills',     icon: Receipt,         href: '/bills' },
    { label: 'Alerts',    icon: Bell,            href: '/notifications' },
  ],
  CASHIER: [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/cashier' },
    { label: 'Bills',     icon: Receipt,         href: '/bills' },
    { label: 'Orders',    icon: ShoppingCart,    href: '/orders' },
    { label: 'Tables',    icon: MapPin,          href: '/tables' },
    { label: 'Alerts',    icon: Bell,            href: '/notifications' },
  ],
  WAITER: [
    { label: 'Tables',  icon: MapPin,        href: '/waiter' },
    { label: 'Orders',  icon: ShoppingCart,  href: '/orders' },
    { label: 'Returns', icon: RotateCcw,     href: '/returns' },
    { label: 'Clock',   icon: Clock,         href: '/attendance' },
    { label: 'Alerts',  icon: Bell,          href: '/notifications' },
  ],
  KITCHEN: [
    { label: 'Queue',    icon: ChefHat,        href: '/kitchen' },
    { label: 'Requests', icon: ClipboardCheck, href: '/requisitions' },
    { label: 'Returns',  icon: RotateCcw,      href: '/returns' },
    { label: 'Clock',    icon: Clock,          href: '/attendance' },
    { label: 'Alerts',   icon: Bell,           href: '/notifications' },
  ],
  BAR: [
    { label: 'Queue',    icon: Wine,           href: '/bar' },
    { label: 'Requests', icon: ClipboardCheck, href: '/requisitions' },
    { label: 'Returns',  icon: RotateCcw,      href: '/returns' },
    { label: 'Clock',    icon: Clock,          href: '/attendance' },
    { label: 'Alerts',   icon: Bell,           href: '/notifications' },
  ],
  STOREKEEPER: [
    { label: 'Dashboard', icon: PackageOpen,    href: '/storekeeper' },
    { label: 'Inventory', icon: Warehouse,      href: '/inventory' },
    { label: 'Requests',  icon: ClipboardCheck, href: '/requisitions' },
    { label: 'Clock',     icon: Clock,          href: '/attendance' },
    { label: 'Alerts',    icon: Bell,           href: '/notifications' },
  ],
};

function BottomNav() {
  const { user } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const items = bottomNavConfig[user?.role] || [];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 h-16 bg-card border-t border-border flex items-center justify-around px-1">
      {items.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          className={({ isActive }) => cn(
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full px-1 transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {({ isActive }) => (
            <>
              <div className={cn(
                'relative p-1.5 rounded-xl transition-colors',
                isActive && 'bg-primary/10'
              )}>
                <item.icon className="w-5 h-5" />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function useBreakpoint() {
  const getBreakpoint = () => {
    if (window.innerWidth >= 1024) return 'desktop';
    if (window.innerWidth >= 768)  return 'tablet';
    return 'mobile';
  };
  const [bp, setBp] = useState(getBreakpoint);
  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return bp;
}

export default function DashboardLayout() {
  const bp = useBreakpoint();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(bp === 'desktop');

  useEffect(() => {
    if (bp === 'desktop') setSidebarOpen(true);
    if (bp === 'tablet')  setSidebarOpen(false);
    if (bp === 'mobile')  setSidebarOpen(false);
  }, [bp]);

  useEffect(() => {
    if (bp === 'mobile') setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar open={sidebarOpen} bp={bp} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(o => !o)} />
        <main className={`flex-1 overflow-auto p-4 md:p-6 ${bp === 'mobile' ? 'pb-20' : ''}`}>
          <Outlet />
        </main>
      </div>
      {bp === 'mobile' && <BottomNav />}
    </div>
  );
}