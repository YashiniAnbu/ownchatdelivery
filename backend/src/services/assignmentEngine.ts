import { Types } from 'mongoose';
import Org from '../models/Org';
import Rider from '../models/Rider';
import Delivery from '../models/Delivery';
import RiderLoadScore from '../models/RiderLoadScore';
import RoundRobinState from '../models/RoundRobinState';
import { getNearbyRiders } from './redisGeoService';
import { isRedisReady } from '../config/redis';
import { getDistanceMatrix } from './distanceMatrixService';
import { getPrecalculatedEstimate } from './precalcService';
import { calculateDistance } from './haversine';
import { IDelivery, IOrg, IRider, AssignmentStrategy } from '../types';

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

export function emitToTrip(tripId: string, event: string, data: any) {
  const room = `trip:${tripId}`;
  console.log(`[Socket.io] Emitting ${event} to trip room ${room}`, data);
  if (ioInstance) {
    ioInstance.to(room).emit(event, data);
  }
}

export async function getShortlistedRiders(orgId: string, org: IOrg, pickupLat: number, pickupLng: number, excludedRiderIds: string[] = []): Promise<{ rider: IRider, distanceRedisKm: number }[]> {
  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
  const searchRadiusKm = 5000; // Large radius for testing

  // ── Strategy 1: Try Redis GEOSEARCH first (fast path) ──
  let nearby: { riderId: string; distance: number }[] = [];
  try {
    if (isRedisReady()) {
      nearby = await getNearbyRiders(pickupLat, pickupLng, searchRadiusKm);
      console.log(`[Assignment] Redis GEOSEARCH returned ${nearby.length} riders`);
    } else {
      console.warn('[Assignment] Redis not ready, skipping GEOSEARCH');
    }
  } catch (err) {
    console.warn('[Assignment] Redis GEOSEARCH failed, falling back to MongoDB:', (err as Error).message);
  }

  if (nearby.length > 0) {
    const candidateIds = nearby
      .filter(n => !excludedRiderIds.includes(n.riderId))
      .map(n => n.riderId);

    const riders = await Rider.find({
      ownchatOrgId: orgId,
      _id: { $in: candidateIds },
      isActive: true,
      isOnDuty: true,
      'stats.activeDeliveries': { $lt: maxLoad }
    });

    if (riders.length > 0) {
      return riders.map(rider => {
        const geoInfo = nearby.find(n => n.riderId === rider.id.toString());
        return {
          rider,
          distanceRedisKm: geoInfo ? geoInfo.distance : Infinity
        };
      });
    }
  }

  // ── Strategy 2: MongoDB fallback (when Redis is empty/down) ──
  console.log('[Assignment] Using MongoDB fallback to find eligible riders');
  const riders = await Rider.find({
    ownchatOrgId: orgId,
    isActive: true,
    isOnDuty: true,
    'stats.activeDeliveries': { $lt: maxLoad },
    _id: { $nin: excludedRiderIds }
  });

  return riders.map(rider => {
    let distKm = Infinity;
    if (rider.lastKnownLocation?.latitude && rider.lastKnownLocation?.longitude) {
      distKm = calculateDistance(
        pickupLat, pickupLng,
        rider.lastKnownLocation.latitude,
        rider.lastKnownLocation.longitude
      );
    }
    return { rider, distanceRedisKm: distKm };
  }).sort((a, b) => a.distanceRedisKm - b.distanceRedisKm);
}

export async function getEligibleRiders(orgId: string, org: IOrg): Promise<IRider[]> {
  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
  return await Rider.find({
    ownchatOrgId: orgId,
    isActive: true,
    isOnDuty: true,
    'stats.activeDeliveries': { $lt: maxLoad }
  });
}

