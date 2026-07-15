import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  Clock, Bike, User, Phone, MapPin, RefreshCw,
  PackageOpen, PackageCheck, XCircle, PlusCircle, UserCheck, Truck
} from 'lucide-react';
import type { IDelivery, IRider } from '../types';
import AssignRiderModal from '../components/AssignRiderModal';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LiveOrdersPageProps {
  activeOrgId: string;
}

const COLUMNS = [
  {
    status: 'unassigned' as const,
    title: 'Order Created',
    shortTitle: 'Created',
    Icon: PlusCircle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderCls: 'border-amber-500/30',
    dotColor: 'bg-amber-400',
  },
  {
    status: 'ASSIGNED' as const,
    title: 'Rider Assigned',
    shortTitle: 'Assigned',
    Icon: UserCheck,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderCls: 'border-blue-500/30',
    dotColor: 'bg-blue-400',
  },
  {
    status: 'RIDER_EN_ROUTE_TO_PICKUP' as const,
    title: 'En Route / At Store',
    shortTitle: 'En Route',
    Icon: Truck,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderCls: 'border-purple-500/30',
    dotColor: 'bg-purple-400',
  },
  {
    status: 'IN_TRIP' as const,
    title: 'Parcel Picked',
    shortTitle: 'Picked',
    Icon: PackageOpen,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderCls: 'border-indigo-500/30',
    dotColor: 'bg-indigo-400',
  },
  {
    status: 'COMPLETED' as const,
    title: 'Delivered',
    shortTitle: 'Delivered',
    Icon: PackageCheck,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderCls: 'border-emerald-500/30',
    dotColor: 'bg-emerald-400',
  },
  {
    status: 'CANCELLED' as const,
    title: 'Cancelled',
    shortTitle: 'Cancelled',
    Icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderCls: 'border-red-500/30',
    dotColor: 'bg-red-400',
  },
];

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned',
  RIDER_EN_ROUTE_TO_PICKUP: 'En Route',
  ARRIVED_AT_PICKUP: 'At Store',
  IN_TRIP: 'In Transit',
  COMPLETED: 'Delivered',
  CANCELLED: 'Cancelled',
  unassigned: 'Unassigned',
};

