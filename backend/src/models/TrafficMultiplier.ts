import { Schema, model, Document } from 'mongoose';

export interface ITrafficMultiplier extends Document {
  hour_of_day: number; // 0-23
  day_of_week: number; // 0-6 (0 is Sunday)
  multiplier: number; // Defaults to 1.0. Higher means slower traffic
  sample_size: number; // Number of trips factored into this
  last_updated: Date;
}

const trafficMultiplierSchema = new Schema<ITrafficMultiplier>({
  hour_of_day: { type: Number, required: true, min: 0, max: 23 },
  day_of_week: { type: Number, required: true, min: 0, max: 6 },
  multiplier: { type: Number, default: 1.0 },
  sample_size: { type: Number, default: 0 },
  last_updated: { type: Date, default: Date.now }
}, { timestamps: true });

// Ensure we have exactly one record per hour/day combination
trafficMultiplierSchema.index({ hour_of_day: 1, day_of_week: 1 }, { unique: true });

export default model<ITrafficMultiplier>('TrafficMultiplier', trafficMultiplierSchema);