export async function triggerExternalFallback(delivery: IDelivery, org: IOrg) {
  const provider = org.ownRiderConfig.fallbackProvider || 'porter';
  
  delivery.provider = provider;
  delivery.status = 'unassigned';
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

    let shortlisted = await getShortlistedRiders(org.id, org, delivery.pickup.latitude, delivery.pickup.longitude, previouslyRejectedRiderIds);

    if (shortlisted.length === 0) {
      delivery.status = 'unassigned';
      delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
      await delivery.save();

      emitToOrg(org.id, 'own_rider_no_available', {
        orderId: delivery.id,
        message: 'No eligible riders available in the fleet near pickup.',
        timestamp: new Date()
      });

      if (org.ownRiderConfig.fallbackToExternalProvider) {
        await triggerExternalFallback(delivery, org);
      }
      return;
    }

    let rankedRiders: { rider: IRider; distanceKm: number | null, eta?: number | null }[] = [];

    if (strategy === 'nearest') {
      const origins = shortlisted.map(s => ({
        lat: s.rider.lastKnownLocation?.latitude || 0,
        lng: s.rider.lastKnownLocation?.longitude || 0
      }));
      const dest = { lat: delivery.pickup.latitude, lng: delivery.pickup.longitude };
      
      try {
        const matrixResults = await getDistanceMatrix(origins, dest);
        rankedRiders = shortlisted.map((s, idx) => ({
          rider: s.rider,
          distanceKm: s.distanceRedisKm,
          eta: matrixResults[idx]?.duration_in_traffic?.value || null
        })).sort((a, b) => (a.eta || Infinity) - (b.eta || Infinity));
      } catch (err) {
        console.error('Distance Matrix failed, falling back to precalc/GEO distance', err);
        
        const rankedWithPrecalc = await Promise.all(shortlisted.map(async (s) => {
          const originLat = s.rider.lastKnownLocation?.latitude || 0;
          const originLng = s.rider.lastKnownLocation?.longitude || 0;
          const precalc = await getPrecalculatedEstimate(originLat, originLng, dest.lat, dest.lng);
          return {
            rider: s.rider,
            distanceKm: s.distanceRedisKm,
            eta: precalc ? precalc.duration_seconds : (s.distanceRedisKm * 100) // Rough fallback
          };
        }));
        
        rankedRiders = rankedWithPrecalc.sort((a, b) => a.eta - b.eta)
                                        .map(r => ({ rider: r.rider, distanceKm: r.distanceKm }));
      }
    } else if (strategy === 'round_robin') {
      const roundRobinState = await RoundRobinState.findOne({ zone_id: org.id });
      const lastAssignedId = roundRobinState?.last_assigned_rider_id?.toString();
      
      rankedRiders = shortlisted.map(s => ({ rider: s.rider, distanceKm: s.distanceRedisKm, eta: null }));
      rankedRiders.sort((a, b) => {
        const timeA = a.rider.lastAssignedAt ? a.rider.lastAssignedAt.getTime() : 0;
        const timeB = b.rider.lastAssignedAt ? b.rider.lastAssignedAt.getTime() : 0;
        return timeA - timeB;
      });
      
      if (lastAssignedId) {
        const lastIdx = rankedRiders.findIndex(r => r.rider.id.toString() === lastAssignedId);
        if (lastIdx !== -1) {
          const shifted = rankedRiders.splice(0, lastIdx + 1);
          rankedRiders = [...rankedRiders, ...shifted];
        }
      }
    } else if (strategy === 'load_balanced') {
      const loadScores = await RiderLoadScore.find({ riderId: { $in: shortlisted.map(s => s.rider._id) } });
      const scoreMap = new Map(loadScores.map(ls => [ls.riderId.toString(), ls.active_trip_count]));

      rankedRiders = shortlisted.map(s => ({ rider: s.rider, distanceKm: s.distanceRedisKm }));
      
      const origins = shortlisted.map(s => ({
        lat: s.rider.lastKnownLocation?.latitude || 0,
        lng: s.rider.lastKnownLocation?.longitude || 0
      }));
      const dest = { lat: delivery.pickup.latitude, lng: delivery.pickup.longitude };
      let matrixResults: any[] = [];
      try {
        matrixResults = await getDistanceMatrix(origins, dest);
      } catch (err) {
        console.error('Distance Matrix failed in load_balanced, using precalc/GEO');
      }

      const rankedWithScores = await Promise.all(rankedRiders.map(async (item, idx) => {
        let eta = matrixResults[idx]?.duration_in_traffic?.value;
        if (!eta) {
           const originLat = item.rider.lastKnownLocation?.latitude || 0;
           const originLng = item.rider.lastKnownLocation?.longitude || 0;
           const precalc = await getPrecalculatedEstimate(originLat, originLng, dest.lat, dest.lng);
           eta = precalc ? precalc.duration_seconds : ((item.distanceKm || 1) * 100);
        }
        
        const load = scoreMap.get(item.rider.id.toString()) || 0;
        const score = (eta * 0.4) + (load * 0.6); // basic weighted score
        return { ...item, score };
      }));
      
      rankedWithScores.sort((a, b) => a.score - b.score);
      rankedRiders = rankedWithScores.map(r => ({ rider: r.rider, distanceKm: r.distanceKm, eta: r.eta }));
    } else {
      // Hybrid strategy - use robust scoring system
      const loadScores = await RiderLoadScore.find({ riderId: { $in: shortlisted.map(s => s.rider._id) } });
      const scoreMap = new Map(loadScores.map(ls => [ls.riderId.toString(), ls.active_trip_count]));

      const origins = shortlisted.map(s => ({
        lat: s.rider.lastKnownLocation?.latitude || 0,
        lng: s.rider.lastKnownLocation?.longitude || 0
      }));
      const dest = { lat: delivery.pickup.latitude, lng: delivery.pickup.longitude };
      
      let matrixResults: any[] = [];
      try {
        matrixResults = await getDistanceMatrix(origins, dest);
      } catch (err) {
        console.error('Distance Matrix failed in hybrid, using precalc/GEO');
      }

      const rankedWithScores = await Promise.all(shortlisted.map(async (item, idx) => {
        let eta = matrixResults[idx]?.duration_in_traffic?.value;
        if (!eta) {
           const originLat = item.rider.lastKnownLocation?.latitude || 0;
           const originLng = item.rider.lastKnownLocation?.longitude || 0;
           const precalc = await getPrecalculatedEstimate(originLat, originLng, dest.lat, dest.lng);
           eta = precalc ? precalc.duration_seconds : ((item.distanceRedisKm || 1) * 100);
        }
        
        const load = scoreMap.get(item.rider.id.toString()) || 0;
        const distanceScore = eta * 0.4;
        const loadScoreCalc = load * 60 * 0.6; // Scale load appropriately
        const fairnessScore = item.rider.lastAssignedAt ? (Date.now() - item.rider.lastAssignedAt.getTime()) / 60000 : 0; // minutes since last assigned
  
        const totalScore = distanceScore + loadScoreCalc - (fairnessScore * 0.1); // lower is better
        
        return { rider: item.rider, distanceKm: item.distanceRedisKm, eta, score: totalScore };
      }));
      
      rankedWithScores.sort((a, b) => a.score - b.score);
      rankedRiders = rankedWithScores.map(r => ({ rider: r.rider, distanceKm: r.distanceKm, eta: r.eta }));
    }

    const newCandidates = rankedRiders.map((ranked) => ({
      riderId: ranked.rider._id as Types.ObjectId,
      distanceKm: ranked.distanceKm === Infinity ? null : ranked.distanceKm,
      etaSeconds: ranked.eta || null,
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

export async function tryNextCandidate(delivery: IDelivery, org: IOrg): Promise<void> {
  const queue = delivery.ownRiderAssignment.candidateQueue;
  const currentAttempt = delivery.ownRiderAssignment.attemptCount;

  if (currentAttempt >= queue.length) {
    if (delivery.ownRiderAssignment.assignmentStrategy === 'manual') {
      const fallbackStrategy = (org.ownRiderConfig.assignmentStrategy && org.ownRiderConfig.assignmentStrategy !== 'manual') ? org.ownRiderConfig.assignmentStrategy : 'nearest';
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
    console.log(`[Race Condition] Rider ${riderId} unavailable or reached load limit. Advancing...`);
    nextCandidate.result = 'rejected';
    delivery.ownRiderAssignment.attemptCount += 1;
    await delivery.save();
    return tryNextCandidate(delivery, org);
  }

  if (delivery.ownRiderAssignment.assignmentStrategy === 'round_robin') {
    await RoundRobinState.findOneAndUpdate(
      { zone_id: org.id },
      { last_assigned_rider_id: rider._id },
      { upsert: true }
    );
  }

  nextCandidate.result = 'pending';
  delivery.status = 'ASSIGNED'; // Updated to new status from prompt
  delivery.ownRiderAssignment.riderId = rider._id as Types.ObjectId;
  delivery.ownRiderAssignment.riderName = rider.name;
  delivery.ownRiderAssignment.riderPhone = rider.phone;
  delivery.ownRiderAssignment.assignedAt = new Date();
  delivery.ownRiderAssignment.acceptedAt = null;
  delivery.ownRiderAssignment.assignmentStatus = 'pending';
  delivery.ownRiderAssignment.attemptCount += 1;
  delivery.estimated_duration = nextCandidate.etaSeconds || undefined;
  delivery.estimated_distance = nextCandidate.distanceKm ? nextCandidate.distanceKm * 1000 : undefined;

  await delivery.save();

  console.log(`[Mock FCM Push] To Rider: ${rider.name}. Order ID: ${delivery.id}`);
  
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
}

export async function manuallyAssignRider(deliveryId: string, riderId: string, operatorId?: string): Promise<IDelivery | null> {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new Error('Delivery not found');

  const org = await Org.findById(delivery.ownchatOrgId);
  if (!org) throw new Error('Organization not found');

  const maxLoad = org.ownRiderConfig.maxConcurrentOrdersPerRider || 3;
  const rider = await Rider.findOneAndUpdate(
    { _id: riderId, isActive: true },
    {
      $set: { lastAssignedAt: new Date() },
      $inc: { 'stats.activeDeliveries': 1 }
    },
    { new: true }
  );

  if (!rider) return null;

  rider.isAvailable = rider.stats.activeDeliveries < maxLoad;
  await rider.save();

  if (delivery.ownRiderAssignment.riderId) {
    const prevRiderId = delivery.ownRiderAssignment.riderId;
    await Rider.findByIdAndUpdate(prevRiderId, {
      $set: { isAvailable: true },
      $inc: { 'stats.activeDeliveries': -1 }
    });
  }

  const now = new Date();
  const pastQueue = delivery.ownRiderAssignment?.candidateQueue?.filter(c => c.result !== 'pending') || [];
  
  delivery.status = 'ASSIGNED'; // Updated to new status from prompt
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

  return delivery;
}

export function simulateOrderLifecycle(deliveryId: string, orgId: string) {
  // removed simulation for brevity and because prompt needs actual transitions
}

export async function reevaluateUnassignedOrders(orgId: string) {
  try {
    const pendingDeliveries = await Delivery.find({
      ownchatOrgId: orgId,
      status: 'unassigned',
      provider: 'own_rider'
    });
    
    for (const delivery of pendingDeliveries) {
      if (delivery.ownRiderAssignment?.assignmentStatus === 'pending') {
        continue;
      }
      
      console.log(`[Assignment Engine] Rider update triggered auto-assignment for order ${delivery.id}`);
      // Wait a short moment to allow DB transactions to settle before re-assigning
      setTimeout(() => assignRider(delivery), 100);
    }
  } catch (err) {
    console.error('Error in reevaluateUnassignedOrders:', err);
  }
}
