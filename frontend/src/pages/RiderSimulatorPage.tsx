import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Bike, ShieldAlert, Check, X, MapPin, Eye, Compass, RefreshCw, ShoppingBag, Plus } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import type { IRider, IDelivery } from '../types';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet's default icon path issues in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createColoredIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-colored-icon',
    html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.5);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
};

const riderIcons: Record<string, L.DivIcon> = {
  idle: createColoredIcon('#94a3b8'), // slate-400
  RIDER_EN_ROUTE_TO_PICKUP: createColoredIcon('#f97316'), // orange-500
  ARRIVED_AT_PICKUP: createColoredIcon('#3b82f6'), // blue-500
  IN_TRIP: createColoredIcon('#10b981'), // emerald-500
};

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  React.useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

// Removed local Haversine in favor of Distance Matrix API

interface RiderSimulatorPageProps {
  activeOrgId: string;
}

export default function RiderSimulatorPage({ activeOrgId }: RiderSimulatorPageProps) {
  const [riders, setRiders] = useState<IRider[]>([]);
  const [deliveries, setDeliveries] = useState<IDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const socketRef = React.useRef<Socket | null>(null);

  // Active toast notification state
  const [incomingOrder, setIncomingOrder] = useState<any | null>(null);

  const [loggedInRiderId, setLoggedInRiderId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // Custom Rider GPS and duty forms state
  const [gpsForm, setGpsForm] = useState<Record<string, { lat: string; lng: string }>>({});
  const [etaData, setEtaData] = useState<Record<string, { dist: string; eta: string }>>({});
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [autoDriveRiderId, setAutoDriveRiderId] = useState<string | null>(null);
  const tickCountRef = React.useRef(0);

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
      
      // Initialize GPS forms only if they don't exist
      setGpsForm(prev => {
        const forms: any = { ...prev };
        riderRes.data.forEach((r: IRider) => {
          if (!forms[r._id]) {
            forms[r._id] = {
              lat: r.lastKnownLocation?.latitude?.toString() || '13.0418',
              lng: r.lastKnownLocation?.longitude?.toString() || '80.2341'
            };
          }
        });
        return forms;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loggedInRiderIdRef = React.useRef(loggedInRiderId);
  useEffect(() => {
    loggedInRiderIdRef.current = loggedInRiderId;
  }, [loggedInRiderId]);

  const deliveriesRef = React.useRef(deliveries);
  useEffect(() => { deliveriesRef.current = deliveries; }, [deliveries]);

  const gpsFormRef = React.useRef(gpsForm);
  useEffect(() => { gpsFormRef.current = gpsForm; }, [gpsForm]);

  useEffect(() => {
    let interval: any;
    if (autoDriveRiderId) {
      interval = setInterval(() => {
        tickCountRef.current += 1;
        
        const coords = gpsFormRef.current[autoDriveRiderId];
        if (!coords) return;
        
        const activeDelivery = deliveriesRef.current.find(d => 
          d.ownRiderAssignment?.riderId?.toString() === autoDriveRiderId.toString() && 
          ['RIDER_EN_ROUTE_TO_PICKUP', 'IN_TRIP'].includes(d.status)
        );
        
        let targetLat: number | null = null;
        let targetLng: number | null = null;
        
        if (activeDelivery) {
           if (activeDelivery.status === 'RIDER_EN_ROUTE_TO_PICKUP') {
             targetLat = activeDelivery.pickup.latitude;
             targetLng = activeDelivery.pickup.longitude;
           } else if (activeDelivery.status === 'IN_TRIP') {
             targetLat = activeDelivery.drop.latitude;
             targetLng = activeDelivery.drop.longitude;
           }
        }
        
        let newLatStr = coords.lat;
        let newLngStr = coords.lng;
        
        if (targetLat !== null && targetLng !== null) {
          const currentLat = parseFloat(coords.lat);
          const currentLng = parseFloat(coords.lng);
          
          // Move ~30 meters per 3 seconds (approx 0.0003 degrees)
          const STEP_DEG = 0.0003;
          const distLat = targetLat - currentLat;
          const distLng = targetLng - currentLng;
          const dist = Math.sqrt(distLat*distLat + distLng*distLng);
          
          if (dist > STEP_DEG) {
            const ratio = STEP_DEG / dist;
            newLatStr = (currentLat + distLat * ratio).toFixed(5);
            newLngStr = (currentLng + distLng * ratio).toFixed(5);
          } else {
            newLatStr = targetLat.toFixed(5);
            newLngStr = targetLng.toFixed(5);
          }
        } else {
           // Fallback default idle movement (Stay still)
           newLatStr = coords.lat;
           newLngStr = coords.lng;
        }
        
        // Update local state and ref immediately
        const nextForm = { ...gpsFormRef.current, [autoDriveRiderId]: { lat: newLatStr, lng: newLngStr } };
        gpsFormRef.current = nextForm;
        setGpsForm(nextForm);
        
        // Trigger Side Effects
        handleUpdateLocation(autoDriveRiderId, parseFloat(newLatStr), parseFloat(newLngStr));
        
        // Fetch ETA via Distance Matrix API on first tick and every 9 seconds (3 ticks)
        if (targetLat !== null && targetLng !== null && (tickCountRef.current === 1 || tickCountRef.current % 3 === 0)) {
           api.get(`/delivery/eta?originLat=${newLatStr}&originLng=${newLngStr}&destLat=${targetLat}&destLng=${targetLng}`)
                .then(res => {
                   setEtaData(prev => ({
                     ...prev,
                     [autoDriveRiderId]: {
                       dist: (res.data.distance_meters / 1000).toFixed(2) + ' km',
                       eta: Math.ceil(res.data.duration_seconds / 60) + ' mins'
                     }
                   }));
                }).catch(err => console.error('[DistanceMatrix]', err));
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoDriveRiderId]);

  useEffect(() => {
    fetchRiders();

    // Setup Socket connection (Force websocket to avoid polling drops and make DevTools tracing easier)
    const newSocket = io('http://localhost:5001', { transports: ['websocket'] });
    socketRef.current = newSocket;
    newSocket.on('connect', () => {
      console.log('[Simulator WebSockets] Connected:', newSocket.id);
      newSocket.emit('join_org', activeOrgId);
    });

    // Handle real-time delivery status updates
    newSocket.on('delivery_status_updated', () => {
      fetchRiders();
    });

    newSocket.on('own_rider_assigned', (data: any) => {
      console.log('[Simulator WebSockets] Received offer:', data);
      
      const currentLoggedInRiderId = loggedInRiderIdRef.current;
      // ONLY trigger if the assigned rider is currently logged in!
      if (currentLoggedInRiderId && data.riderId === currentLoggedInRiderId) {
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
  }, [activeOrgId]);

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



  const handleUpdateLocation = async (riderId: string, directLat?: number, directLng?: number) => {
    const coords = gpsForm[riderId];
    if (!coords && directLat === undefined) return;

    try {
      const lat = directLat ?? parseFloat(coords.lat);
      const lng = directLng ?? parseFloat(coords.lng);
      
      // Find the active delivery for this rider to get the tripId
      const activeTrip = deliveriesRef.current.find(d => 
        d.ownRiderAssignment?.riderId?.toString() === riderId.toString() && 
        ['ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRIP'].includes(d.status)
      );

      // Emit to WebSocket for Live Tracking and Geo triggers IMMEDIATELY
      if (socketRef.current) {
        console.log('[Simulator] Emitting rider:location:', { riderId, lat, lng, tripId: activeTrip?._id });
        socketRef.current.emit('rider:location', {
          riderId,
          lat,
          lng,
          heading: 0,
          speed: 15,
          tripId: activeTrip?._id
        });
      }

      // Update Database
      await api.post('/rider/app/location', {
        riderId,
        latitude: lat,
        longitude: lng
      });

      fetchRiders();
      if (directLat === undefined) {
        alert('Location updated successfully!');
      }
    } catch (err) {
      console.error(err);
      if (directLat === undefined) alert('Failed to update location');
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
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => handleUpdateLocation(r._id)}
                className="flex-1 font-bold"
              >
                Update GPS manually
              </Button>
              <Button
                variant={autoDriveRiderId === r._id ? "default" : "outline"}
                onClick={() => setAutoDriveRiderId(autoDriveRiderId === r._id ? null : r._id)}
                className={`font-bold ${autoDriveRiderId === r._id ? 'bg-blue-600 hover:bg-blue-700 text-white animate-pulse' : ''}`}
              >
                {autoDriveRiderId === r._id ? 'Stop Live Tracking' : 'Start Live Tracking'}
              </Button>
            </div>
            
            {/* Embedded Live Map */}
            <div className="mt-4 rounded-xl overflow-hidden border shadow-sm relative z-0 h-[200px]">
              {(() => {
                const activeDelivery = deliveries.find(d => 
                  d.ownRiderAssignment?.riderId?.toString() === r._id.toString() && 
                  ['ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRIP'].includes(d.status)
                );
                const currentStatus = activeDelivery?.status || 'idle';
                const iconToUse = riderIcons[currentStatus] || riderIcons.idle;
                const centerLat = parseFloat(gps.lat) || 13.0418;
                const centerLng = parseFloat(gps.lng) || 80.2341;
                
                let targetLat: number | null = null;
                let targetLng: number | null = null;
                if (currentStatus === 'RIDER_EN_ROUTE_TO_PICKUP' && activeDelivery) {
                   targetLat = activeDelivery.pickup.latitude;
                   targetLng = activeDelivery.pickup.longitude;
                } else if (currentStatus === 'IN_TRIP' && activeDelivery) {
                   targetLat = activeDelivery.drop.latitude;
                   targetLng = activeDelivery.drop.longitude;
                }
                
                let distStr = '--';
                let etaStr = '--';
                if (targetLat !== null && targetLng !== null) {
                   const etaInfo = etaData[r._id];
                   if (etaInfo) {
                     distStr = etaInfo.dist;
                     etaStr = etaInfo.eta;
                   } else {
                     distStr = 'Calc...';
                     etaStr = 'Calc...';
                   }
                }
                
                return (
                  <div className="relative w-full h-full">
                    <MapContainer 
                      center={[centerLat, centerLng]} 
                      zoom={15} 
                      scrollWheelZoom={false} 
                      style={{ height: '100%', width: '100%', zIndex: 0 }}
                      zoomControl={false}
                    >
                      <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapUpdater center={[centerLat, centerLng]} />
                      <Marker position={[centerLat, centerLng]} icon={iconToUse} />
                    </MapContainer>
                    
                    {/* Overlay ETA Box (always visible) */}
                    {(targetLat !== null && targetLng !== null) && (
                       <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-xl shadow-lg border border-primary/20 z-[1000] text-center min-w-[180px]">
                          <div className="font-extrabold text-[10px] text-primary uppercase tracking-widest mb-1.5">
                            {currentStatus === 'RIDER_EN_ROUTE_TO_PICKUP' ? 'HEADING TO STORE' : 'HEADING TO CUSTOMER'}
                          </div>
                          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                            <span className="flex-1">{distStr}</span>
                            <span className="text-slate-300 mx-2">•</span>
                            <span className="flex-1 text-emerald-600">{etaStr}</span>
                          </div>
                       </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Active Jobs Journey */}
          {(() => {
            const riderActiveDeliveries = deliveries.filter(d => 
              d.ownRiderAssignment?.riderId?.toString() === r._id.toString() && 
              ['ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRIP'].includes(d.status)
            );

            if (riderActiveDeliveries.length === 0) return null;

            return (
              <div className="border-t pt-5 space-y-4">
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Active Jobs Journey</div>
                <div className="space-y-3">
                  {riderActiveDeliveries.map(d => {
                    if (d.status === 'ASSIGNED') {
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
                    if (d.status === 'RIDER_EN_ROUTE_TO_PICKUP') {
                      btnText = 'Reached Store';
                      nextStatus = 'at_pickup';
                    } else if (d.status === 'ARRIVED_AT_PICKUP') {
                      btnText = 'Pick Package';
                      nextStatus = 'picked';
                    } else if (d.status === 'IN_TRIP') {
                      btnText = 'Mark Delivered';
                      nextStatus = 'delivered';
                    }

                    return (
                      <div key={d._id} className="p-3.5 rounded-xl bg-secondary/50 border space-y-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-mono text-primary font-bold">#{d._id.substring(18).toUpperCase()}</span>
                          <span className="capitalize font-bold text-muted-foreground">
                            {d.status === 'RIDER_EN_ROUTE_TO_PICKUP' ? 'Rider Assigned' : d.status === 'ARRIVED_AT_PICKUP' ? 'At Store' : 'In Transit'}
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
                    ['COMPLETED', 'CANCELLED'].includes(d.status)
                  );
                  if (pastDeliveries.length === 0) {
                    return <div className="text-center text-sm text-muted-foreground py-4">No past deliveries found.</div>;
                  }
                  return pastDeliveries.map(d => (
                    <div key={d._id} className="p-3 rounded-lg bg-secondary/30 border text-sm flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold text-foreground">#{d._id.substring(18).toUpperCase()}</span>
                        <span className={`font-semibold capitalize ${d.status === 'COMPLETED' ? 'text-emerald-500' : 'text-red-500'}`}>
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
