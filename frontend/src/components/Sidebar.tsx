import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Clock,
  PlusCircle,
  LayoutDashboard,
  Truck,
  Settings,
  FileText,
  Bike,
  Menu,
  X,
  LogOut
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuGroups = [
    {
      title: 'OPERATIONS',
      items: [
        { name: 'Live Orders', path: '/', icon: Clock },
        { name: 'Create Order', path: '/create-order', icon: PlusCircle },
        { name: 'Rider Sim', path: '/rider-simulator', icon: Bike }
      ]
    },
    {
      title: 'MANAGEMENT',
      items: [
        { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
        { name: 'Deliveries', path: '/deliveries', icon: Truck },
        { name: 'Riders', path: '/riders', icon: Bike },
        { name: 'Audit Logs', path: '/audit-logs', icon: FileText }
      ]
    }
  ];

  const adminGroup = {
    title: 'ADMINISTRATION',
    items: [
      { name: 'Store Config', path: '/settings', icon: Settings },
    ]
  };

  if (user?.role === 'owner') {
    menuGroups.push(adminGroup);
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-background text-sm">
      {/* Brand Header */}
      <div className="p-5 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
            <Truck size={18} />
          </div>
          <div>
            <h1 className="font-extrabold text-foreground tracking-wide leading-none text-sm">OWNCHAT</h1>
            <span className="text-[10px] text-primary font-bold tracking-widest uppercase">DELIVERY</span>
          </div>
        </div>
      </div>

      {/* Menu Groups */}
      <nav className="flex-1 py-5 overflow-y-auto px-3 space-y-5">
        {menuGroups.map((group) => (
          <div key={group.title} className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
              {group.title}
            </h3>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Button
                  key={item.name}
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={`w-full justify-start gap-3 px-3 py-5 rounded-xl font-semibold transition-all cursor-pointer text-sm ${isActive ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => handleNavClick(item.path)}
                >
                  <Icon size={17} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                  {item.name}
                </Button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Logout button */}
      {user && (
        <div className="p-4 border-t flex flex-col gap-2 shrink-0">
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="w-full justify-start gap-3 px-3 py-5 rounded-xl font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer text-sm"
          >
            <LogOut size={17} />
            Logout
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile Hamburger Button & Sheet */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger render={<Button variant="outline" size="icon" className="rounded-xl shadow-md bg-background" />}>
            <Menu size={20} />
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64 border-r">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r h-screen shrink-0 bg-background">
        <SidebarContent />
      </aside>
    </>
  );
}