export default function LiveOrdersPage({ activeOrgId }: LiveOrdersPageProps) {
  const [deliveries, setDeliveries] = useState<IDelivery[]>([]);
  const [riders, setRiders] = useState<IRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState<IDelivery | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [allowStaffManual, setAllowStaffManual] = useState(true);
  const [orgStrategy, setOrgStrategy] = useState('hybrid');

  // Check if current user is admin
  const currentUserStr = localStorage.getItem('user');
  const currentUser = currentUserStr ? JSON.parse(currentUserStr) : null;
  const isAdmin = currentUser?.role === 'owner';

  const fetchOrdersAndRiders = async () => {
    if (!activeOrgId) return;
    try {
      const [delRes, riderRes, orgRes] = await Promise.all([
        api.get(`/delivery?orgId=${activeOrgId}`),
        api.get(`/rider/list?orgId=${activeOrgId}`),
        api.get(`/org/${activeOrgId}`)
      ]);
      setDeliveries(delRes.data);
      setRiders(riderRes.data);
      setAllowStaffManual(orgRes.data.ownRiderConfig?.allowStaffManualAssignment ?? true);
      setOrgStrategy(orgRes.data.ownRiderConfig?.assignmentStrategy || 'hybrid');
    } catch (err) {
      console.error('Failed to fetch orders or riders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrdersAndRiders();

    // Connect to the socket server (port 5001)
    const socket = io('http://localhost:5001');

    socket.on('connect', () => {
      console.log('[Live Dispatch Desk Socket] Connected:', socket.id);
      if (activeOrgId) {
        socket.emit('join_org', activeOrgId);
      }
    });

    // Handle incoming real-time socket updates
    socket.on('delivery_status_updated', (data) => {
      fetchOrdersAndRiders();
      if (data?.status && data?.orderId) {
        const short = data.orderId.substring(18).toUpperCase();
        const label = STATUS_LABEL[data.status] || data.status;
        toast.info(`Order #${short} → ${label}`);
      }
    });

    socket.on('own_rider_assigned', (data) => {
      fetchOrdersAndRiders();
      if (data?.riderName && data?.orderId) {
        const orderIdShort = data.orderId.substring(18).toUpperCase();
        toast.success(`Order #${orderIdShort} assigned to ${data.riderName}`);
      }
    });

    socket.on('own_rider_timeout', (data) => {
      fetchOrdersAndRiders();
      if (data?.message) {
        toast.error(data.message, { duration: 6000 });
      }
    });

    socket.on('own_rider_manual_required', () => {
      fetchOrdersAndRiders();
    });

    socket.on('own_rider_fallback_triggered', () => {
      fetchOrdersAndRiders();
    });

    const interval = setInterval(fetchOrdersAndRiders, 10000); // Fallback polling (less frequent because of socket)

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [activeOrgId]);

  const handleOpenAssignModal = (delivery: IDelivery) => {
    setSelectedDelivery(delivery);
    setAssignModalOpen(true);
  };

  const handleAssignRider = async (riderId: string) => {
    if (!selectedDelivery) return;
    try {
      await api.post('/rider/assign', {
        deliveryId: selectedDelivery._id,
        riderId
      });
      setAssignModalOpen(false);
      setSelectedDelivery(null);
      fetchOrdersAndRiders();
    } catch (err) {
      console.error('Error assigning rider:', err);
      alert('Rider is no longer available');
    }
  };

  // Helper to map DB statuses to our columns
  const getColumnDeliveries = (colStatus: string) => {
    if (colStatus === 'RIDER_EN_ROUTE_TO_PICKUP') {
      return deliveries.filter(d => ['RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP'].includes(d.status));
    }
    return deliveries.filter(d => d.status === colStatus);
  };

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm">Syncing Live Desk...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Real-time Operations
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live view of orders moving through dispatch states.
          </p>
        </div>
        {/* Summary pills — always visible, wrap on small screens */}
        <div className="flex flex-wrap gap-1.5">
          {COLUMNS.map(col => {
            const count = getColumnDeliveries(col.status).length;
            return (
              <span
                key={col.status}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${col.bgColor} ${col.borderCls} ${col.color}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${col.dotColor}`} />
                {col.shortTitle}
                <span className="font-extrabold">{count}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Kanban Board — horizontally scrollable, each column is fixed width */}
      <div
        className="flex gap-4 overflow-x-auto pb-3"
        style={{ scrollbarWidth: 'thin' }}
      >
        {COLUMNS.map((col) => {
          const colDeliveries = getColumnDeliveries(col.status);
          const { Icon } = col;

          return (
            <div
              key={col.status}
              className="flex flex-col shrink-0 w-[280px] sm:w-[300px] bg-secondary/30 border rounded-2xl p-3"
            >
              {/* Column Header */}
              <div className={`flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl ${col.bgColor} border ${col.borderCls}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Icon size={13} className={`${col.color} shrink-0`} />
                  <span className={`text-[11px] font-bold ${col.color} uppercase tracking-wider truncate`}>
                    {col.title}
                  </span>
                </div>
                <span className={`text-[10px] font-extrabold ml-2 px-2 py-0.5 rounded-full bg-background border shrink-0 ${col.color} ${col.borderCls}`}>
                  {colDeliveries.length}
                </span>
              </div>

              {/* Scrollable Card List */}
              <div
                className="flex-1 overflow-y-auto space-y-2.5 pr-0.5"
                style={{
                  minHeight: '160px',
                  maxHeight: 'calc(100vh - 270px)',
                  scrollbarWidth: 'thin',
                }}
              >
                {colDeliveries.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <Clock size={24} className="opacity-25" />
                    <span className="text-[10px] font-bold tracking-widest uppercase opacity-50">
                      Awaiting
                    </span>
                  </div>
                ) : (
                  colDeliveries.map((delivery) => {
                    const arrivedAtStore = delivery.status === 'ARRIVED_AT_PICKUP';
                    const statusText = arrivedAtStore
                      ? 'At Store'
                      : STATUS_LABEL[delivery.status] || delivery.status;
                    const isBreached = delivery.sla?.slaBreached;

                    return (
                      <Card
                        key={delivery._id}
                        className={`select-none shadow-sm transition-shadow hover:shadow-md ${
                          isBreached
                            ? 'border-red-500/50 shadow-red-500/10'
                            : 'border-border'
                        }`}
                      >
                        <CardContent className="p-3 space-y-2.5">
                          {/* Order ID + status badge */}
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-[10px] text-primary font-bold uppercase tracking-wider shrink-0">
                              #{delivery._id.substring(18)}
                            </span>
                            <div className="flex flex-col items-end gap-1 min-w-0">
                              <Badge
                                variant="outline"
                                className={`text-[8px] font-bold uppercase tracking-wider whitespace-nowrap ${
                                  delivery.status === 'COMPLETED'
                                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                                    : delivery.status === 'CANCELLED'
                                    ? 'bg-red-500/10 text-red-500 border-red-500/30'
                                    : arrivedAtStore
                                    ? 'bg-orange-500/10 text-orange-500 border-orange-500/30'
                                    : 'bg-primary/10 text-primary border-primary/20'
                                }`}
                              >
                                {statusText}
                              </Badge>
                              {isBreached && (
                                <Badge className="text-[8px] font-bold uppercase tracking-wider bg-red-500 text-white animate-pulse whitespace-nowrap">
                                  SLA Breach
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Customer info */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <User size={11} className="text-muted-foreground shrink-0" />
                              <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider shrink-0">
                                Cust:
                              </span>
                              <span className="text-[11px] font-semibold truncate">
                                {delivery.customer?.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 pl-[15px]">
                              <Phone size={10} className="text-muted-foreground shrink-0" />
                              <span className="text-[10px] text-muted-foreground truncate">
                                {delivery.customer?.phone}
                              </span>
                            </div>
                          </div>

                          {/* Drop location */}
                          <div className="flex items-start gap-1.5 border-t border-border/50 pt-2">
                            <MapPin size={11} className="text-primary shrink-0 mt-0.5" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">
                                Drop
                              </span>
                              <span className="text-[10px] font-medium truncate text-foreground/80">
                                {delivery.drop?.label}
                              </span>
                            </div>
                          </div>

                          {/* Rider info */}
                          {delivery.ownRiderAssignment?.riderName ? (
                            <div className="flex items-center justify-between bg-secondary/60 border border-border/50 rounded-lg px-2.5 py-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Bike size={12} className="text-emerald-500 shrink-0" />
                                <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider shrink-0">
                                  Rider:
                                </span>
                                <span className="text-[11px] font-semibold truncate">
                                  {delivery.ownRiderAssignment.riderName}
                                </span>
                              </div>
                              <span className="text-[9px] text-muted-foreground shrink-0 ml-1">
                                #{delivery.ownRiderAssignment.attemptCount}
                              </span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground/60 italic">
                              No rider assigned
                            </div>
                          )}

                          {/* Assign Rider button */}
                          {delivery.status === 'unassigned' && (isAdmin || allowStaffManual) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAssignModal(delivery)}
                              className="w-full text-[10px] font-bold h-7 text-primary border-primary/30 bg-primary/5 hover:bg-primary hover:text-primary-foreground transition-colors"
                            >
                              Assign Rider
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDelivery && (
        <AssignRiderModal
          isOpen={assignModalOpen}
          onClose={() => {
            setAssignModalOpen(false);
            setSelectedDelivery(null);
          }}
          delivery={selectedDelivery}
          riders={riders}
          orgStrategy={orgStrategy}
          onConfirm={handleAssignRider}
        />
      )}
    </div>
  );
}
