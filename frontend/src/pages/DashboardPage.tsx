import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';
import {
  TrendingUp,
  MapPin,
  Wallet,
  Timer,
  RefreshCw,
  Award,
  Bike
} from 'lucide-react';
import type { IDelivery, IRider } from '../types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface DashboardStats {
  totalOrders: number;
  avgRadius: number;
  totalSpend: number;
  avgValue: number;
  avgDeliveryMin: number;
  timeline?: {
    avgCreateToAssignMin: number;
    avgAssignToPickupMin: number;
    avgPickupToPickedMin: number;
    avgPickedToDeliveredMin: number;
  };
  hourlyDistribution?: { hour: string; orders: number }[];
  topLocations?: { name: string; orders: number }[];
}

interface DashboardPageProps {
  activeOrgId: string;
}

export default function DashboardPage({ activeOrgId }: DashboardPageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [riders, setRiders] = useState<IRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [timelineData, setTimelineData] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    if (!activeOrgId) return;
    try {
      const statsRes = await api.get(`/org/${activeOrgId}/dashboard-stats`);
      setStats(statsRes.data);
      if (statsRes.data.hourlyDistribution) {
        setTimelineData(statsRes.data.hourlyDistribution);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRiders = async () => {
    if (!activeOrgId) return;
    try {
      const res = await api.get(`/rider/list?orgId=${activeOrgId}`);
      setRiders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchRiders();
    const interval = setInterval(() => {
      fetchRiders();
    }, 5000); // Polling for real-time rider status
    return () => clearInterval(interval);
  }, [activeOrgId]);

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm">Calculating metrics...</span>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Orders', value: stats?.totalOrders || 0, icon: TrendingUp, color: 'text-blue-600', bgColor: 'bg-blue-50' },
    { label: 'Avg Radius (km)', value: stats?.avgRadius ? `${stats.avgRadius.toFixed(1)} km` : '0.0 km', icon: MapPin, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    { label: 'Total Spend (₹)', value: stats?.totalSpend ? `₹${stats.totalSpend.toLocaleString()}` : '₹0', icon: Wallet, color: 'text-amber-600', bgColor: 'bg-amber-50' },
    { label: 'Avg Value (₹)', value: stats?.avgValue ? `₹${stats.avgValue.toFixed(0)}` : '₹0', icon: Award, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { label: 'Avg Delivery Time', value: stats?.avgDeliveryMin ? `${stats.avgDeliveryMin.toFixed(0)} min` : '25 min', icon: Timer, color: 'text-rose-600', bgColor: 'bg-rose-50' }
  ];

  const stepperItems = [
    { 
      step: 'Rider Assigned', 
      time: stats?.timeline?.avgCreateToAssignMin 
        ? `${stats.timeline.avgCreateToAssignMin.toFixed(1)} min` 
        : '2.0 min', 
      desc: 'Auto-matching & Accept' 
    },
    { 
      step: 'Reached Store', 
      time: stats?.timeline?.avgAssignToPickupMin 
        ? `${stats.timeline.avgAssignToPickupMin.toFixed(1)} min` 
        : '6.0 min', 
      desc: 'Transit to Pickup' 
    },
    { 
      step: 'Wait Time', 
      time: stats?.timeline?.avgPickupToPickedMin 
        ? `${stats.timeline.avgPickupToPickedMin.toFixed(1)} min` 
        : '5.0 min', 
      desc: 'Food Preparation' 
    },
    { 
      step: 'Delivered', 
      time: stats?.timeline?.avgPickedToDeliveredMin 
        ? `${stats.timeline.avgPickedToDeliveredMin.toFixed(1)} min` 
        : '12.0 min', 
      desc: 'Transit to Destination' 
    }
  ];

  const topLocations = stats?.topLocations ?? [];

  // Calculate Rider Breakdown
  let activeTask = 0;
  let available = 0;
  let onBreak = 0;
  let offDuty = 0;
  let inactive = 0;

  riders.forEach(r => {
    if (!r.isActive) {
      inactive++;
    } else if (r.isOnDuty) {
      if (!r.isAvailable) {
        if (r.stats?.activeDeliveries === 0) {
          onBreak++;
        } else {
          activeTask++;
        }
      } else if (r.stats?.activeDeliveries > 0) {
        activeTask++;
      } else {
        available++;
      }
    } else {
      offDuty++;
    }
  });

  return (
    <div className="space-y-8">
      {/* Title */}
      <div>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Performance Insights</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Aggregated logistics and dispatch timeline stats.</p>
      </div>

      {/* Live Rider Fleet Status */}
      <Card className="shadow-sm border-slate-100 bg-white">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <Bike size={14} className="text-primary" />
            Live Rider Fleet Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-amber-50 border border-amber-100">
              <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Active / On Task</div>
              <div className="text-2xl font-black text-amber-700">{activeTask}</div>
            </div>
            <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">On Duty / Available</div>
              <div className="text-2xl font-black text-emerald-700">{available}</div>
            </div>
            <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-orange-50 border border-orange-100">
              <div className="text-[10px] font-bold text-orange-600 uppercase mb-1">On Break</div>
              <div className="text-2xl font-black text-orange-700">{onBreak}</div>
            </div>
            <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Off Duty</div>
              <div className="text-2xl font-black text-slate-600">{offDuty}</div>
            </div>
            <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-slate-100 border border-slate-200 opacity-75">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Inactive Profile</div>
              <div className="text-2xl font-black text-slate-600">{inactive}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid of Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="flex flex-col justify-between h-32 shadow-sm border-slate-100">
              <CardContent className="p-5 flex flex-col justify-between h-full">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{card.label}</span>
                  <div className={`p-2 rounded-lg ${card.bgColor} ${card.color}`}>
                    <Icon size={16} />
                  </div>
                </div>
                <div className="text-xl font-extrabold text-foreground mt-2">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Stepper Timeline */}
      <Card className="shadow-sm border-slate-100">
        <CardHeader className="pb-4">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Avg Performance Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 relative">
            {stepperItems.map((item, idx) => (
              <div key={item.step} className="flex flex-col relative items-center md:items-start text-center md:text-left space-y-2">
                {/* Stepper Dot */}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-[10px] font-bold z-10 shrink-0">
                    {idx + 1}
                  </div>
                  <span className="text-xs font-bold text-foreground">{item.step}</span>
                </div>
                <div className="pl-9 space-y-1">
                  <div className="text-lg font-bold text-primary">{item.time}</div>
                  <div className="text-[10px] text-muted-foreground font-medium">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Double Column Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recharts Hourly Distribution */}
        <Card className="lg:col-span-2 shadow-sm border-slate-100">
          <CardHeader>
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Peak Performance Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 text-xs font-medium">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="hour" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}
                    labelStyle={{ color: '#475569' }}
                  />
                  <Bar dataKey="orders" fill="var(--color-primary, #3b82f6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Locations Rank List */}
        <Card className="shadow-sm border-slate-100">
          <CardHeader>
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Top Locations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topLocations.length === 0 ? (
                <div className="py-8 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <span className="text-2xl">📍</span>
                  <span className="text-xs font-semibold">No delivery data yet</span>
                  <span className="text-[10px]">Create orders to populate locations</span>
                </div>
              ) : (
                topLocations.map((loc, idx) => (
                  <div key={loc.name} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-lg bg-secondary border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-foreground">{loc.name}</div>
                        <div className="text-[9px] text-muted-foreground">{loc.orders} {loc.orders === 1 ? 'delivery' : 'deliveries'}</div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-primary">{loc.orders} orders</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
