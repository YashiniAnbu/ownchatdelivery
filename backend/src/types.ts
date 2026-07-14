import { Document, Types } from 'mongoose';

export type AssignmentStrategy = 'manual' | 'nearest' | 'round_robin' | 'load_balanced' | 'hybrid';
export type VehicleType = 'bike' | 'scooter' | 'e-bike';
export type DeliveryStatus = 'unassigned' | 'ASSIGNED' | 'RIDER_EN_ROUTE_TO_PICKUP' | 'ARRIVED_AT_PICKUP' | 'IN_TRIP' | 'COMPLETED' | 'CANCELLED';
export type AssignmentStatus = 'unassigned' | 'pending' | 'accepted' | 'rejected' | 'timeout';
export type Provider = 'own_rider' | 'porter' | 'qwqer' | 'adloggs';

export interface IOwnRiderConfig {
  enabled: boolean;
  assignmentStrategy: AssignmentStrategy;
  maxConcurrentOrdersPerRider: number;
  riderAcceptanceTimeoutMinutes: number;
  pickupTimeoutMinutes: number;
  deliveryTimeoutMinutes: number;
  fallbackToExternalProvider: boolean;
  fallbackProvider: Provider | null;
}

export interface IOrg extends Document {
  name: string;
  status: 'active' | 'inactive';
  walletBalance: number;
  city: string;
  coords: {
    lat: number;
    lng: number;
  };
  ownRiderConfig: IOwnRiderConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILocation {
  latitude: number | null;
  longitude: number | null;
  updatedAt: Date | null;
}

export interface IRiderStats {
  totalDeliveries: number;
  activeDeliveries: number;
  cancelledCount: number;
}

export interface IRider extends Document {
  belongsTo: Types.ObjectId;
  ownchatOrgId: string;
  name: string;
  phone: string;
  email?: string;
  profilePhoto: string;
  vehicleType: VehicleType;
  vehicleNumber?: string;
  licenseNo?: string;
  address: string;
  pin?: string;
  fcmToken?: string;
  isActive: boolean;
  isOnDuty: boolean;
  isAvailable: boolean;
  lastKnownLocation: ILocation;
  lastAssignedAt: Date | null;
  stats: IRiderStats;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  lastUpdatedAt: Date;
}

export interface ICandidate {
  riderId: Types.ObjectId;
  distanceKm: number | null;
  etaSeconds: number | null;
  attemptedAt: Date;
  result: 'pending' | 'accepted' | 'rejected' | 'timeout';
}

export interface IOwnRiderAssignment {
  riderId: Types.ObjectId | null;
  riderName: string | null;
  riderPhone: string | null;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  assignmentStatus: AssignmentStatus;
  assignmentStrategy: AssignmentStrategy | null;
  assignmentMode: 'auto' | 'manual';
  attemptCount: number;
  candidateQueue: ICandidate[];
  assignedByOperatorId?: Types.ObjectId | null;
}

export interface IMilestones {
  riderAssignedAt: Date | null;
  atPickupAt: Date | null;
  pickedAt: Date | null;
  deliveredAt: Date | null;
}

export interface ISla {
  slaBreached: boolean;
  breachType: 'pickup_delay' | 'delivery_delay' | null;
  breachedAt: Date | null;
}

export interface IDelivery extends Document {
  ownchatOrgId: Types.ObjectId;
  provider: Provider;
  status: DeliveryStatus;
  customer: {
    name: string;
    phone: string;
  };
  pickup: {
    label: string;
    latitude: number;
    longitude: number;
  };
  drop: {
    label: string;
    latitude: number;
    longitude: number;
  };
  ownRiderAssignment: IOwnRiderAssignment;
  milestones: IMilestones;
  sla: ISla;
  cost?: number;
  estimated_duration?: number;
  estimated_distance?: number;
  createdAt: Date;
  updatedAt: Date;
}
