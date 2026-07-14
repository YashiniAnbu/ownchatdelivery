import { Schema, model, Document } from 'mongoose';

export interface ITripLocationHistory extends Document {
  deliveryId: Schema.Types.ObjectId;
  lat: number;
  lng: number;
  recorded_at: Date;
}

const tripLocationHistorySchema = new Schema<ITripLocationHistory>({
  deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery', required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  recorded_at: { type: Date, default: Date.now }
}, { timestamps: true });

tripLocationHistorySchema.index({ deliveryId: 1, recorded_at: -1 });
export default model<ITripLocationHistory>('TripLocationHistory', tripLocationHistorySchema);
