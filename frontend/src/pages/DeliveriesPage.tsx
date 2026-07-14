import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { MapPin, Download, Plus, Search, RefreshCw, Bike, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { IDelivery, IRider, DeliveryStatus } from '../types';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface DeliveryStats {
  totalShipments: number;
  activeDeliveries: number;
  averageCost: number;
}

interface DeliveriesPageProps {
  activeOrgId: string;
}

export default function DeliveriesPage({ activeOrgId }: DeliveriesPageProps) {
  const [deliveries, setDeliveries] = useState<IDelivery[]>([]);
  const [riders, setRiders] = useState<IRider[]>([]);
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [riderFilter, setRiderFilter] = useState('');

  const navigate = useNavigate();

  const fetchDeliveriesAndStats = async () => {
    if (!activeOrgId) return;
    try {
      const [delRes, riderRes, statsRes] = await Promise.all([
        api.get(`/delivery?orgId=${activeOrgId}`),
        api.get(`/rider/list?orgId=${activeOrgId}`),
        api.get(`/org/${activeOrgId}/delivery-stats`)
      ]);
      setDeliveries(delRes.data);
      setRiders(riderRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveriesAndStats();
  }, [activeOrgId]);

  const exportCSV = () => {
    const headers = ['Order ID', 'Customer Name', 'Customer Phone', 'Assigned Rider', 'Status', 'Location', 'Cost (INR)', 'Date'];
    const rows = filteredDeliveries.map(d => [
      d._id.substring(18).toUpperCase(),
      d.customer?.name || '',
      d.customer?.phone || '',
      d.ownRiderAssignment?.riderName || 'Unassigned',
      d.status,
      `"${d.drop?.label || ''}"`,
      d.cost || 0,
      new Date(d.createdAt).toLocaleDateString()
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `deliveries_export_${activeOrgId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredDeliveries = deliveries.filter(d => {
    const matchesSearch = 
      d._id.toLowerCase().includes(search.toLowerCase()) ||
      d.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
      d.customer?.phone?.includes(search) ||
      d.drop?.label?.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === '' || statusFilter === 'all' || d.status === statusFilter;
    const matchesRider = riderFilter === '' || riderFilter === 'all' || d.ownRiderAssignment?.riderId === riderFilter;

    return matchesSearch && matchesStatus && matchesRider;
  });

  const statusOptions = [
    { value: 'unassigned', label: 'Order Created' },
    { value: 'ASSIGNED', label: 'Rider Assigned' },
    { value: 'RIDER_EN_ROUTE_TO_PICKUP', label: 'En Route to Store' },
    { value: 'ARRIVED_AT_PICKUP', label: 'Reached Store' },
    { value: 'IN_TRIP', label: 'Parcel In-Transit' },
    { value: 'COMPLETED', label: 'Delivered' },
    { value: 'CANCELLED', label: 'Cancelled' }
  ];

  return (
    <div className="space-y-6">
      {/* Top action header bar */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Shipments Feed</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Manage shipment details and history.</p>
        </div>
      </div>

      {/* Stats Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Shipments</div>
            <div className="text-2xl font-extrabold text-foreground mt-1">{stats?.totalShipments || 0}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Deliveries</div>
            <div className="text-2xl font-extrabold text-blue-600 mt-1">{stats?.activeDeliveries || 0}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Average Cost</div>
            <div className="text-2xl font-extrabold text-emerald-600 mt-1">₹{stats?.averageCost ? stats.averageCost.toFixed(0) : '0'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and filter toolbar */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by Order ID, Customer, Phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={statusFilter || "all"} onValueChange={(val) => { if (val) setStatusFilter(val === "all" ? "" : val); }}>
          <SelectTrigger className="w-full md:w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unassigned">Order Created</SelectItem>
            <SelectItem value="ASSIGNED">Rider Assigned</SelectItem>
            <SelectItem value="RIDER_EN_ROUTE_TO_PICKUP">En Route to Store</SelectItem>
            <SelectItem value="ARRIVED_AT_PICKUP">Reached Store</SelectItem>
            <SelectItem value="IN_TRIP">Parcel In-Transit</SelectItem>
            <SelectItem value="COMPLETED">Delivered</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={riderFilter || "all"} onValueChange={(val) => { if (val) setRiderFilter(val === "all" ? "" : val); }}>
          <SelectTrigger className="w-full md:w-[200px]">
            <SelectValue placeholder="All Assigned Riders" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assigned Riders</SelectItem>
            {riders.map(r => (
              <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Deliveries Table */}
      <div className="border rounded-xl bg-background shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto max-h-[600px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-secondary [&::-webkit-scrollbar-track]:bg-transparent">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow className="bg-secondary/30 hover:bg-secondary/30 border-b-0">
                <TableHead className="font-semibold text-foreground/80 rounded-tl-lg h-11">Order ID</TableHead>
                <TableHead className="font-semibold text-foreground/80 h-11">Customer Details</TableHead>
                <TableHead className="font-semibold text-foreground/80 h-11">Assigned Rider</TableHead>
                <TableHead className="font-semibold text-foreground/80 h-11">SLA status</TableHead>
                <TableHead className="font-semibold text-foreground/80 rounded-tr-lg h-11">Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell><div className="h-4 w-16 bg-secondary animate-pulse rounded" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-secondary animate-pulse" />
                        <div className="space-y-2">
                          <div className="h-3 w-24 bg-secondary animate-pulse rounded" />
                          <div className="h-2 w-16 bg-secondary animate-pulse rounded" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><div className="h-4 w-20 bg-secondary animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-secondary animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-4 w-32 bg-secondary animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filteredDeliveries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-3">
                      <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-2">
                        <Inbox className="w-6 h-6 opacity-40" />
                      </div>
                      <span className="text-sm font-medium text-foreground">No shipments found</span>
                      <span className="text-xs opacity-70">Try adjusting your search or filters.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
              filteredDeliveries.map((d) => (
                <TableRow key={d._id} className="hover:bg-muted/30 transition-all hover:shadow-sm hover:-translate-y-[1px] group">
                  <TableCell className="font-mono text-[10px] text-primary font-bold uppercase tracking-wider py-4">
                    #{d._id.substring(18)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center border border-primary/20 text-xs">
                        {d.customer?.name?.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{d.customer?.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{d.customer?.phone}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {d.ownRiderAssignment?.riderName ? (
                      <div className="flex items-center gap-2">
                        <Bike className="w-4 h-4 text-emerald-600" />
                        <span className="font-semibold">{d.ownRiderAssignment.riderName}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="h-8 text-xs font-semibold px-3 flex items-center justify-center w-fit">
                      {statusOptions.find(opt => opt.value === d.status)?.label || d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} className="text-primary shrink-0" />
                      <span className="truncate max-w-[150px] font-medium">{d.drop?.label}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
