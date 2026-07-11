import { Schema, model, Document } from 'mongoose';

export interface IAuditLog extends Document {
  actorId: string;
  actorType: 'user' | 'rider';
  actorName: string;
  action: string;
  targetType: 'order' | 'rider' | 'settings' | 'wallet';
  targetId: string;
  metadata: Record<string, any>;
  ip?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  actorId: { type: String, required: true },
  actorType: { type: String, enum: ['user', 'rider'], required: true },
  actorName: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String, enum: ['order', 'rider', 'settings', 'wallet'], required: true },
  targetId: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  ip: { type: String }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export default model<IAuditLog>('AuditLog', auditLogSchema);
