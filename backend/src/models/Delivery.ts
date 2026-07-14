import { Schema, model, Types } from 'mongoose';
import { IDelivery } from '../types';

const candidateSchema = new Schema({
  riderId: { type: Schema.Types.ObjectId, ref: 'Rider', required: true },
  distanceKm: { type: Number, default: null },
  etaSeconds: { type: Number, default: null },
  attemptedAt: { type: Date, required: true },
  result: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'timeout'],
    default: 'pending'
  }
}, { _id: false });

const deliverySchema = new Schema<IDelivery>({
  ownchatOrgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  provider: {
    type: String,
    enum: ['own_rider', 'porter', 'qwqer', 'adloggs'],
    required: true
  },
  status: {
    type: String,
    enum: ['unassigned', 'ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRIP', 'COMPLETED', 'CANCELLED'],
    default: 'unassigned'
  },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true }
  },
  pickup: {
    label: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    formatted_address: { type: String }
  },
  drop: {
    label: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    formatted_address: { type: String }
  },
  ownRiderAssignment: {
    riderId: { type: Schema.Types.ObjectId, ref: 'Rider', default: null },
    riderName: { type: String, default: null },
    riderPhone: { type: String, default: null },
    assignedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    assignmentStatus: {
      type: String,
      enum: ['unassigned', 'pending', 'accepted', 'rejected', 'timeout'],
      default: 'unassigned'
    },
    assignmentStrategy: {
      type: String,
      enum: ['manual', 'nearest', 'round_robin', 'load_balanced', 'hybrid', null],
      default: null
    },
    assignmentMode: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto'
    },
    attemptCount: { type: Number, default: 0 },
    candidateQueue: [candidateSchema],
    assignedByOperatorId: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  milestones: {
    riderAssignedAt: { type: Date, default: null },
    atPickupAt: { type: Date, default: null },
    pickedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null }
  },
  sla: {
    slaBreached: { type: Boolean, default: false },
    breachType: {
      type: String,
      enum: ['pickup_delay', 'delivery_delay', null],
      default: null
    },
    breachedAt: { type: Date, default: null }
  },
  cost: { type: Number, default: 0 },
  estimated_duration: { type: Number, default: null },
  estimated_distance: { type: Number, default: null }
}, {
  timestamps: true
});

// Index for scanning active assignments per rider
deliverySchema.index({ 'ownRiderAssignment.riderId': 1, status: 1 });
deliverySchema.index({ ownchatOrgId: 1, status: 1 });

export default model<IDelivery>('Delivery', deliverySchema);
