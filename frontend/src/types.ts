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

export interface IOrg {
  _id: string;
  name: string;
  status: 'active' | 'inactive';
  walletBalance: number;
  city: string;
  coords: {
    lat: number;
    lng: number;
  };
  ownRiderConfig: IOwnRiderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ILocation {
  latitude: number | null;
  longitude: number | null;
  updatedAt: string | null;
}

export interface IRiderStats {
  totalDeliveries: number;
  activeDeliveries: number;
  cancelledCount: number;
}

export interface IRider {
  _id: string;
  belongsTo: string;
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
  lastAssignedAt: string | null;
  stats: IRiderStats;
  createdAt: string;
  updatedAt: string;
}

export interface ICandidate {
  riderId: string;
  distanceKm: number | null;
  attemptedAt: string;
  result: 'pending' | 'accepted' | 'rejected' | 'timeout';
}

export interface IOwnRiderAssignment {
  riderId: string | null;
  riderName: string | null;
  riderPhone: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  assignmentStatus: AssignmentStatus;
  assignmentStrategy: AssignmentStrategy | null;
  assignmentMode: 'auto' | 'manual';
  attemptCount: number;
  candidateQueue: ICandidate[];
  assignedByOperatorId?: string | null;
}

export interface IMilestones {
  riderAssignedAt: string | null;
  atPickupAt: string | null;
  pickedAt: string | null;
  deliveredAt: string | null;
}

export interface ISla {
  slaBreached: boolean;
  breachType: 'pickup_delay' | 'delivery_delay' | null;
  breachedAt: string | null;
}

export interface IDelivery {
  _id: string;
  ownchatOrgId: string;
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
  createdAt: string;
  updatedAt: string;
}
