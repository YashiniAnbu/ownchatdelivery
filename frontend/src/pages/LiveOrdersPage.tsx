import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Clock, Check, Bike, User, Phone, MapPin, AlertCircle, RefreshCw } from 'lucide-react';
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

export default function LiveOrdersPage({ activeOrgId }: LiveOrdersPageProps) {
  const [deliveries, setDeliveries] = useState<IDelivery[]>([]);
  const [riders, setRiders] = useState<IRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState<IDelivery | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  const fetchOrdersAndRiders = async () => {
    if (!activeOrgId) return;
    try {
      const [delRes, riderRes] = await Promise.all([
        api.get(`/delivery?orgId=${activeOrgId}`),
        api.get(`/rider/list?orgId=${activeOrgId}`)
      ]);
      setDeliveries(delRes.data);
      setRiders(riderRes.data);
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
        const orderIdShort = data.orderId.substring(18).toUpperCase();
        let statusMsg = data.status;
        if (data.status === 'at_pickup') statusMsg = 'At Store';
        if (data.status === 'picked') statusMsg = 'Picked Up';
        if (data.status === 'delivered') statusMsg = 'Delivered';
        toast.info(`Order #${orderIdShort} status changed to ${statusMsg}`);
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

  const columns = [
    { status: 'unassigned' as const, title: 'Order Created', color: 'text-amber-500', bgColor: 'bg-amber-500/10', borderCls: 'border-amber-500/20' },
    { status: 'pending' as const, title: 'Rider Assigned', color: 'text-blue-500', bgColor: 'bg-blue-500/10', borderCls: 'border-blue-500/20' },
    { status: 'rider_assigned' as const, title: 'Rider Reached Store', color: 'text-purple-500', bgColor: 'bg-purple-500/10', borderCls: 'border-purple-500/20' },
    { status: 'delivered' as const, title: 'Delivered', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', borderCls: 'border-emerald-500/20' }
  ];

  // Helper to map DB statuses to our columns
  const getColumnDeliveries = (colStatus: string) => {
    if (colStatus === 'rider_assigned') {
      return deliveries.filter(d => ['rider_assigned', 'at_pickup', 'picked'].includes(d.status));
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Real-time Operations</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Live view of orders moving through dispatch states.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {columns.map((col) => {
          const colDeliveries = getColumnDeliveries(col.status);
          return (
            <div key={col.status} className="flex flex-col h-[380px] md:h-[520px] lg:h-[600px] bg-secondary/30 border rounded-2xl p-4">
              {/* Column Header */}
              <div className={`flex items-center justify-between mb-4 p-3 rounded-xl ${col.bgColor} border ${col.borderCls}`}>
                <span className={`text-xs font-bold ${col.color} uppercase tracking-wider`}>{col.title}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-background border ${col.color}`}>
                  {colDeliveries.length}
                </span>
              </div>

              {/* Column Cards */}
              <div className={`flex-1 overflow-y-auto space-y-3 pr-1 ${
                (col.status === 'unassigned' || col.status === 'delivered') 
                  ? '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]' 
                  : ''
              }`}>
                {colDeliveries.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <Clock size={28} className="opacity-30" />
                    <span className="text-xs font-bold tracking-wider uppercase">AWAITING STATUS</span>
                  </div>
                ) : (
                  colDeliveries.map((delivery) => {
                    const statusText = delivery.status === 'at_pickup' 
                      ? 'At Store' 
                      : delivery.status === 'picked' 
                        ? 'Parcel In-Transit' 
                        : delivery.status.replace('_', ' ');

                    return (
                      <Card key={delivery._id} className={`select-none shadow-sm border-border ${delivery.slaBreached ? 'border-red-500/50 shadow-red-500/20' : ''}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-[10px] text-primary font-bold uppercase tracking-wider">
                              #{delivery._id.substring(18)}
                            </span>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant="outline" className={`text-[8px] font-bold uppercase tracking-wider ${
                                delivery.status === 'delivered' 
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' 
                                  : delivery.status === 'cancelled' 
                                    ? 'bg-red-500/10 text-red-600 border-red-500/20'
                                    : 'bg-primary/10 text-primary border-primary/20'
                              }`}>
                                {statusText}
                              </Badge>
                              {delivery.slaBreached && (
                                <Badge className="text-[8px] font-bold uppercase tracking-wider bg-red-500 text-white animate-pulse">
                                  SLA Breach
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Customer & Route info */}
                          <div className="space-y-1.5 text-xs text-foreground/80">
                            <div className="flex items-center gap-1.5">
                              <User size={13} className="text-muted-foreground shrink-0" />
                              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Cust:</span>
                              <span className="font-semibold truncate">{delivery.customer?.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pl-[19px]">
                              <Phone size={11} className="shrink-0" />
                              <span>{delivery.customer?.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5 border-t pt-1.5 mt-1.5 text-[11px] text-muted-foreground">
                              <MapPin size={12} className="text-primary shrink-0" />
                              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Drop:</span>
                              <span className="truncate font-medium">{delivery.drop?.label}</span>
                            </div>
                          </div>

                          {/* Assigned Rider Info */}
                          {delivery.ownRiderAssignment?.riderName ? (
                            <div className="bg-secondary/50 border rounded-xl p-2 text-xs flex justify-between items-center">
                              <div className="flex items-center gap-1.5">
                                <Bike size={14} className="text-emerald-600 shrink-0" />
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Rider:</span>
                                <span className="text-foreground font-semibold">{delivery.ownRiderAssignment.riderName}</span>
                              </div>
                              <span className="text-[9px] text-muted-foreground">
                                Try {delivery.ownRiderAssignment.attemptCount}
                              </span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground italic">No rider assigned</div>
                          )}

                          {/* Footer Action buttons */}
                          {delivery.status === 'unassigned' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAssignModal(delivery)}
                              className="w-full text-[10px] font-bold h-8 text-primary border-primary/20 bg-primary/5 hover:bg-primary hover:text-primary-foreground"
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
          onConfirm={handleAssignRider}
        />
      )}
    </div>
  );
}
