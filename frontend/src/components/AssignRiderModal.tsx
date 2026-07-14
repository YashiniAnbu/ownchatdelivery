import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { UserCheck, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import type { IDelivery } from '../types';
import { io, Socket } from 'socket.io-client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

interface ScoredRider {
  _id: string;
  name: string;
  phone: string;
  vehicleType: string;
  activeDeliveries: number;
  distanceKm: number | null;
  distanceScore: number;
  loadScore: number;
  fairnessScore: number;
  totalScore: number;
}

interface AssignRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  delivery: IDelivery;
  riders: any[]; // fallback
  orgStrategy?: string;
  onConfirm: (riderId: string) => void;
}

export default function AssignRiderModal({ isOpen, onClose, delivery, orgStrategy, onConfirm }: AssignRiderModalProps) {
  const [scoredRiders, setScoredRiders] = useState<ScoredRider[]>([]);
  const [excludedRiders, setExcludedRiders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Map DB strategy to UI preference
  const mapStrategyToPreference = (strat?: string) => {
    if (strat === 'nearest') return 'nearest';
    if (strat === 'load_balanced') return 'load';
    if (strat === 'round_robin') return 'fairness';
    return 'hybrid'; // Default fallback
  };

  const [preference, setPreference] = useState<'hybrid' | 'nearest' | 'load' | 'fairness'>(mapStrategyToPreference(orgStrategy));

  // If orgStrategy prop updates (e.g. they changed it in settings), sync it
  useEffect(() => {
    if (isOpen) {
      setPreference(mapStrategyToPreference(orgStrategy));
    }
  }, [orgStrategy, isOpen]);

  const fetchScoredRiders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/delivery/${delivery._id}/ranked-riders`);
      setScoredRiders(res.data.rankedRiders || []);
      setExcludedRiders(res.data.excludedRiderIds || []);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to compute rider suitability scores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let socket: Socket | null = null;
    if (isOpen) {
      fetchScoredRiders();

      // Connect to Socket.io for real-time updates
      socket = io('http://localhost:5001');
      socket.on('connect', () => {
        socket?.emit('join_dispatchers', delivery.ownchatOrgId?.toString?.() ?? delivery.ownchatOrgId);
      });

      const handleLiveUpdate = () => {
        // Trigger a background refresh (no loading spinner overlay to prevent jitter)
        api.get(`/delivery/${delivery._id}/ranked-riders`).then(res => {
          setScoredRiders(res.data.rankedRiders || []);
          setExcludedRiders(res.data.excludedRiderIds || []);
        }).catch(err => console.error('Live update failed', err));
      };

      socket.on('rider:location_update', handleLiveUpdate);
      socket.on('rider:status_changed', handleLiveUpdate);
      socket.on('order:assigned', handleLiveUpdate);
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [isOpen, delivery._id, delivery.ownchatOrgId]);

  // Remove distance and top N restrictions
  const validRiders = scoredRiders;

  const nearestRider = [...validRiders].sort((a, b) => (a.distanceKm || Infinity) - (b.distanceKm || Infinity))[0];
  const leastBusyRider = [...validRiders].sort((a, b) => a.activeDeliveries - b.activeDeliveries)[0];
  const fairestRider = [...validRiders].sort((a, b) => b.fairnessScore - a.fairnessScore)[0];

  const sortedRiders = [...validRiders].sort((a, b) => {
    if (preference === 'nearest') {
      const distA = a.distanceKm === null ? Infinity : a.distanceKm;
      const distB = b.distanceKm === null ? Infinity : b.distanceKm;
      return distA - distB;
    }
    if (preference === 'load') {
      return a.activeDeliveries - b.activeDeliveries;
    }
    if (preference === 'fairness') {
      return b.fairnessScore - a.fairnessScore;
    }
    return a.totalScore - b.totalScore;
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <UserCheck className="w-5 h-5 text-primary" />
            Rider Suitability (Manual Override)
          </DialogTitle>
          <DialogDescription>
            Showing all eligible riders for order <span className="font-mono text-primary font-semibold">#{delivery._id.substring(18)}</span>.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs">Computing scores...</span>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : scoredRiders.length === 0 && excludedRiders.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            No eligible riders available. Ensure they are checked in on shift and below workload limits.
          </div>
        ) : (
          <>
            {excludedRiders.length > 0 && (
              <Alert variant="default" className="bg-amber-50 border-amber-200 text-amber-800 py-2">
                <Info className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-xs font-bold text-amber-800">Riders Flagged</AlertTitle>
                <AlertDescription className="text-xs">
                  {excludedRiders.length} rider(s) previously timed-out or rejected this order. They are still shown below for manual override.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between items-center bg-secondary/30 p-2 px-3 rounded-lg border my-3">
              <span className="text-sm font-semibold text-foreground">Sort By Strategy:</span>
              <Select value={preference} onValueChange={(val: any) => setPreference(val)}>
                <SelectTrigger className="w-[180px] h-8 text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">Hybrid (Composite)</SelectItem>
                  <SelectItem value="nearest">Nearest First</SelectItem>
                  <SelectItem value="load">Least Busy First</SelectItem>
                  <SelectItem value="fairness">Due for Job (Fairness)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Mobile card layout */}
            <div className="sm:hidden space-y-3">
              {sortedRiders.map((r, idx) => (
                <Card key={r._id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{r.name}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{r.vehicleType}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {nearestRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700">Nearest ETA</Badge>}
                          {leastBusyRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700">Least Busy</Badge>}
                          {fairestRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-purple-50 text-purple-700">Due for Job</Badge>}
                          {excludedRiders.includes(r._id) && <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200">Flagged</Badge>}
                        </div>
                      </div>
                      <Badge variant={idx === 0 ? 'default' : 'secondary'} className="flex flex-col items-end py-1">
                        <span>{(r.totalScore ?? 0).toFixed(3)}</span>
                        {idx === 0 && <span className="text-[9px] block">Recommended</span>}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                      <div>
                        <div className="font-bold uppercase">Distance</div>
                        <div className="font-mono text-foreground">{r.distanceKm !== null ? `${r.distanceKm.toFixed(2)} km` : '—'}</div>
                      </div>
                      <div>
                        <div className="font-bold uppercase">Load</div>
                        <div className="font-mono text-foreground">{r.activeDeliveries} active</div>
                      </div>
                      <div>
                        <div className="font-bold uppercase">Fairness</div>
                        <div className="font-mono text-foreground">({(r.fairnessScore ?? 0).toFixed(2)})</div>
                      </div>
                    </div>
                    <Button onClick={() => onConfirm(r._id)} className="w-full text-xs">
                      Assign Rider
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Desktop table layout */}
            <div className="hidden sm:block border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rider Name</TableHead>
                    <TableHead className="text-right">Distance (km)</TableHead>
                    <TableHead className="text-right">Active Load</TableHead>
                    <TableHead className="text-right">Fairness Penalty</TableHead>
                    <TableHead className="text-right">Composite Score</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRiders.map((r, idx) => (
                    <TableRow key={r._id}>
                      <TableCell>
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{r.vehicleType}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {nearestRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700">Nearest ETA</Badge>}
                          {leastBusyRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700">Least Busy</Badge>}
                          {fairestRider?._id === r._id && <Badge variant="outline" className="text-[9px] bg-purple-50 text-purple-700">Due for Job</Badge>}
                          {excludedRiders.includes(r._id) && <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200">Flagged</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.distanceKm != null ? `${r.distanceKm.toFixed(2)} km` : '—'}
                        <div className="text-[9px] text-muted-foreground">({(r.distanceScore ?? 0).toFixed(2)})</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.activeDeliveries} active
                        <div className="text-[9px] text-muted-foreground">({(r.loadScore ?? 0).toFixed(2)})</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        —
                        <div className="text-[9px] text-muted-foreground">({(r.fairnessScore ?? 0).toFixed(2)})</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={idx === 0 ? 'default' : 'secondary'}>
                          {(r.totalScore ?? 0).toFixed(3)}
                        </Badge>
                        {idx === 0 && <span className="text-[9px] text-primary block mt-1 font-semibold">Recommended</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button onClick={() => onConfirm(r._id)} size="sm">
                          Assign
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
