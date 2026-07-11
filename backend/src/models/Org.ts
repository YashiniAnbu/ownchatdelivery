import { Schema, model } from 'mongoose';
import { IOrg } from '../types';

const orgSchema = new Schema<IOrg>({
  name: { type: String, required: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  walletBalance: { type: Number, default: 0 },
  city: { type: String, default: '' },
  coords: {
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 }
  },
  ownRiderConfig: {
    enabled: { type: Boolean, default: false },
    assignmentStrategy: {
      type: String,
      enum: ['manual', 'nearest', 'round_robin', 'load_balanced', 'hybrid'],
      default: 'hybrid'
    },
    maxConcurrentOrdersPerRider: { type: Number, default: 3 },
    riderAcceptanceTimeoutMinutes: { type: Number, default: 5 },
    pickupTimeoutMinutes: { type: Number, default: 20 },
    deliveryTimeoutMinutes: { type: Number, default: 45 },
    fallbackToExternalProvider: { type: Boolean, default: false },
    fallbackProvider: {
      type: String,
      enum: ['porter', 'qwqer', 'adloggs', null],
      default: null
    }
  }
}, {
  timestamps: true
});

export default model<IOrg>('Org', orgSchema);
