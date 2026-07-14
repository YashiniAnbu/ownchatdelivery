import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { PlusCircle, ShoppingBag, MapPin, Phone, User, RefreshCw, Trash2 } from 'lucide-react';
import type { IDelivery } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface CreateOrderPageProps {
  activeOrgId: string;
}

export default function CreateOrderPage({ activeOrgId }: CreateOrderPageProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupLabel, setPickupLabel] = useState('Zafran Biryani House');
  const [dropLabel, setDropLabel] = useState('');
  const [pickupLat, setPickupLat] = useState('');
  const [pickupLng, setPickupLng] = useState('');
  const [dropLat, setDropLat] = useState('');
  const [dropLng, setDropLng] = useState('');
  const [cost, setCost] = useState('45');
  const [loading, setLoading] = useState(false);
  const [resolveMessage, setResolveMessage] = useState('');

  const [unassignedDeliveries, setUnassignedDeliveries] = useState<IDelivery[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);

  const fetchUnassignedDeliveries = async () => {
    if (!activeOrgId) return;
    try {
      const res = await api.get(`/delivery/${activeOrgId}/unassigned`);
      setUnassignedDeliveries(res.data.deliveries || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFeedLoading(false);
    }
  };

  const randomizeCoordinates = () => {
    // No longer needed
  };

  useEffect(() => {
    fetchUnassignedDeliveries();
    randomizeCoordinates();
    const interval = setInterval(fetchUnassignedDeliveries, 5000);
    return () => clearInterval(interval);
  }, [activeOrgId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !customerPhone || !dropLabel || !activeOrgId) return;

    if (customerPhone.length !== 10) {
      alert('Mobile number must be exactly 10 digits.');
      return;
    }

    if (parseFloat(cost) > 99999 || parseFloat(cost) < 0) {
      alert('Order Cost must be a positive amount with at most 5 digits (maximum ₹99,999).');
      return;
    }

    setLoading(true);
    setResolveMessage('Resolving pickup location...');
    try {
      // 1. Resolve Pickup Address
      const pickupRes = await api.post('/trips/resolve-location', { address: pickupLabel });
      const { lat: pLat, lng: pLng, formatted_address: pFormatted } = pickupRes.data;

      setResolveMessage('Resolving drop location...');
      // 2. Resolve Drop Address
      const dropRes = await api.post('/trips/resolve-location', { address: dropLabel });
      const { lat: dLat, lng: dLng, formatted_address: dFormatted } = dropRes.data;

      setResolveMessage('Creating order...');
      // 3. Create Delivery with resolved coordinates
      await api.post('/trips', {
        ownchatOrgId: activeOrgId,
        provider: 'own_rider',
        customer: { name: customerName, phone: customerPhone },
        pickup: {
          label: pickupLabel,
          latitude: pLat,
          longitude: pLng,
          formatted_address: pFormatted
        },
        drop: {
          label: dropLabel,
          latitude: dLat,
          longitude: dLng,
          formatted_address: dFormatted
        },
        cost: parseFloat(cost)
      });
      setCustomerName('');
      setCustomerPhone('');
      setDropLabel('');
      setCost('45');
      setResolveMessage('');
      fetchUnassignedDeliveries();
    } catch (err: any) {
      console.error(err);
      alert('Failed to create order: ' + (err.response?.data?.error || err.message));
      setResolveMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async (deliveryId: string) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return;
    try {
      await api.post('/delivery/cancel', { deliveryId });
      fetchUnassignedDeliveries();
    } catch (err) {
      console.error(err);
      alert('Failed to cancel order');
    }
  };

  const labelCls = "text-xs font-bold text-muted-foreground uppercase tracking-widest";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Creation form */}
      <div className="lg:col-span-1 space-y-6">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">New Delivery Request</h3>
          <p className="text-sm text-slate-500 mt-0.5">Specify pickup and drop-off instructions.</p>
        </div>

        <Card className="shadow-sm border-primary/20">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className={labelCls}>Customer Name <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Jane Doe"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="pl-9 h-10 font-medium"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>Customer Phone <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    required
                    placeholder="e.g. 9876501234"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="pl-9 h-10 font-medium"
                    maxLength={10}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>Pickup Location Address <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Zafran Biryani House"
                    value={pickupLabel}
                    onChange={(e) => setPickupLabel(e.target.value)}
                    className="pl-9 h-10 font-medium"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>Drop Destination <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Nungambakkam High Road"
                    value={dropLabel}
                    onChange={(e) => setDropLabel(e.target.value)}
                    className="pl-9 h-10 font-medium"
                  />
                </div>
              </div>

              {resolveMessage && (
                <div className="text-sm font-semibold text-blue-600 animate-pulse mt-2">
                  {resolveMessage}
                </div>
              )}

              <div className="space-y-1.5 pt-2">
                <Label className={labelCls}>Order Cost (₹) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  required
                  value={cost}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.length <= 5) setCost(val);
                  }}
                  className="font-mono h-10"
                  max={99999}
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 font-bold mt-4"
              >
                {loading ? 'Creating...' : 'Create Order'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Unassigned Feed */}
      <div className="lg:col-span-2 space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Unassigned Feed</h3>
            <p className="text-sm text-slate-500 mt-0.5">Orders awaiting rider allocation or auto-matching.</p>
          </div>
        </div>

        {feedLoading ? (
          <div className="py-24 flex justify-center items-center">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : unassignedDeliveries.length === 0 ? (
          <div className="py-24 card-glow bg-white flex flex-col justify-center items-center text-slate-400 gap-2">
            <ShoppingBag size={32} className="opacity-30" />
            <span className="text-xs font-bold uppercase tracking-wider">No pending orders in the pool</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {unassignedDeliveries.map((delivery) => (
              <Card key={delivery._id} className="relative group shadow-sm border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-[10px] text-primary font-bold uppercase tracking-wider">
                      #{delivery._id.substring(18)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(delivery.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="text-xs text-foreground font-semibold">
                    {delivery.pickup?.label} ➔ {delivery.drop?.label}
                  </div>

                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <div>Customer: <span className="font-semibold text-foreground">{delivery.customer?.name}</span></div>
                    <div>Phone: <span className="font-semibold text-foreground">{delivery.customer?.phone}</span></div>
                  </div>

                  <div className="flex justify-between items-center border-t pt-3 mt-3">
                    <span className="text-xs font-bold text-emerald-600">₹{delivery.cost?.toFixed(2)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelOrder(delivery._id)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                      title="Cancel Order"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
