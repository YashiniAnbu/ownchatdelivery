import { Schema, model, Document } from 'mongoose';

export interface IRoundRobinState extends Document {
  zone_id: string;
  last_assigned_rider_id: Schema.Types.ObjectId | null;
}

const roundRobinStateSchema = new Schema<IRoundRobinState>({
  zone_id: { type: String, required: true, unique: true },
  last_assigned_rider_id: { type: Schema.Types.ObjectId, ref: 'Rider', default: null }
}, { timestamps: true });

export default model<IRoundRobinState>('RoundRobinState', roundRobinStateSchema);
