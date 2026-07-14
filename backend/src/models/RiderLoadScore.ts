import { Schema, model, Document } from 'mongoose';

export interface IRiderLoadScore extends Document {
  riderId: Schema.Types.ObjectId;
  active_trip_count: number;
  distance_today: number;
  last_calculated_at: Date;
}

const riderLoadScoreSchema = new Schema<IRiderLoadScore>({
  riderId: { type: Schema.Types.ObjectId, ref: 'Rider', required: true, unique: true },
  active_trip_count: { type: Number, default: 0 },
  distance_today: { type: Number, default: 0 },
  last_calculated_at: { type: Date, default: Date.now }
}, { timestamps: true });

export default model<IRiderLoadScore>('RiderLoadScore', riderLoadScoreSchema);
