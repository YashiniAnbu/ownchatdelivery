import { Types } from 'mongoose';
import Org from '../models/Org';
import Rider from '../models/Rider';
import Delivery from '../models/Delivery';
import { IDelivery, IOrg, IRider, AssignmentStrategy, AssignmentStatus, Provider } from '../types';
import { calculateDistance } from './haversine';

// Socket notifier helper
let ioInstance: any = null;
export function setIOInstance(io: any) {
  ioInstance = io;
}

export function emitToOrg(orgId: string, event: string, data: any) {
  console.log(`[Socket.io] Emitting ${event} to org ${orgId}`, data);
  if (ioInstance) {
    ioInstance.to(orgId).emit(event, data);
  }
}

export function emitToDispatchers(orgId: string, event: string, data: any) {
  const room = `dispatchers_${orgId}`;
  console.log(`[Socket.io] Emitting ${event} to dispatchers room ${room}`, data);
  if (ioInstance) {
    ioInstance.to(room).emit(event, data);
  }
}

/**
 * Filters and retrieves the list of eligible riders for an organization
 */
export async function getEligibleRiders(orgId: string, org: IOrg, excludedRiderIds: string[] = []): Promise<IRider[]> {
  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider;
  
  return Rider.find({
    ownchatOrgId: orgId,
    _id: { $nin: excludedRiderIds },
    isActive: true,
    isOnDuty: true,
    'stats.activeDeliveries': { $lt: maxLoad }
  });
}

/**
 * Triggers external provider fallback dispatch
 */
export async function triggerExternalFallback(delivery: IDelivery, org: IOrg) {
  const provider = org.ownRiderConfig.fallbackProvider || 'porter';
  
  delivery.provider = provider;
  delivery.status = 'unassigned'; // or standard unassigned for external API integration
  delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
  delivery.ownRiderAssignment.riderId = null;
  delivery.ownRiderAssignment.riderName = null;
  delivery.ownRiderAssignment.riderPhone = null;
  
  await delivery.save();
  
  emitToOrg(org.id, 'own_rider_fallback_triggered', {
    orderId: delivery.id,
    fallbackProvider: provider,
    message: `No own riders available. Auto-fallback to ${provider} triggered.`
  });
}

/**
 * Core engine: analyzes active strategy and schedules assignment
 */
