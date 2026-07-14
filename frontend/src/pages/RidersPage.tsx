import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2, Search, Bike, AlertCircle, RefreshCw, MoreHorizontal, UserX } from 'lucide-react';
import type { IRider } from '../types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

interface RidersPageProps {
  activeOrgId: string;
}

export default function RidersPage({ activeOrgId }: RidersPageProps) {
  const [riders, setRiders] = useState<IRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentRiderId, setCurrentRiderId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [address, setAddress] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<File | string | null>(null);
  const [formError, setFormError] = useState('');

  const fetchRiders = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const res = await api.get(`/rider/list?orgId=${activeOrgId}`);
      setRiders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiders();
  }, [activeOrgId]);

  const resetForm = () => {
    setName('');
    setPhone('');
    setVehicleType('bike');
    setVehicleNumber('');
    setAddress('');
    setLicenseNo('');
    setProfilePhoto(null);
    setFormError('');
    setIsEditing(false);
    setCurrentRiderId(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (rider: IRider) => {
    resetForm();
    setName(rider.name);
    setPhone(rider.phone);
    setVehicleType(rider.vehicleType);
    setVehicleNumber(rider.vehicleNumber || '');
    setAddress(rider.address || '');
    setLicenseNo(rider.licenseNo || '');
    setProfilePhoto(rider.profilePhoto || null);
    setIsEditing(true);
    setCurrentRiderId(rider._id);
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (phone.length !== 10) {
      setFormError('Phone number must be exactly 10 digits.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('phone', phone);
      formData.append('vehicleType', vehicleType);
      formData.append('vehicleNumber', vehicleNumber);
      formData.append('address', address);
      formData.append('licenseNo', licenseNo);
      formData.append('operatorId', 'system');
      if (profilePhoto) {
        formData.append('profilePhoto', profilePhoto);
      }

      if (isEditing && currentRiderId) {
        await api.put(`/rider/${currentRiderId}`, formData);
      } else {
        formData.append('ownchatOrgId', activeOrgId);
        await api.post('/rider/create', formData);
      }
      setIsDialogOpen(false);
      resetForm();
      fetchRiders();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save rider');
    }
  };

  const handleDelete = async (riderId: string, riderName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete ${riderName}? This action cannot be undone.`)) return;
    try {
      await api.delete(`/rider/${riderId}`, { data: { operatorId: 'system' } });
      fetchRiders();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete rider');
    }
  };

  const filteredRiders = riders.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Fleet Management</h2>
          <p className="text-muted-foreground mt-1 text-sm">Manage your riders, vehicles, and operational status.</p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreate} className="gap-2">
              <Plus size={16} /> Add New Rider
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditing ? 'Edit Rider Profile' : 'Register New Rider'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              {formError && (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg flex items-center gap-2">
                  <AlertCircle size={16} /> {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
                  <Input id="name" required value={name} onChange={e => setName(e.target.value)} placeholder="Rider Name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number (10 digits) <span className="text-destructive">*</span></Label>
                  <Input id="phone" required value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} maxLength={10} placeholder="e.g. 9876543210" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleType">Vehicle Type <span className="text-destructive">*</span></Label>
                  <Select value={vehicleType} onValueChange={(val: any) => setVehicleType(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select vehicle type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bike">Bike / Motorcycle</SelectItem>
                      <SelectItem value="scooter">Scooter</SelectItem>
                      <SelectItem value="e-bike">E-Bike</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehicleNumber">Registration Number <span className="text-destructive">*</span></Label>
                  <Input id="vehicleNumber" required value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value.toUpperCase())} placeholder="e.g. TN-01-AB-1234" />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="address">Address <span className="text-destructive">*</span></Label>
                  <Input id="address" required value={address} onChange={e => setAddress(e.target.value)} placeholder="Full Address" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="licenseNo">License No</Label>
                  <Input id="licenseNo" value={licenseNo} onChange={e => setLicenseNo(e.target.value)} placeholder="License Number" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profilePhoto">Profile Photo <span className="text-destructive">{!isEditing && '*'}</span></Label>
                  <Input id="profilePhoto" type="file" required={!isEditing} accept="image/*" onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setProfilePhoto(e.target.files[0]);
                    }
                  }} />
                  {typeof profilePhoto === 'string' && profilePhoto && (
                    <p className="text-[10px] text-muted-foreground truncate">Current: {profilePhoto.split('/').pop()}</p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{isEditing ? 'Save Changes' : 'Create Rider'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <CardTitle className="text-lg">Rider Directory</CardTitle>
              <CardDescription>View and manage all active and inactive riders.</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex flex-col">
          <div className="overflow-auto max-h-[600px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-secondary [&::-webkit-scrollbar-track]:bg-transparent">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className="bg-secondary/30 hover:bg-secondary/30 border-b-0">
                  <TableHead className="rounded-tl-lg h-11 text-foreground/80 font-semibold">Rider Name</TableHead>
                  <TableHead className="h-11 text-foreground/80 font-semibold">Contact</TableHead>
                  <TableHead className="h-11 text-foreground/80 font-semibold">Vehicle Info</TableHead>
                  <TableHead className="h-11 text-foreground/80 font-semibold">Status</TableHead>
                  <TableHead className="text-right rounded-tr-lg h-11 text-foreground/80 font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-secondary animate-pulse" />
                          <div className="space-y-2">
                            <div className="h-3 w-24 bg-secondary animate-pulse rounded" />
                            <div className="h-2 w-16 bg-secondary animate-pulse rounded" />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><div className="h-4 w-24 bg-secondary animate-pulse rounded" /></TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <div className="h-3 w-20 bg-secondary animate-pulse rounded" />
                          <div className="h-2 w-16 bg-secondary animate-pulse rounded" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <div className="h-5 w-16 bg-secondary animate-pulse rounded-full" />
                          <div className="h-4 w-16 bg-secondary animate-pulse rounded" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <div className="h-8 w-8 bg-secondary animate-pulse rounded-md" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredRiders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground gap-3">
                        <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-2">
                          <UserX className="w-6 h-6 opacity-40" />
                        </div>
                        <span className="text-sm font-medium text-foreground">No riders found</span>
                        <span className="text-xs opacity-70">Try adjusting your search query.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRiders.map((rider) => (
                    <TableRow key={rider._id} className="hover:bg-muted/30 transition-all hover:shadow-sm hover:-translate-y-[1px] group">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {rider.profilePhoto ? (
                            <img src={rider.profilePhoto} alt={rider.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                              {rider.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div>{rider.name}</div>
                            <div className="text-xs text-muted-foreground">ID: {rider._id.substring(18)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{rider.phone}</div>
                      </TableCell>
                      <TableCell>
                        <div className="capitalize font-medium">{rider.vehicleType}</div>
                        <div className="text-xs text-muted-foreground">Reg: {rider.vehicleNumber || 'N/A'}</div>
                        {rider.licenseNo && <div className="text-[10px] text-muted-foreground/70">Lic: {rider.licenseNo}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          <Badge variant={rider.isActive ? "default" : "secondary"}>
                            {rider.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          {rider.isActive && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${rider.isOnDuty ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                              {rider.isOnDuty ? 'On Duty' : 'Off Duty'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(rider)}
                            className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                            title="Edit Profile"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(rider._id, rider.name)}
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Delete Rider"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
