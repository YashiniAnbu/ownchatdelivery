import { Schema, model, Document } from 'mongoose';

export interface IZoneDistanceMatrix extends Document {
  origin_zone: string;
  destination_zone: string;
  average_duration_seconds: number;
  average_distance_meters: number;
  sample_size: number;
  last_updated: Date;
}

const zoneDistanceMatrixSchema = new Schema<IZoneDistanceMatrix>({
  origin_zone: { type: String, required: true, index: true },
  destination_zone: { type: String, required: true },
  average_duration_seconds: { type: Number, required: true },
  average_distance_meters: { type: Number, required: true },
  sample_size: { type: Number, default: 0 },
  last_updated: { type: Date, default: Date.now }
}, { timestamps: true });

// Compound index for fast lookup of a specific route
zoneDistanceMatrixSchema.index({ origin_zone: 1, destination_zone: 1 }, { unique: true });

export default model<IZoneDistanceMatrix>('ZoneDistanceMatrix', zoneDistanceMatrixSchema);
