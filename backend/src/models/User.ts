import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: 'owner' | 'staff' | 'rider';
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['owner', 'staff', 'rider'], default: 'owner' },
  tokenVersion: { type: Number, default: 0 }
}, {
  timestamps: true
});

export default model<IUser>('User', userSchema);
