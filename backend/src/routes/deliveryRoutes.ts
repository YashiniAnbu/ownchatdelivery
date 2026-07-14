import { Router, Request, Response } from 'express';
import Delivery from '../models/Delivery';
import Org from '../models/Org';
import Rider from '../models/Rider';
import { assignRider, emitToOrg, getShortlistedRiders } from '../services/assignmentEngine';
import { getDistanceMatrix } from '../services/distanceMatrixService';
import RiderLoadScore from '../models/RiderLoadScore';
import { logAudit } from '../services/auditLogger';
import { resolveAddress, resolveMapsUrl } from '../services/locationService';
import { getPrecalculatedEstimate } from '../services/precalcService';

const router = Router();

// Section 1 & 2: Resolve Location
router.post('/resolve-location', async (req: Request, res: Response) => {
  try {
    const { address, mapsUrl } = req.body;
    let result;
    if (mapsUrl) {
      result = await resolveMapsUrl(mapsUrl);
    } else if (address) {
      result = await resolveAddress(address);
    } else {
      return res.status(400).json({ error: 'Provide address or mapsUrl' });
    }
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Live ETA via Distance Matrix API
router.get('/eta', async (req: Request, res: Response) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;
    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }
    const oLat = parseFloat(originLat as string);
    const oLng = parseFloat(originLng as string);
    const dLat = parseFloat(destLat as string);
    const dLng = parseFloat(destLng as string);

    const matrix = await getDistanceMatrix([{ lat: oLat, lng: oLng }], { lat: dLat, lng: dLng });
    if (matrix && matrix.length > 0) {
      return res.json({
        distance_meters: matrix[0].distance.value,
        duration_seconds: matrix[0].duration_in_traffic ? matrix[0].duration_in_traffic.value : matrix[0].duration.value
      });
    }
    return res.status(404).json({ error: 'Could not calculate ETA' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Create Trip (Section 3)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { ownchatOrgId, provider, assignmentStrategy, customer, pickup, drop, cost } = req.body;

    const org = await Org.findById(ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const delivery = new Delivery({
      ownchatOrgId,
      provider,
      status: 'unassigned',
      customer,
      pickup,
      drop,
      cost: cost || 0,
      ownRiderAssignment: {
        assignmentStrategy: assignmentStrategy || null,
        assignmentMode: 'auto',
        attemptCount: 0,
        candidateQueue: []
      }
    });

    try {
      const estimate = await getPrecalculatedEstimate(pickup.latitude, pickup.longitude, drop.latitude, drop.longitude);
      if (estimate) {
        delivery.estimated_distance = estimate.distance_meters;
        delivery.estimated_duration = estimate.duration_seconds;
      }
    } catch (err) {
      console.warn("Failed to calculate pre-estimates during order creation");
    }

    await delivery.save();

    if (provider === 'own_rider') {
      setTimeout(() => assignRider(delivery), 100);
    }

    return res.status(201).json(delivery);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Trigger Assignment
router.post('/:id/assign', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const delivery = await Delivery.findById(id);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    
    delivery.ownRiderAssignment.attemptCount = 0;
    await assignRider(delivery);
    return res.json({ message: 'Assignment triggered', deliveryId: id });
  } catch (error: any) {
     return res.status(500).json({ error: error.message });
  }
});

// Trip State Machine Transition (Section 7)
router.post('/:id/transition', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // ASSIGNED, RIDER_EN_ROUTE_TO_PICKUP, ARRIVED_AT_PICKUP, IN_TRIP, COMPLETED, CANCELLED

    const delivery = await Delivery.findById(id);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    const oldStatus = delivery.status;
    const validTransitions: any = {
      'unassigned': ['ASSIGNED', 'CANCELLED'],
      'ASSIGNED': ['RIDER_EN_ROUTE_TO_PICKUP', 'CANCELLED'],
      'RIDER_EN_ROUTE_TO_PICKUP': ['ARRIVED_AT_PICKUP', 'CANCELLED'],
      'ARRIVED_AT_PICKUP': ['IN_TRIP', 'CANCELLED'],
      'IN_TRIP': ['COMPLETED', 'CANCELLED'],
      'COMPLETED': [],
      'CANCELLED': []
    };

    if (validTransitions[oldStatus] && !validTransitions[oldStatus].includes(status)) {
       return res.status(400).json({ error: `Invalid transition from ${oldStatus} to ${status}` });
    }

    const riderId = delivery.ownRiderAssignment?.riderId;

    // Release rider if finished
    if (['COMPLETED', 'CANCELLED'].includes(status) && riderId) {
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: {
          'stats.activeDeliveries': -1,
          'stats.totalDeliveries': status === 'COMPLETED' ? 1 : 0,
          'stats.cancelledCount': status === 'CANCELLED' ? 1 : 0
        }
      });
    }

    delivery.status = status;
    const now = new Date();
    
    // Milestones
    if (status === 'ASSIGNED') delivery.milestones.riderAssignedAt = now;
    if (status === 'ARRIVED_AT_PICKUP') delivery.milestones.atPickupAt = now;
    if (status === 'IN_TRIP') delivery.milestones.pickedAt = now;
    if (status === 'COMPLETED') delivery.milestones.deliveredAt = now;

    await delivery.save();

    emitToOrg(delivery.ownchatOrgId.toString(), 'delivery_status_updated', {
      orderId: delivery.id, status, timestamp: now
    });
    
    // Broadcast live to trip channel (Section 7)
    emitToOrg(`trip:${delivery.id}`, 'trip:status', {
      orderId: delivery.id, status, timestamp: now
    });

    return res.json({ message: 'State transitioned', delivery });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get all deliveries for an org
router.get('/', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.query;
    const filter = orgId ? { ownchatOrgId: orgId as string } : {};
    const deliveries = await Delivery.find(filter).sort({ createdAt: -1 });
    return res.json(deliveries);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get Trip details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    // If id is actually 'create' or something it might conflict, but we have backwards compat below
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    return res.json(delivery);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get ranked riders for manual assignment modal
router.get('/:id/ranked-riders', async (req: Request, res: Response) => {
  try {
    const deliveryId = req.params.id;
    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    const org = await Org.findById(delivery.ownchatOrgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const previouslyRejectedRiderIds = delivery.ownRiderAssignment?.candidateQueue
      ?.filter(c => c.result === 'rejected' || c.result === 'timeout')
      .map(c => c.riderId.toString()) || [];

    // For manual override, we don't exclude them completely so the dispatcher can still force-assign
    const shortlisted = await getShortlistedRiders(org.id, org, delivery.pickup.latitude, delivery.pickup.longitude, []);

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
      console.error('Distance matrix failed in ranked-riders, using fallback logic internally');
    }

    const rankedRiders = shortlisted.map((item, idx) => {
      const eta = matrixResults[idx]?.duration_in_traffic?.value || ((item.distanceRedisKm || 1) * 100);
      const dist = matrixResults[idx]?.distance?.value ? matrixResults[idx].distance.value / 1000 : item.distanceRedisKm;
      
      const load = scoreMap.get(item.rider.id.toString()) || 0;
      
      const distanceScore = eta * 0.4;
      const loadScoreCalc = load * 60 * 0.6; // Scale load appropriately
      const fairnessScore = item.rider.lastAssignedAt ? (Date.now() - item.rider.lastAssignedAt.getTime()) / 60000 : 0; // minutes since last assigned

      const totalScore = distanceScore + loadScoreCalc - (fairnessScore * 0.1); // lower is better, so fairness subtracts

      return {
        _id: item.rider._id,
        name: item.rider.name,
        phone: item.rider.phone,
        vehicleType: item.rider.vehicleType || 'bike',
        activeDeliveries: item.rider.stats.activeDeliveries || 0,
        distanceKm: dist,
        distanceScore: distanceScore,
        loadScore: loadScoreCalc,
        fairnessScore: fairnessScore,
        totalScore: totalScore
      };
    });

    return res.json({ rankedRiders, excludedRiderIds: previouslyRejectedRiderIds });
  } catch (error: any) {
    console.error('Error in ranked-riders:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Backward compatibility routes
router.post('/create', async (req: Request, res: Response) => {
  // redirect to base
  req.url = '/';
  (router as any).handle(req, res, () => {});
});

router.get('/:orgId/unassigned', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const deliveries = await Delivery.find({
      ownchatOrgId: orgId,
      provider: 'own_rider',
      status: 'unassigned'
    }).sort({ createdAt: -1 });

    return res.json({ count: deliveries.length, deliveries });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
