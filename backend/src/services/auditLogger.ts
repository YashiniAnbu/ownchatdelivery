import AuditLog from '../models/AuditLog';

interface AuditLogParams {
  actorId: string;
  actorType: 'user' | 'rider';
  actorName: string;
  action: string;
  targetType: 'order' | 'rider' | 'settings' | 'wallet';
  targetId: string;
  metadata?: Record<string, any>;
  ip?: string;
}

export async function logAudit({
  actorId,
  actorType,
  actorName,
  action,
  targetType,
  targetId,
  metadata = {},
  ip = ''
}: AuditLogParams) {
  try {
    const log = new AuditLog({
      actorId,
      actorType,
      actorName,
      action,
      targetType,
      targetId,
      metadata,
      ip
    });
    await log.save();
    console.log(`[AuditLog] logged: ${action} on ${targetType} by ${actorName}`);
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