export async function assignRider(delivery: IDelivery): Promise<void> {
  try {
    const org = await Org.findById(delivery.ownchatOrgId);
    if (!org) {
      console.error(`Org ${delivery.ownchatOrgId} not found during assignment`);
      return;
    }

    const strategy = (delivery.ownRiderAssignment.assignmentStrategy || 
                      org.ownRiderConfig.assignmentStrategy || 
                      'manual') as AssignmentStrategy;

    delivery.ownRiderAssignment.assignmentStrategy = strategy;
    delivery.ownRiderAssignment.assignmentMode = 'auto';

    if (strategy === 'manual') {
      delivery.status = 'unassigned';
      delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
      await delivery.save();
      
      emitToOrg(org.id, 'own_rider_no_available', {
        orderId: delivery.id,
        message: 'Order created with manual strategy. Requires dispatcher allocation.',
        timestamp: new Date()
      });
      return;
    }

    const previouslyRejectedRiderIds = delivery.ownRiderAssignment.candidateQueue
      .filter(c => c.result === 'rejected' || c.result === 'timeout')
      .map(c => c.riderId.toString());

    // Run eligibility filtering
    let eligibleRiders = await getEligibleRiders(org.id, org, previouslyRejectedRiderIds);

    if (eligibleRiders.length === 0) {
      delivery.status = 'unassigned';
      delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
      await delivery.save();

      emitToOrg(org.id, 'own_rider_no_available', {
        orderId: delivery.id,
        message: 'No eligible riders available in the fleet.',
        timestamp: new Date()
      });

      if (org.ownRiderConfig.fallbackToExternalProvider) {
        await triggerExternalFallback(delivery, org);
      }
      return;
    }

    // Rank based on active strategy
    let rankedRiders: { rider: IRider; distanceKm: number | null }[] = [];

    if (strategy === 'nearest') {
      const pickupLat = delivery.pickup.latitude;
      const pickupLng = delivery.pickup.longitude;

      rankedRiders = eligibleRiders.map((rider) => {
        const riderLat = rider.lastKnownLocation?.latitude;
        const riderLng = rider.lastKnownLocation?.longitude;

        if (riderLat === null || riderLng === null || riderLat === undefined || riderLng === undefined) {
          return { rider, distanceKm: Infinity }; // No location, place last
        }

        const dist = calculateDistance(pickupLat, pickupLng, riderLat, riderLng);
        return { rider, distanceKm: dist };
      });

      rankedRiders.sort((a, b) => {
        if (a.distanceKm === Infinity && b.distanceKm === Infinity) return 0;
        if (a.distanceKm === Infinity) return 1;
        if (b.distanceKm === Infinity) return -1;
        return a.distanceKm! - b.distanceKm!;
      });
    } else if (strategy === 'round_robin') {
      rankedRiders = eligibleRiders.map((rider) => ({ rider, distanceKm: null }));
      rankedRiders.sort((a, b) => {
        const timeA = a.rider.lastAssignedAt ? a.rider.lastAssignedAt.getTime() : 0;
        const timeB = b.rider.lastAssignedAt ? b.rider.lastAssignedAt.getTime() : 0;
        return timeA - timeB; // Oldest goes first
      });
    } else if (strategy === 'load_balanced') {
      rankedRiders = eligibleRiders.map((rider) => ({ rider, distanceKm: null }));
      rankedRiders.sort((a, b) => {
        const loadA = a.rider.stats.activeDeliveries;
        const loadB = b.rider.stats.activeDeliveries;
        
        if (loadA !== loadB) {
          return loadA - loadB; // Fewest active orders first
        }
        
        const timeA = a.rider.lastAssignedAt ? a.rider.lastAssignedAt.getTime() : 0;
        const timeB = b.rider.lastAssignedAt ? b.rider.lastAssignedAt.getTime() : 0;
        return timeA - timeB; // Tie-break: round-robin
      });
    } else if (strategy === 'hybrid') {
      const pickupLat = delivery.pickup.latitude;
      const pickupLng = delivery.pickup.longitude;
      const W1 = parseFloat(process.env.WEIGHT_DISTANCE || '0.5');
      const W2 = parseFloat(process.env.WEIGHT_LOAD || '0.3');
      const W3 = parseFloat(process.env.WEIGHT_FAIRNESS || '0.2');
      const MAX_DECAY_HOURS = 4;
      const now = Date.now();

      const ridersWithDistance = eligibleRiders.map((rider) => {
        const rLat = rider.lastKnownLocation?.latitude;
        const rLng = rider.lastKnownLocation?.longitude;
        if (rLat === null || rLng === null || rLat === undefined || rLng === undefined) {
          return { rider, distanceKm: Infinity };
        }
        const dist = calculateDistance(pickupLat, pickupLng, rLat, rLng);
        return { rider, distanceKm: dist };
      });

      const validDistances = ridersWithDistance.map(r => r.distanceKm).filter((d): d is number => d !== Infinity && d !== null);
      const maxDist = validDistances.length > 0 ? Math.max(...validDistances, 0.001) : 1;

      const ridersWithScores = ridersWithDistance.map((item) => {
        const normalizedDistance = item.distanceKm === Infinity ? 1 : item.distanceKm / maxDist;
        const maxConcurrent = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
        const normalizedLoad = item.rider.stats.activeDeliveries / maxConcurrent;

        let roundRobinPenalty = 0;
        if (item.rider.lastAssignedAt) {
          const hoursSince = (now - new Date(item.rider.lastAssignedAt).getTime()) / (1000 * 60 * 60);
          roundRobinPenalty = Math.max(0, 1 - (hoursSince / MAX_DECAY_HOURS));
        }

        const score = (W1 * normalizedDistance) + (W2 * normalizedLoad) + (W3 * roundRobinPenalty);
        return { ...item, score };
      });

      ridersWithScores.sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        const timeA = a.rider.lastAssignedAt ? new Date(a.rider.lastAssignedAt).getTime() : 0;
        const timeB = b.rider.lastAssignedAt ? new Date(b.rider.lastAssignedAt).getTime() : 0;
        return timeA - timeB;
      });

      rankedRiders = ridersWithScores.map(item => ({ rider: item.rider, distanceKm: item.distanceKm }));
    }

    // Populate candidateQueue in the delivery document
    const newCandidates = rankedRiders.map((ranked) => ({
      riderId: ranked.rider._id as Types.ObjectId,
      distanceKm: ranked.distanceKm === Infinity ? null : ranked.distanceKm,
      attemptedAt: new Date(),
      result: 'pending' as const
    }));
    
    const pastQueue = delivery.ownRiderAssignment.candidateQueue.filter(c => c.result !== 'pending');
    delivery.ownRiderAssignment.candidateQueue = [...pastQueue, ...newCandidates];
    delivery.ownRiderAssignment.attemptCount = pastQueue.length;

    await tryNextCandidate(delivery, org);
  } catch (error) {
    console.error('Error during assignment engine execution:', error);
  }
}

