import { Schema, model, Types } from 'mongoose';
import { IRider } from '../types';

const riderSchema = new Schema<IRider>({
  belongsTo: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  ownchatOrgId: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String },
  profilePhoto: { type: String, required: true },
  vehicleType: {
    type: String,
    enum: ['bike', 'scooter', 'e-bike'],
    default: 'bike'
  },
  vehicleNumber: { type: String },
  licenseNo: { type: String },
  address: { type: String, required: true },
  pin: { type: String },
  fcmToken: { type: String },
  isActive: { type: Boolean, default: true },
  isOnDuty: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
  lastKnownLocation: {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    updatedAt: { type: Date, default: null }
  },
  lastAssignedAt: { type: Date, default: null },
  stats: {
    totalDeliveries: { type: Number, default: 0 },
    activeDeliveries: { type: Number, default: 0 },
    cancelledCount: { type: Number, default: 0 }
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Indexes for performance sorting
riderSchema.index({ phone: 1 }, { unique: true });
riderSchema.index({ ownchatOrgId: 1, isActive: 1 });
riderSchema.index({ ownchatOrgId: 1, isOnDuty: 1, isAvailable: 1 });
// For round-robin sorting
riderSchema.index({ ownchatOrgId: 1, isOnDuty: 1, isAvailable: 1, lastAssignedAt: 1 });
// For load-balanced sorting
riderSchema.index({ ownchatOrgId: 1, isOnDuty: 1, isAvailable: 1, 'stats.activeDeliveries': 1 });

export default model<IRider>('Rider', riderSchema);
