import cron from 'node-cron';
import Delivery from '../models/Delivery';
import Org from '../models/Org';
import { emitToOrg } from '../services/assignmentEngine';

export function startSlaWorker() {
  console.log('[Worker] Starting SLA Monitoring background cron worker (running every 1 minute)...');

  cron.schedule('*/1 * * * *', async () => {
    try {
      await checkSlaBreaches();
    } catch (err) {
      console.error('[Worker Error] Error running SLA worker:', err);
    }
  });
}

async function checkSlaBreaches() {
  const activeDeliveries = await Delivery.find({
    status: { $nin: ['delivered', 'cancelled'] },
    slaBreached: false
  });

  const now = new Date();

  for (const delivery of activeDeliveries) {
    try {
      const org = await Org.findById(delivery.ownchatOrgId);
      if (!org) continue;

      const { riderAcceptanceTimeoutMinutes, pickupTimeoutMinutes, deliveryTimeoutMinutes } = org.ownRiderConfig;
      let breached = false;
      let reason = '';

      if (delivery.status === 'unassigned' || delivery.status === 'pending') {
        // Assignment SLA check
        const elapsedMinutes = (now.getTime() - delivery.createdAt.getTime()) / (1000 * 60);
        if (riderAcceptanceTimeoutMinutes && elapsedMinutes > riderAcceptanceTimeoutMinutes) {
          breached = true;
          reason = 'assignment';
        }
      } else if (delivery.status === 'rider_assigned' || delivery.status === 'at_pickup') {
        // Pickup SLA check
        const acceptedAt = delivery.ownRiderAssignment?.acceptedAt || delivery.ownRiderAssignment?.assignedAt;
        if (acceptedAt) {
          const elapsedMinutes = (now.getTime() - new Date(acceptedAt).getTime()) / (1000 * 60);
          if (pickupTimeoutMinutes && elapsedMinutes > pickupTimeoutMinutes) {
            breached = true;
            reason = 'pickup';
          }
        }
      } else if (delivery.status === 'picked') {
        // Delivery SLA check
        const pickedAt = delivery.milestones?.pickedAt;
        if (pickedAt) {
          const elapsedMinutes = (now.getTime() - new Date(pickedAt).getTime()) / (1000 * 60);
          if (deliveryTimeoutMinutes && elapsedMinutes > deliveryTimeoutMinutes) {
            breached = true;
            reason = 'delivery';
          }
        }
      }

      if (breached) {
        console.log(`[SLA Worker] Order ${delivery.id} breached SLA for ${reason}.`);
        delivery.slaBreached = true;
        await delivery.save();
        
        emitToOrg(org.id, 'delivery_status_updated', {
          orderId: delivery.id,
          status: delivery.status,
          timestamp: new Date()
        });
      }
    } catch (err) {
      console.error(`[SLA Worker] Error checking delivery ${delivery.id}:`, err);
    }
  }
}
