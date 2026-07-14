import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../utils/api';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Bike, MapPin, Clock, Package } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";

// Fix Leaflet's default icon path issues in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const riderIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/1986/1986966.png', // Delivery bike icon
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

export default function CustomerTrackingPage() {
  const { orderId } = useParams();
  const [delivery, setDelivery] = useState<any>(null);
  const [riderLocation, setRiderLocation] = useState<{lat: number, lng: number} | null>(null);
  const [eta, setEta] = useState<{ duration_seconds: number, distance_meters: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;

    // Initial Fetch
    api.get(`/delivery/${orderId}`).then(res => {
      setDelivery(res.data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });

    // WebSocket Connection
    const socket = io('http://localhost:5001');
    
    socket.on('connect', () => {
      console.log('[Tracking] Connected to socket');
      socket.emit('join_trip', orderId);
    });

    socket.on('location:update', (data) => {
      console.log('Location Update:', data);
      setRiderLocation({ lat: data.lat, lng: data.lng });
    });

    socket.on('eta:update', (data) => {
      setEta({
        duration_seconds: data.duration_seconds,
        distance_meters: data.distance_meters
      });
    });

    socket.on('trip:status', (data) => {
      setDelivery((prev: any) => ({ ...prev, status: data.status }));
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-secondary/20">Loading order details...</div>;
  }

  if (!delivery) {
    return <div className="min-h-screen flex items-center justify-center bg-secondary/20">Order not found.</div>;
  }

  const pickupPos = [delivery.pickup.latitude, delivery.pickup.longitude] as [number, number];
  const dropPos = [delivery.drop.latitude, delivery.drop.longitude] as [number, number];
  
  // Decide which path to show based on status
  const polylinePositions = (delivery.status === 'RIDER_EN_ROUTE_TO_PICKUP') 
    ? (riderLocation ? [[riderLocation.lat, riderLocation.lng] as [number, number], pickupPos] : [pickupPos])
    : (riderLocation ? [[riderLocation.lat, riderLocation.lng] as [number, number], dropPos] : [pickupPos, dropPos]);

  return (
    <div className="min-h-screen flex flex-col bg-secondary/20 font-sans">
      <div className="bg-primary text-primary-foreground p-4 text-center shadow-md">
        <h1 className="text-xl font-bold tracking-tight">Live Tracking</h1>
        <p className="text-sm opacity-80">Order #{delivery._id.substring(18).toUpperCase()}</p>
      </div>

      <div className="flex-1 relative">
        <MapContainer 
          center={riderLocation ? [riderLocation.lat, riderLocation.lng] : dropPos} 
          zoom={14} 
          scrollWheelZoom={true} 
          className="h-full w-full absolute inset-0 z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={pickupPos}>
            <Popup>Pickup: {delivery.pickup.label}</Popup>
          </Marker>
          <Marker position={dropPos}>
            <Popup>Drop: {delivery.drop.label}</Popup>
          </Marker>
          
          {riderLocation && (
            <Marker position={[riderLocation.lat, riderLocation.lng]} icon={riderIcon}>
              <Popup>Your Rider is here</Popup>
            </Marker>
          )}

          <Polyline positions={polylinePositions} color="#3b82f6" weight={4} dashArray="5, 10" />
        </MapContainer>

        {/* Overlay Info Card */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-10">
          <Card className="shadow-2xl border-0 overflow-hidden backdrop-blur-xl bg-background/90">
            <CardContent className="p-5 space-y-4">
              
              <div className="flex items-center justify-between border-b border-border/50 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Package size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</p>
                    <p className="font-semibold text-sm capitalize">{delivery.status.replace(/_/g, ' ')}</p>
                  </div>
                </div>
              </div>

              {['RIDER_EN_ROUTE_TO_PICKUP', 'IN_TRIP'].includes(delivery.status) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-secondary/50 rounded-xl p-3 flex flex-col items-center justify-center text-center">
                    <Clock size={20} className="text-blue-500 mb-1" />
                    <p className="text-xs text-muted-foreground">Est. Arrival</p>
                    <p className="font-bold text-lg">
                      {eta ? `${Math.ceil(eta.duration_seconds / 60)} min` : 'Calculating...'}
                    </p>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3 flex flex-col items-center justify-center text-center">
                    <MapPin size={20} className="text-emerald-500 mb-1" />
                    <p className="text-xs text-muted-foreground">Distance</p>
                    <p className="font-bold text-lg">
                      {eta ? `${(eta.distance_meters / 1000).toFixed(1)} km` : '...'}
                    </p>
                  </div>
                </div>
              )}

              {delivery.ownRiderAssignment?.riderName && (
                <div className="flex items-center gap-3 bg-secondary/30 p-3 rounded-lg border">
                  <Bike size={18} className="text-primary" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Rider Assigned</p>
                    <p className="font-semibold text-sm">{delivery.ownRiderAssignment.riderName}</p>
                  </div>
                </div>
              )}

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