/**
 * Attempts to assign the next candidate in the queue
 */
export async function tryNextCandidate(delivery: IDelivery, org: IOrg): Promise<void> {
  const queue = delivery.ownRiderAssignment.candidateQueue;
  const currentAttempt = delivery.ownRiderAssignment.attemptCount;

  if (currentAttempt >= queue.length) {
    // All candidates exhausted
    if (delivery.ownRiderAssignment.assignmentStrategy === 'manual') {
      const fallbackStrategy = (org.ownRiderConfig.assignmentStrategy && org.ownRiderConfig.assignmentStrategy !== 'manual') ? org.ownRiderConfig.assignmentStrategy : 'hybrid';
      console.log(`[Assignment Engine] Manual rider rejected. Falling back to ${fallbackStrategy} strategy for order ${delivery.id}`);
      delivery.ownRiderAssignment.assignmentStrategy = fallbackStrategy;
      delivery.ownRiderAssignment.assignmentMode = 'auto';
      await delivery.save();
      return assignRider(delivery);
    }

    delivery.status = 'unassigned';
    delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
    delivery.ownRiderAssignment.riderId = null;
    delivery.ownRiderAssignment.riderName = null;
    delivery.ownRiderAssignment.riderPhone = null;
    await delivery.save();

    emitToOrg(org.id, 'own_rider_manual_required', {
      orderId: delivery.id,
      message: 'All eligible assignment candidates have rejected or timed out.'
    });

    if (org.ownRiderConfig.fallbackToExternalProvider) {
      await triggerExternalFallback(delivery, org);
    }
    return;
  }

  const nextCandidate = queue[currentAttempt];
  const riderId = nextCandidate.riderId;

  // Atomic findOneAndUpdate check to lock rider
  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
  const rider = await Rider.findOneAndUpdate(
    { 
      _id: riderId, 
      isActive: true, 
      isOnDuty: true, 
      'stats.activeDeliveries': { $lt: maxLoad } 
    },
    {
      $set: { lastAssignedAt: new Date() },
      $inc: { 'stats.activeDeliveries': 1 }
    },
    { new: true }
  );

  if (rider) {
    rider.isAvailable = rider.stats.activeDeliveries < maxLoad;
    await rider.save();
  }

  if (!rider) {
    // Race condition: rider taken by another order or reached max load
    console.log(`[Race Condition] Rider ${riderId} unavailable or reached load limit. Advancing...`);
    nextCandidate.result = 'rejected';
    delivery.ownRiderAssignment.attemptCount += 1;
    await delivery.save();
    return tryNextCandidate(delivery, org);
  }

  // Claim successful, update delivery record. 
  // Set to pending so rider must manually accept or decline.
  nextCandidate.result = 'pending';
  delivery.status = 'pending';
  delivery.ownRiderAssignment.riderId = rider._id as Types.ObjectId;
  delivery.ownRiderAssignment.riderName = rider.name;
  delivery.ownRiderAssignment.riderPhone = rider.phone;
  delivery.ownRiderAssignment.assignedAt = new Date();
  delivery.ownRiderAssignment.acceptedAt = null;
  delivery.ownRiderAssignment.assignmentStatus = 'pending';
  delivery.ownRiderAssignment.attemptCount += 1;
  // delivery.milestones.riderAssignedAt is set upon actual acceptance

  await delivery.save();

  // Trigger Mock FCM Log and Socket Event
  console.log(`[Mock FCM Push] To Rider: ${rider.name} (Phone: ${rider.phone}, Token: ${rider.fcmToken || 'none'}). Order ID: ${delivery.id}`);
  
  emitToOrg(org.id, 'own_rider_assigned', {
    orderId: delivery.id,
    riderId: rider.id,
    riderName: rider.name,
    strategy: delivery.ownRiderAssignment.assignmentStrategy,
    attemptNum: delivery.ownRiderAssignment.attemptCount,
    timeoutSeconds: org.ownRiderConfig.riderAcceptanceTimeoutMinutes * 60
  });

  emitToDispatchers(org.id, 'order:assigned', {
    orderId: delivery.id,
    riderId: rider.id,
    riderName: rider.name
  });

  // Do not automatically emit acceptance; rider must accept.

  // Removed automatic simulation. Rider app will handle status updates.
}

