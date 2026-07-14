import cron from 'node-cron';
import Delivery from '../models/Delivery';
import RiderLoadScore from '../models/RiderLoadScore';
import Rider from '../models/Rider';
import TripLocationHistory from '../models/TripLocationHistory';
import ZoneDistanceMatrix from '../models/ZoneDistanceMatrix';
import TrafficMultiplier from '../models/TrafficMultiplier';
import ngeohash from 'ngeohash';
import redisClient, { isRedisReady } from '../config/redis';
import { assignRider } from '../services/assignmentEngine';

export function startCronJobs() {
  console.log('[Cron] Starting background jobs...');

  // 1. Stale rider cleanup - every 1 min
  cron.schedule('* * * * *', async () => {
    try {
      if (!isRedisReady()) {
        return; // Skip silently if Redis is not available
      }
      const allRiders = await redisClient.zrange('riders:locations', 0, -1);
      for (const riderId of allRiders) {
        const isSeen = await redisClient.get(`rider:last_seen:${riderId}`);
        if (!isSeen) {
          await redisClient.zrem('riders:locations', riderId);
          console.log(`[Cron] Removed stale rider ${riderId} from GEO index`);
          
          // Connection Lost Trigger
          const activeDelivery = await Delivery.findOne({
             'ownRiderAssignment.riderId': riderId,
             status: { $in: ['RIDER_EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRIP'] }
          });
          if (activeDelivery) {
             const { emitToOrg } = require('../services/assignmentEngine');
             // We need to emit to socket. We can't import `io` easily here, but we can use assignmentEngine's `ioInstance` indirectly or emit a global event.
             // Actually `emitToOrg` is not quite what we want, we want to emit to the trip channel. 
             // Let's create an `emitToTrip` in assignmentEngine to keep it clean.
             const { emitToTrip } = require('../services/assignmentEngine');
             emitToTrip(activeDelivery.id.toString(), 'trip:connection_lost', {
                 riderId,
                 message: 'Connection lost with rider. Waiting for reconnect...',
                 timestamp: new Date()
             });
             console.log(`[Cron] Emitted connection_lost for trip ${activeDelivery.id}`);
          }
        }
      }
    } catch (err) {
      console.error('[Cron] Stale rider cleanup error:', err);
    }
  });

  // 2. Rider load score recalculation - every 2 min
  cron.schedule('*/2 * * * *', async () => {
    try {
      const activeRiders = await Rider.find({ isActive: true });
      for (const rider of activeRiders) {
        await RiderLoadScore.findOneAndUpdate(
          { riderId: rider._id },
          { 
            active_trip_count: rider.stats?.activeDeliveries || 0,
            last_calculated_at: new Date()
          },
          { upsert: true }
        );
      }
    } catch (err) {
      console.error('[Cron] Load score error:', err);
    }
  });

  // 3. Zone distance matrix refresh - daily
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Refreshing zone distance matrix...');
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const completedDeliveries = await Delivery.find({
        status: 'COMPLETED',
        'milestones.pickedAt': { $exists: true },
        'milestones.deliveredAt': { $exists: true },
        updatedAt: { $gte: yesterday }
      });

      for (const delivery of completedDeliveries) {
        if (!delivery.pickup?.latitude || !delivery.drop?.latitude) continue;
        if (!delivery.milestones?.pickedAt || !delivery.milestones?.deliveredAt) continue;
        
        const originZone = ngeohash.encode(delivery.pickup.latitude, delivery.pickup.longitude, 5);
        const destZone = ngeohash.encode(delivery.drop.latitude, delivery.drop.longitude, 5);
        
        const actualDurationSeconds = (delivery.milestones.deliveredAt.getTime() - delivery.milestones.pickedAt.getTime()) / 1000;
        const actualDistanceMeters = delivery.cost || 0; // simplified fallback: assuming cost correlates or storing distance is needed.
        
        const matrixEntry = await ZoneDistanceMatrix.findOne({ origin_zone: originZone, destination_zone: destZone });
        if (matrixEntry) {
          // moving average
          matrixEntry.average_duration_seconds = Math.round((matrixEntry.average_duration_seconds * matrixEntry.sample_size + actualDurationSeconds) / (matrixEntry.sample_size + 1));
          matrixEntry.average_distance_meters = Math.round((matrixEntry.average_distance_meters * matrixEntry.sample_size + actualDistanceMeters) / (matrixEntry.sample_size + 1));
          matrixEntry.sample_size += 1;
          matrixEntry.last_updated = new Date();
          await matrixEntry.save();
        } else {
          await ZoneDistanceMatrix.create({
            origin_zone: originZone,
            destination_zone: destZone,
            average_duration_seconds: actualDurationSeconds,
            average_distance_meters: actualDistanceMeters || 0,
            sample_size: 1
          });
        }
      }
    } catch (err) {
      console.error('[Cron] Zone distance matrix error:', err);
    }
  });

  // 4. Traffic multiplier aggregation - every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Aggregating traffic multipliers...');
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentDeliveries = await Delivery.find({
        status: 'COMPLETED',
        'milestones.pickedAt': { $exists: true },
        'milestones.deliveredAt': { $exists: true },
        updatedAt: { $gte: oneHourAgo }
      });
      
      const hour = new Date().getHours();
      const day = new Date().getDay();
      
      let totalRatio = 0;
      let count = 0;
      
      for (const delivery of recentDeliveries) {
         const pickedAt = delivery.milestones?.pickedAt?.getTime() || 0;
         const deliveredAt = delivery.milestones?.deliveredAt?.getTime() || 0;
         const actualDuration = (deliveredAt - pickedAt) / 1000;
         
         const estimatedDuration = delivery.estimated_duration; // Assuming this exists or falls back
         if (estimatedDuration && estimatedDuration > 0 && actualDuration > 0) {
            const ratio = actualDuration / estimatedDuration;
            // Cap ratio to avoid crazy outliers
            if (ratio > 0.1 && ratio < 10) {
                totalRatio += ratio;
                count++;
            }
         }
      }
      
      if (count > 0) {
         const averageRatio = totalRatio / count;
         const trafficMultiplier = await TrafficMultiplier.findOne({ hour_of_day: hour, day_of_week: day });
         if (trafficMultiplier) {
            // Blend 20% of new ratio with 80% of historical
            trafficMultiplier.multiplier = (trafficMultiplier.multiplier * 0.8) + (averageRatio * 0.2);
            trafficMultiplier.sample_size += count;
            trafficMultiplier.last_updated = new Date();
            await trafficMultiplier.save();
         } else {
            await TrafficMultiplier.create({
               hour_of_day: hour,
               day_of_week: day,
               multiplier: averageRatio,
               sample_size: count
            });
         }
      }
    } catch (err) {
      console.error('[Cron] Traffic multiplier error:', err);
    }
  });

  // 5. Trip breadcrumb archival - daily (purge old records)
  cron.schedule('0 3 * * *', async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await TripLocationHistory.deleteMany({ recorded_at: { $lt: thirtyDaysAgo } });
      console.log('[Cron] Purged old trip breadcrumbs.');
    } catch (err) {
       console.error('[Cron] Breadcrumb archival error:', err);
    }
  });

  // 6. Stale "ASSIGNED" trip detection and auto-reassignment trigger - every 30 sec
  cron.schedule('*/30 * * * * *', async () => {
    try {
      // 2 minutes timeout for acceptance
      const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
      const staleDeliveries = await Delivery.find({
        status: 'ASSIGNED',
        'ownRiderAssignment.assignedAt': { $lt: twoMinsAgo },
        'ownRiderAssignment.assignmentMode': 'auto'
      });

      for (const delivery of staleDeliveries) {
        console.log(`[Cron] Auto-reassigning stale delivery ${delivery.id}`);
        
        if (delivery.ownRiderAssignment.riderId) {
           await Rider.findByIdAndUpdate(delivery.ownRiderAssignment.riderId, {
             $set: { isAvailable: true },
             $inc: { 'stats.activeDeliveries': -1 }
           });
        }
        
        const queue = delivery.ownRiderAssignment.candidateQueue;
        if (queue.length > 0) {
           queue[queue.length - 1].result = 'timeout';
        }

        delivery.status = 'unassigned';
        delivery.ownRiderAssignment.riderId = null;
        delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
        await delivery.save();
        
        assignRider(delivery);
      }
    } catch (err) {
      console.error('[Cron] Stale trip detection error:', err);
    }
  });
}
