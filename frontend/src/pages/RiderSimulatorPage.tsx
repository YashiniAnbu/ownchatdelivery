import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Bike, ShieldAlert, Check, X, MapPin, Eye, Compass, RefreshCw, ShoppingBag, Plus } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import type { IRider, IDelivery } from '../types';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RiderSimulatorPageProps {
  activeOrgId: string;
}

export default function RiderSimulatorPage({ activeOrgId }: RiderSimulatorPageProps) {
  const [riders, setRiders] = useState<IRider[]>([]);
  const [deliveries, setDeliveries] = useState<IDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  // Active toast notification state
  const [incomingOrder, setIncomingOrder] = useState<any | null>(null);

  const [loggedInRiderId, setLoggedInRiderId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // Custom Rider GPS and duty forms state
  const [gpsForm, setGpsForm] = useState<Record<string, { lat: string; lng: string }>>({});
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});

  // Request Notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  const fetchRiders = async () => {
    if (!activeOrgId) return;
    try {
      const [riderRes, deliveryRes] = await Promise.all([
        api.get(`/rider/list?orgId=${activeOrgId}`),
        api.get(`/delivery?orgId=${activeOrgId}`)
      ]);
      setRiders(riderRes.data);
      setDeliveries(deliveryRes.data);
      
      // Initialize GPS forms
      const forms: any = {};
      riderRes.data.forEach((r: IRider) => {
        forms[r._id] = {
          lat: r.lastKnownLocation?.latitude?.toString() || '13.0418',
          lng: r.lastKnownLocation?.longitude?.toString() || '80.2341'
        };
      });
      setGpsForm(forms);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiders();

    // Setup Socket connection
    const newSocket = io('http://localhost:5001');
    newSocket.on('connect', () => {
      console.log('[Simulator WebSockets] Connected:', newSocket.id);
      newSocket.emit('join_org', activeOrgId);
    });

    // Handle real-time delivery status updates
    newSocket.on('delivery_status_updated', () => {
      fetchRiders();
    });

    return () => {
      newSocket.disconnect();
    };
  }, [activeOrgId]);

  // We use a separate useEffect for the socket listener that depends on loggedInRiderId
  // so that the notification only fires if it's FOR the logged-in rider.
  useEffect(() => {
    const newSocket = io('http://localhost:5001');
    newSocket.on('connect', () => {
      newSocket.emit('join_org', activeOrgId);
    });

    newSocket.on('own_rider_assigned', (data: any) => {
      console.log('[Simulator WebSockets] Received offer:', data);
      
      // ONLY trigger if the assigned rider is currently logged in!
      if (loggedInRiderId && data.riderId === loggedInRiderId) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`New Order for ${data.riderName}`, {
            body: `Order #${data.orderId.substring(18)} assigned via ${data.strategy}.`,
            icon: '/favicon.ico'
          });
        }
        
        setIncomingOrder({
          orderId: data.orderId,
          riderId: data.riderId,
          riderName: data.riderName,
          timeoutSeconds: data.timeoutSeconds || 120
        });
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [activeOrgId, loggedInRiderId]);

  const handleToggleDuty = async (riderId: string, currentDuty: boolean) => {
    try {
      await api.post('/rider/app/duty', {
        riderId,
        isOnDuty: !currentDuty
      });
      fetchRiders();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to toggle duty');
    }
  };

  const handleToggleBreak = async (riderId: string, currentAvailable: boolean) => {
    try {
      await api.post('/rider/app/break', {
        riderId,
        isAvailable: !currentAvailable
      });
      fetchRiders();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to toggle break');
    }
  };

  const handleUpdateLocation = async (riderId: string) => {
    const coords = gpsForm[riderId];
    if (!coords) return;

    try {
      await api.post('/rider/app/location', {
        riderId,
        latitude: parseFloat(coords.lat),
        longitude: parseFloat(coords.lng)
      });
      fetchRiders();
      alert('Location updated successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to update location');
    }
  };

  const handleAcceptOrder = async () => {
    if (!incomingOrder) return;
    try {
      await api.post('/rider/app/status', {
        deliveryId: incomingOrder.orderId,
        riderId: incomingOrder.riderId,
        status: 'accepted'
      });
      setIncomingOrder(null);
      fetchRiders();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRejectOrder = async () => {
    if (!incomingOrder) return;
    try {
      await api.post('/rider/app/status', {
        deliveryId: incomingOrder.orderId,
        riderId: incomingOrder.riderId,
        status: 'rejected'
      });
      setIncomingOrder(null);
      fetchRiders();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateDeliveryStatus = async (riderId: string, deliveryId: string, nextStatus: string) => {
    try {
      await api.post('/rider/app/status', {
        deliveryId,
        riderId,
        status: nextStatus
      });
      fetchRiders();
    } catch (err) {
      console.error(err);
      alert('Failed to update delivery status');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const form = e.target as HTMLFormElement;
    const phone = (form.elements.namedItem('phone') as HTMLSelectElement).value;
    
    if (!phone || !pin) {
      setLoginError('Please select a rider and enter PIN');
      return;
    }

    try {
      const res = await api.post('/rider/app/login', { phone, pin });
      setLoggedInRiderId(res.data.rider._id);
      setPin('');
    } catch (err: any) {
      setLoginError(err.response?.data?.error || 'Invalid credentials');
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm">Initiating device simulations...</span>
      </div>
    );
  }

  // If no rider is logged in, show the login view
  if (!loggedInRiderId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md shadow-2xl border-primary/20 bg-gradient-to-br from-background via-background to-secondary/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-secondary/20 rounded-full blur-3xl pointer-events-none" />
          <CardHeader className="text-center space-y-2 relative z-10">
            <div className="w-12 h-12 mx-auto bg-primary/10 text-primary flex items-center justify-center rounded-full mb-2">
              <Bike size={24} />
            </div>
            <CardTitle className="text-2xl">Rider Login</CardTitle>
            <p className="text-sm text-muted-foreground">Select a persona to simulate</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                  <ShieldAlert size={16} />
                  {loginError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="phone">Rider Persona</Label>
                <select 
                  id="phone" 
                  name="phone"
                  className="w-full h-10 px-3 py-2 rounded-md border bg-background text-sm"
                >
                  <option value="">-- Select Rider --</option>
                  {riders.map(r => (
                    <option key={r._id} value={r.phone}>{r.name} ({r.phone})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">PIN (Default: 1234, Rajan: 1111, Priya: 5555)</Label>
                <Input 
                  id="pin" 
                  type="password" 
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter 4 digit PIN"
                  maxLength={4}
                />
              </div>
              <Button type="submit" className="w-full h-10 mt-2">
                Sign In to App
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get the logged in rider
  const r = riders.find(rider => rider._id === loggedInRiderId);
  if (!r) {
    setLoggedInRiderId(null);
    return null;
  }

  const gps = gpsForm[r._id] || { lat: '', lng: '' };

  return (
    <div className="space-y-6 relative flex flex-col items-center">
      {/* Title & Logout */}
      <div className="w-full max-w-md flex justify-between items-center">
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rider Companion App</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Logged in as {r.name}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoggedInRiderId(null); setIncomingOrder(null); }}>
          Log Out
        </Button>
      </div>

      {/* Single Device View */}
      <Card className="w-full max-w-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] border-primary/30 bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[50px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-secondary/20 rounded-full blur-[50px] pointer-events-none" />
        
        <CardContent className="p-6 space-y-6 relative z-10">
          {/* Header */}
          <div className="flex justify-between items-start border-b pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Bike size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{r.name}</h4>
                <div className="flex flex-col text-xs text-muted-foreground">
                  <span>{r.phone}</span>
                  <span className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} /> 
                    {r.lastKnownLocation?.latitude?.toFixed(4) || 'N/A'}, {r.lastKnownLocation?.longitude?.toFixed(4) || 'N/A'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleDuty(r._id, r.isOnDuty)}
                className={`text-xs font-bold uppercase tracking-wider h-8 px-3 ${
                  r.isOnDuty
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-700'
                    : 'bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/20 hover:text-red-700'
                }`}
              >
                {r.isOnDuty ? 'On Duty' : 'Off Duty'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleBreak(r._id, r.isAvailable)}
                className={`text-xs font-bold uppercase tracking-wider h-8 px-3 ${
                  !r.isAvailable && r.stats.activeDeliveries === 0
                    ? 'bg-orange-500/10 text-orange-600 border-orange-500/20 hover:bg-orange-500/20 hover:text-orange-700'
                    : 'bg-slate-500/10 text-slate-600 border-slate-500/20 hover:bg-slate-500/20 hover:text-slate-700'
                }`}
                disabled={!r.isOnDuty || (r.isAvailable === false && r.stats.activeDeliveries > 0)}
              >
                {!r.isAvailable && r.stats.activeDeliveries === 0 ? 'End Break' : 'Take Break'}
              </Button>
            </div>
          </div>

          {/* Status details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-foreground/80">
            <div className="space-y-1">
              <span className="text-muted-foreground font-semibold block text-[10px] uppercase">Availability</span>
              <div className="font-bold flex items-center gap-1.5 text-xs">
                <span className={`w-2 h-2 rounded-full ${r.isAvailable && r.isOnDuty ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span>{r.isAvailable && r.isOnDuty ? 'Avail' : 'Offline'}</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground font-semibold block text-[10px] uppercase">Active Cargo</span>
              <span className="font-bold text-xs">{r.stats?.activeDeliveries || 0} orders</span>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground font-semibold block text-[10px] uppercase">Total Dels</span>
              <span className="font-bold text-xs">{r.stats?.totalDeliveries || 0} lifetime</span>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground font-semibold block text-[10px] uppercase">Distance</span>
              <span className="font-bold text-xs">{(r.stats as any)?.totalKilometers || 0} km</span>
            </div>
          </div>

          {/* GPS coordinates controls */}
          <div className="border-t pt-5 space-y-4">
            <div className="flex items-center gap-2 font-bold uppercase text-xs tracking-wider text-muted-foreground">
              <Compass size={14} className="text-primary" />
              <span>GPS location simulator</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Latitude</Label>
                <Input
                  type="text"
                  value={gps.lat}
                  onChange={(e) => setGpsForm({ ...gpsForm, [r._id]: { ...gps, lat: e.target.value } })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Longitude</Label>
                <Input
                  type="text"
                  value={gps.lng}
                  onChange={(e) => setGpsForm({ ...gpsForm, [r._id]: { ...gps, lng: e.target.value } })}
                  className="font-mono"
                />
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => handleUpdateLocation(r._id)}
              className="w-full font-bold"
            >
              Update GPS Coordinates
            </Button>
          </div>

          {/* Active Jobs Journey */}
          {(() => {
            const riderActiveDeliveries = deliveries.filter(d => 
              d.ownRiderAssignment?.riderId?.toString() === r._id.toString() && 
              ['pending', 'rider_assigned', 'at_pickup', 'picked'].includes(d.status)
            );

            if (riderActiveDeliveries.length === 0) return null;

            return (
              <div className="border-t pt-5 space-y-4">
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Active Jobs Journey</div>
                <div className="space-y-3">
                  {riderActiveDeliveries.map(d => {
                    if (d.status === 'pending') {
                      return (
                        <div key={d._id} className="p-3.5 rounded-xl bg-secondary/50 border space-y-3">
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-mono text-primary font-bold">#{d._id.substring(18).toUpperCase()}</span>
                            <span className="capitalize font-bold text-amber-500">Offer Pending</span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <div className="flex items-center gap-1"><MapPin size={12} className="text-emerald-500" /> Pickup: {d.pickup?.latitude?.toFixed(4)}, {d.pickup?.longitude?.toFixed(4)}</div>
                            <div className="flex items-center gap-1"><MapPin size={12} className="text-red-500" /> Drop: {d.drop?.latitude?.toFixed(4)}, {d.drop?.longitude?.toFixed(4)}</div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleUpdateDeliveryStatus(r._id, d._id, 'accepted')}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                            >
                              Accept
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => handleUpdateDeliveryStatus(r._id, d._id, 'rejected')}
                              className="flex-1 font-bold"
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    let btnText = '';
                    let nextStatus = '';
                    if (d.status === 'rider_assigned') {
                      btnText = 'Reached Store';
                      nextStatus = 'at_pickup';
                    } else if (d.status === 'at_pickup') {
                      btnText = 'Pick Package';
                      nextStatus = 'picked';
                    } else if (d.status === 'picked') {
                      btnText = 'Mark Delivered';
                      nextStatus = 'delivered';
                    }

                    return (
                      <div key={d._id} className="p-3.5 rounded-xl bg-secondary/50 border space-y-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-mono text-primary font-bold">#{d._id.substring(18).toUpperCase()}</span>
                          <span className="capitalize font-bold text-muted-foreground">
                            {d.status === 'rider_assigned' ? 'Rider Assigned' : d.status === 'at_pickup' ? 'At Store' : 'In Transit'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1 pb-2">
                          <div className="flex items-center gap-1"><MapPin size={12} className="text-emerald-500" /> Pickup: {d.pickup?.latitude?.toFixed(4)}, {d.pickup?.longitude?.toFixed(4)}</div>
                          <div className="flex items-center gap-1"><MapPin size={12} className="text-red-500" /> Drop: {d.drop?.latitude?.toFixed(4)}, {d.drop?.longitude?.toFixed(4)}</div>
                        </div>
                        <Button
                          onClick={() => handleUpdateDeliveryStatus(r._id, d._id, nextStatus)}
                          className="w-full font-bold"
                        >
                          {btnText}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* History Section */}
          <div className="border-t pt-5 space-y-4">
            <Button
              variant="outline"
              className="w-full font-bold"
              onClick={() => setShowHistory({ ...showHistory, [r._id]: !showHistory[r._id] })}
            >
              {showHistory[r._id] ? 'Hide Past Deliveries' : 'View Past Deliveries'}
            </Button>
            
            {showHistory[r._id] && (
              <div className="space-y-2 mt-3 max-h-60 overflow-y-auto pr-2">
                {(() => {
                  const pastDeliveries = deliveries.filter(d => 
                    d.ownRiderAssignment?.riderId?.toString() === r._id.toString() && 
                    ['delivered', 'cancelled', 'picked'].includes(d.status)
                  );
                  if (pastDeliveries.length === 0) {
                    return <div className="text-center text-sm text-muted-foreground py-4">No past deliveries found.</div>;
                  }
                  return pastDeliveries.map(d => (
                    <div key={d._id} className="p-3 rounded-lg bg-secondary/30 border text-sm flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold text-foreground">#{d._id.substring(18).toUpperCase()}</span>
                        <span className={`font-semibold capitalize ${d.status === 'delivered' ? 'text-emerald-500' : 'text-red-500'}`}>
                          {d.status}
                        </span>
                      </div>
                      {d.milestones?.deliveredAt && (
                        <div className="text-xs text-muted-foreground">
                          Delivered: {new Date(d.milestones.deliveredAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Floating Push Offer Notification Toast */}
      {incomingOrder && (
        <Card className="fixed bottom-6 right-6 w-96 border-primary shadow-2xl z-50 animate-bounce">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                <Bike size={24} />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <h4 className="text-sm font-bold text-foreground">🚴 New Order Assigned</h4>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">Offered to: {incomingOrder.riderName}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-normal">
                  Order <span className="font-mono text-primary font-bold">#{incomingOrder.orderId.substring(18)}</span> is matching your route. Please accept or reject within {incomingOrder.timeoutSeconds}s.
                </p>
                <div className="flex gap-2 pt-1.5">
                  <Button
                    size="sm"
                    onClick={handleAcceptOrder}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                  >
                    <Check size={14} />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleRejectOrder}
                    className="flex-1 gap-1"
                  >
                    <X size={14} />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
