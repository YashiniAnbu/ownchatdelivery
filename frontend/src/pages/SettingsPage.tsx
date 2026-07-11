import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Settings, Save, MapPin, Calendar, ShieldCheck, RefreshCw } from 'lucide-react';
import type { IOrg } from '../types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SettingsPageProps {
  activeOrgId: string;
}

export default function SettingsPage({ activeOrgId }: SettingsPageProps) {
  const [org, setOrg] = useState<IOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // SLA states
  const [assignmentMins, setAssignmentMins] = useState('2');
  const [pickupMins, setPickupMins] = useState('20');
  const [deliveryMins, setDeliveryMins] = useState('45');

  const fetchOrgSettings = async () => {
    if (!activeOrgId) return;
    try {
      const res = await api.get(`/org/${activeOrgId}`);
      const data = res.data;
      setOrg(data);
      setAssignmentMins(data.ownRiderConfig?.riderAcceptanceTimeoutMinutes?.toString() || '2');
      setPickupMins(data.ownRiderConfig?.pickupTimeoutMinutes?.toString() || '20');
      setDeliveryMins(data.ownRiderConfig?.deliveryTimeoutMinutes?.toString() || '45');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgSettings();
  }, [activeOrgId]);

  const handleSaveSLA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;

    setSubmitting(true);
    try {
      await api.patch(`/org/${activeOrgId}/sla`, {
        assignmentMins: parseInt(assignmentMins, 10),
        pickupMins: parseInt(pickupMins, 10),
        deliveryMins: parseInt(deliveryMins, 10),
        operatorId: localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : 'system',
        operatorName: localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).name : 'Owner'
      });
      fetchOrgSettings();
      alert('SLA settings saved successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to update SLA settings');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm">Retrieving profile settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Merchant Profile</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Configure store info, GPS coordinates, and SLA metrics.</p>
      </div>

      {/* Header Profile Card */}
      <Card className="shadow-sm">
        <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-center md:text-left flex-col md:flex-row">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xl font-extrabold shadow-lg">
              {org?.name?.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-col md:flex-row">
                <h2 className="text-lg font-bold text-foreground">{org?.name}</h2>
                <span className="text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  Active Store
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{org?.city || 'Chennai'} Office</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* General Info */}
        <Card className="lg:col-span-1 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">General Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-xs text-foreground/80">
              <div className="flex items-center gap-3">
                <ShieldCheck size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Store Status</div>
                  <div className="font-bold text-foreground mt-0.5">Online & Operating</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Member Since</div>
                  <div className="font-bold text-foreground mt-0.5">
                    {org?.createdAt ? new Date(org.createdAt).toLocaleDateString() : 'N/A'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 border-t pt-4 mt-4">
                <MapPin size={16} className="text-primary shrink-0" />
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">GPS Store Location</div>
                  <div className="font-semibold font-mono text-foreground mt-0.5">
                    Lat: {org?.coords?.lat || '13.0418'}
                  </div>
                  <div className="font-semibold font-mono text-foreground">
                    Lng: {org?.coords?.lng || '80.2341'}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SLA Configuration */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Settings size={14} className="text-primary" />
              SLA Threshold Settings
            </CardTitle>
            <CardDescription className="text-xs">
              Set timers that drive automated status checks, worker retry cron triggers, and fallback timeouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSLA} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Assignment SLA (min)</Label>
                  <Input
                    type="number"
                    required
                    value={assignmentMins}
                    onChange={(e) => setAssignmentMins(e.target.value)}
                    className="font-mono"
                  />
                  <span className="text-[9px] text-muted-foreground block leading-normal">
                    Rider acceptance window before cron times out.
                  </span>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Pickup SLA (min)</Label>
                  <Input
                    type="number"
                    required
                    value={pickupMins}
                    onChange={(e) => setPickupMins(e.target.value)}
                    className="font-mono"
                  />
                  <span className="text-[9px] text-muted-foreground block leading-normal">
                    Allowed duration to travel to restaurant pickup.
                  </span>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Delivery SLA (min)</Label>
                  <Input
                    type="number"
                    required
                    value={deliveryMins}
                    onChange={(e) => setDeliveryMins(e.target.value)}
                    className="font-mono"
                  />
                  <span className="text-[9px] text-muted-foreground block leading-normal">
                    Allowed duration to reach customer destination.
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t mt-4">
                <Button type="submit" disabled={submitting} className="gap-1.5 h-10">
                  <Save size={14} />
                  {submitting ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