/**
 * Handle manual assignment from dashboard
 */
export async function manuallyAssignRider(deliveryId: string, riderId: string, operatorId?: string): Promise<IDelivery | null> {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new Error('Delivery not found');

  const org = await Org.findById(delivery.ownchatOrgId);
  if (!org) throw new Error('Organization not found');

  // Perform manual override (no restrictions on duty or load)
  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
  const rider = await Rider.findOneAndUpdate(
    { 
      _id: riderId, 
      isActive: true 
    },
    {
      $set: { lastAssignedAt: new Date() },
      $inc: { 'stats.activeDeliveries': 1 }
    },
    { new: true }
  );

  if (!rider) {
    return null;
  }

  rider.isAvailable = rider.stats.activeDeliveries < maxLoad;
  await rider.save();

  // Release any previously pending/assigned rider
  if (delivery.ownRiderAssignment.riderId) {
    const prevRiderId = delivery.ownRiderAssignment.riderId;
    await Rider.findByIdAndUpdate(prevRiderId, {
      $set: { isAvailable: true },
      $inc: { 'stats.activeDeliveries': -1 }
    });
  }

  // Update Delivery with manual assignment details (pending acceptance)
  const now = new Date();
  const prevAttemptCount = delivery.ownRiderAssignment?.attemptCount || 0;
  const pastQueue = delivery.ownRiderAssignment?.candidateQueue?.filter(c => c.result !== 'pending') || [];
  
  delivery.status = 'pending';
  delivery.ownRiderAssignment = {
    riderId: rider._id as Types.ObjectId,
    riderName: rider.name,
    riderPhone: rider.phone,
    assignedAt: now,
    acceptedAt: null,
    rejectedAt: null,
    assignmentStatus: 'pending',
    assignmentStrategy: 'manual',
    assignmentMode: 'manual',
    assignedByOperatorId: operatorId ? new Types.ObjectId(operatorId) : null,
    candidateQueue: [...pastQueue, {
      riderId: rider._id as Types.ObjectId,
      distanceKm: null,
      attemptedAt: now,
      result: 'pending'
    }],
    attemptCount: pastQueue.length + 1
  } as any;
  // delivery.milestones.riderAssignedAt is set on actual acceptance

  await delivery.save();

  console.log(`[Mock FCM Push Manual] To Rider: ${rider.name}. Order ID: ${delivery.id} (Pending acceptance)`);

  emitToOrg(org.id, 'own_rider_assigned', {
    orderId: delivery.id,
    riderId: rider.id,
    riderName: rider.name,
    strategy: 'manual_override',
    attemptNum: delivery.ownRiderAssignment.attemptCount,
    timeoutSeconds: org.ownRiderConfig.riderAcceptanceTimeoutMinutes * 60
  });

  emitToDispatchers(org.id, 'order:assigned', {
    orderId: delivery.id,
    riderId: rider.id,
    riderName: rider.name
  });

  // Removed automatic simulation. Rider app will handle status updates.

  return delivery;
}
export function simulateOrderLifecycleToPicked(deliveryId: string, orgId: string) {
  const steps = [
    { status: 'at_pickup', delay: 5000 },
    { status: 'picked', delay: 10000 }
  ];

  steps.forEach(({ status, delay }) => {
    setTimeout(async () => {
      try {
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery || delivery.status === 'cancelled' || delivery.status === 'delivered') return;
        
        if (status === 'at_pickup') {
          delivery.status = 'at_pickup';
          delivery.milestones.atPickupAt = new Date();
          
          if (delivery.ownRiderAssignment?.riderId) {
            const rider = await Rider.findByIdAndUpdate(delivery.ownRiderAssignment.riderId, {
              $set: { 
                'lastKnownLocation.latitude': delivery.pickup.latitude,
                'lastKnownLocation.longitude': delivery.pickup.longitude
              }
            }, { new: true });
            if (rider) {
              emitToOrg(orgId, 'rider:location_update', {
                riderId: rider.id,
                latitude: rider.lastKnownLocation.latitude,
                longitude: rider.lastKnownLocation.longitude
              });
            }
          }
        } else if (status === 'picked') {
          delivery.status = 'picked';
          delivery.milestones.pickedAt = new Date();
        }
        await delivery.save();
        
        emitToOrg(orgId, 'delivery_status_updated', {
          orderId: delivery.id,
          status,
          timestamp: new Date()
        });
      } catch (err) {
        console.error('[Sim] Error simulating order lifecycle to picked:', err);
      }
    }, delay);
  });
}

