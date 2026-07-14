import { Schema, model, Document } from 'mongoose';

export interface IGeocodeCache extends Document {
  address_text: string;
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
  last_used_at: Date;
}

const geocodeCacheSchema = new Schema<IGeocodeCache>({
  address_text: { type: String, required: true, unique: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  formatted_address: { type: String, required: true },
  place_id: { type: String },
  last_used_at: { type: Date, default: Date.now }
}, { timestamps: true });

export default model<IGeocodeCache>('GeocodeCache', geocodeCacheSchema);
