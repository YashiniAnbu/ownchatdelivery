import cron from 'node-cron';
import Delivery from '../models/Delivery';
import Org from '../models/Org';
import Rider from '../models/Rider';
import { tryNextCandidate, assignRider, emitToOrg } from '../services/assignmentEngine';

export function startAssignmentWorker() {
  console.log('[Worker] Starting Rider Assignment background cron worker (running every 1 minute)...');

  cron.schedule('*/1 * * * *', async () => {
    console.log('[Worker] Running periodic sweep jobs...');
    try {
      await recoverAcceptanceTimeouts();
      await retryUnassignedDeliveries();
    } catch (err) {
      console.error('[Worker Error] Error running background workers:', err);
    }
  });
}

/**
 * Sweeps for pending riders who haven't accepted within their organization's SLA timeout limit
 */
async function recoverAcceptanceTimeouts() {
  const pendingDeliveries = await Delivery.find({
    provider: 'own_rider',
    status: 'pending',
    'ownRiderAssignment.assignmentStatus': 'pending'
  });

  const now = new Date();

  for (const delivery of pendingDeliveries) {
    try {
      const org = await Org.findById(delivery.ownchatOrgId);
      if (!org) continue;

      const timeoutMinutes = org.ownRiderConfig.riderAcceptanceTimeoutMinutes || 5;
      const assignedAt = delivery.ownRiderAssignment.assignedAt;

      if (!assignedAt) continue;

      const elapsedMs = now.getTime() - new Date(assignedAt).getTime();
      const timeoutMs = timeoutMinutes * 60 * 1000;

      if (elapsedMs >= timeoutMs) {
        console.log(`[Worker] Assignment timed out for order ${delivery.id} with rider ${delivery.ownRiderAssignment.riderName}`);
        
        const timedOutRiderId = delivery.ownRiderAssignment.riderId;

        // Release the rider
        if (timedOutRiderId) {
          await Rider.findByIdAndUpdate(timedOutRiderId, {
            $set: { isAvailable: true },
            $inc: { 'stats.activeDeliveries': -1 }
          });
        }

        // Mark the candidate queue slot as timed out
        const candidate = delivery.ownRiderAssignment.candidateQueue.find(
          (c) => c.riderId.toString() === (timedOutRiderId?.toString() || '')
        );
        if (candidate) {
          candidate.result = 'timeout';
        }

        delivery.ownRiderAssignment.assignmentStatus = 'timeout';
        await delivery.save();

        emitToOrg(org.id, 'own_rider_timeout', {
          orderId: delivery.id,
          riderId: timedOutRiderId,
          riderName: delivery.ownRiderAssignment.riderName,
          attemptNum: delivery.ownRiderAssignment.attemptCount,
          message: `SLA Timeout breached for Order #${delivery.id.substring(18)}. Rider ${delivery.ownRiderAssignment.riderName || 'unknown'} did not accept in time.`
        });

        // Try the next candidate in line
        await tryNextCandidate(delivery, org);
      }
    } catch (err) {
      console.error(`[Worker Error] Failed to recover timeout for delivery ${delivery.id}:`, err);
    }
  }
}

/**
 * Re-runs assignment strategy for unassigned orders that may now have available riders
 */
async function retryUnassignedDeliveries() {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);

  // Find deliveries created between 1 and 30 minutes ago that remain unassigned
  const unassignedDeliveries = await Delivery.find({
    provider: 'own_rider',
    status: 'unassigned',
    'ownRiderAssignment.assignmentStatus': 'unassigned',
    createdAt: { $gte: thirtyMinutesAgo, $lte: oneMinuteAgo }
  });

  for (const delivery of unassignedDeliveries) {
    try {
      const org = await Org.findById(delivery.ownchatOrgId);
      if (!org) continue;

      // Skip manual assignment strategy orgs (they always wait for operator input)
      const strategy = delivery.ownRiderAssignment.assignmentStrategy || org.ownRiderConfig.assignmentStrategy;
      if (strategy === 'manual') continue;

      console.log(`[Worker] Retrying auto-assignment for stale order ${delivery.id}...`);
      await assignRider(delivery);
    } catch (err) {
      console.error(`[Worker Error] Failed to retry assignment for delivery ${delivery.id}:`, err);
    }
  }
}