/**
 * Simulate order moving through stages for demo purposes
 */
export function simulateOrderLifecycle(deliveryId: string, orgId: string) {
  const steps = [
    { status: 'at_pickup', delay: 5000 },
    { status: 'picked', delay: 10000 },
    { status: 'delivered', delay: 15000 }
  ];

  steps.forEach(({ status, delay }) => {
    setTimeout(async () => {
      try {
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery || delivery.status === 'cancelled' || delivery.status === 'delivered') return;
        
        if (status === 'at_pickup') {
          delivery.status = 'at_pickup';
          delivery.milestones.atPickupAt = new Date();
          
          if (delivery.ownRiderAssignment?.riderId) {
            const rider = await Rider.findByIdAndUpdate(delivery.ownRiderAssignment.riderId, {
              $set: { 
                'lastKnownLocation.latitude': delivery.pickup.latitude,
                'lastKnownLocation.longitude': delivery.pickup.longitude
              }
            }, { new: true });
            if (rider) {
              emitToOrg(orgId, 'rider:location_update', {
                riderId: rider.id,
                latitude: rider.lastKnownLocation.latitude,
                longitude: rider.lastKnownLocation.longitude
              });
            }
          }
        } else if (status === 'picked') {
          delivery.status = 'picked';
          delivery.milestones.pickedAt = new Date();
        } else if (status === 'delivered') {
          delivery.status = 'delivered';
          delivery.milestones.deliveredAt = new Date();
          
          if (delivery.ownRiderAssignment?.riderId) {
            const rider = await Rider.findByIdAndUpdate(delivery.ownRiderAssignment.riderId, {
              $set: { 
                isAvailable: true,
                'lastKnownLocation.latitude': delivery.drop.latitude,
                'lastKnownLocation.longitude': delivery.drop.longitude
              },
              $inc: { 'stats.activeDeliveries': -1, 'stats.totalDeliveries': 1 }
            }, { new: true });
            if (rider) {
              emitToOrg(orgId, 'rider:location_update', {
                riderId: rider.id,
                latitude: rider.lastKnownLocation.latitude,
                longitude: rider.lastKnownLocation.longitude
              });
            }
          }
        }
        await delivery.save();
        
        emitToOrg(orgId, 'delivery_status_updated', {
          orderId: delivery.id,
          status,
          timestamp: new Date()
        });
      } catch (err) {
        console.error('[Sim] Error simulating order lifecycle:', err);
      }
    }, delay);
  });
}
