import { Router, Request, Response } from 'express';
import Delivery from '../models/Delivery';
import Org from '../models/Org';
import Rider from '../models/Rider';
import { assignRider, emitToOrg } from '../services/assignmentEngine';
import { logAudit } from '../services/auditLogger';

const router = Router();

// Create Delivery Order
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { ownchatOrgId, provider, assignmentStrategy, customer, pickup, drop, cost } = req.body;

    if (!ownchatOrgId || !provider || !customer || !pickup || !drop) {
      return res.status(400).json({ error: 'Missing required delivery parameters' });
    }

    if (!customer.name || !customer.phone) {
      return res.status(400).json({ error: 'Customer name and phone are required' });
    }

    if (!pickup.label || pickup.latitude === undefined || pickup.latitude === null || pickup.longitude === undefined || pickup.longitude === null) {
      return res.status(400).json({ error: 'Pickup label, latitude, and longitude are required' });
    }

    if (!drop.label || drop.latitude === undefined || drop.latitude === null || drop.longitude === undefined || drop.longitude === null) {
      return res.status(400).json({ error: 'Drop label, latitude, and longitude are required' });
    }

    if (cost === undefined || cost === null) {
      return res.status(400).json({ error: 'Order cost is required' });
    }

    const org = await Org.findById(ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Prevent duplicate orders from same customer to same drop within 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const duplicateOrder = await Delivery.findOne({
      ownchatOrgId,
      'customer.phone': customer.phone,
      'pickup.label': pickup.label,
      'drop.label': drop.label,
      createdAt: { $gte: fiveMinutesAgo }
    });

    if (duplicateOrder) {
      return res.status(400).json({ error: 'A duplicate order for this customer and route was created in the last 5 minutes. Please wait before creating another.' });
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
        riderId: null,
        riderName: null,
        riderPhone: null,
        assignedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        assignmentStatus: 'unassigned',
        assignmentStrategy: assignmentStrategy || null,
        assignmentMode: 'auto',
        attemptCount: 0,
        candidateQueue: []
      },
      milestones: {
        riderAssignedAt: null,
        atPickupAt: null,
        pickedAt: null,
        deliveredAt: null
      },
      sla: {
        slaBreached: false,
        breachType: null,
        breachedAt: null
      }
    });

    await delivery.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'ORDER_CREATED',
      targetType: 'order',
      targetId: delivery.id,
      metadata: {
        provider: delivery.provider,
        customerName: delivery.customer?.name
      },
      ip: req.ip
    });

    // Trigger auto-assignment if provider is own_rider
    if (provider === 'own_rider') {
      // Trigger asynchronously so API returns quickly
      setTimeout(() => {
        assignRider(delivery);
      }, 100);
    }

    return res.status(201).json({
      message: 'Delivery created successfully',
      deliveryId: delivery.id,
      status: delivery.status
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get unassigned deliveries for an organization
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

// List all deliveries (with optional filter by orgId)
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

// Cancel delivery
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { deliveryId } = req.body;
    if (!deliveryId) {
      return res.status(400).json({ error: 'deliveryId is required' });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot cancel a delivery that is already ${delivery.status}` });
    }

    const orgId = delivery.ownchatOrgId.toString();

    // Release rider if assigned
    const riderId = delivery.ownRiderAssignment.riderId;
    if (riderId) {
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: { 'stats.activeDeliveries': -1, 'stats.cancelledCount': 1 }
      });
    }

    delivery.status = 'cancelled';
    await delivery.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'STATUS_UPDATE',
      targetType: 'order',
      targetId: delivery.id,
      metadata: {
        status: 'cancelled',
        riderId: delivery.ownRiderAssignment?.riderId
      },
      ip: req.ip
    });

    emitToOrg(orgId, 'delivery_status_updated', {
      orderId: delivery.id,
      status: 'cancelled',
      timestamp: new Date()
    });

    return res.json({ message: 'Delivery cancelled successfully', delivery });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get individual delivery details
router.get('/:deliveryId', async (req: Request, res: Response) => {
  try {
    const delivery = await Delivery.findById(req.params.deliveryId);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    return res.json(delivery);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Import additional helpers for scoring route
import { calculateDistance } from '../services/haversine';
import { getEligibleRiders } from '../services/assignmentEngine';

// Get eligible riders and their computed scores for a specific delivery
router.get('/:deliveryId/ranked-riders', async (req: Request, res: Response) => {
  try {
    const { deliveryId } = req.params;
    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const org = await Org.findById(delivery.ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Fetch ALL active riders for manual override (no restrictions on load or duty status)
    const allRiders = await Rider.find({
      ownchatOrgId: org.id,
      isActive: true
    });
    
    // Compute scores
    const pickupLat = delivery.pickup.latitude;
    const pickupLng = delivery.pickup.longitude;
    
    if (pickupLat === null || pickupLng === null || pickupLat === undefined || pickupLng === undefined) {
       return res.status(400).json({ error: 'Delivery pickup coordinates missing' });
    }
    
    const W1 = parseFloat(process.env.WEIGHT_DISTANCE || '0.5');
    const W2 = parseFloat(process.env.WEIGHT_LOAD || '0.3');
    const W3 = parseFloat(process.env.WEIGHT_FAIRNESS || '0.2');
    const MAX_DECAY_HOURS = 4;
    const now = Date.now();

    // Prepare valid riders and compute haversine distance
    const ridersWithDistance: any[] = [];
    const excludedRiderIds: string[] = []; // Kept for compatibility

    for (const rider of allRiders) {
      const rLat = rider.lastKnownLocation?.latitude;
      const rLng = rider.lastKnownLocation?.longitude;
      if (rLat === null || rLng === null || rLat === undefined || rLng === undefined) {
        ridersWithDistance.push({ rider, distanceKm: Infinity });
      } else {
        const distanceKm = calculateDistance(pickupLat, pickupLng, rLat, rLng);
        ridersWithDistance.push({ rider, distanceKm });
      }
    }

    if (ridersWithDistance.length === 0) {
      return res.json({ rankedRiders: [], excludedRiderIds });
    }

    const validDistances = ridersWithDistance.map(r => r.distanceKm).filter(d => d !== Infinity);
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
      return {
        _id: item.rider._id,
        name: item.rider.name,
        phone: item.rider.phone,
        vehicleType: item.rider.vehicleType,
        activeDeliveries: item.rider.stats.activeDeliveries,
        distanceKm: item.distanceKm === Infinity ? null : item.distanceKm,
        distanceScore: W1 * normalizedDistance,
        loadScore: W2 * normalizedLoad,
        fairnessScore: W3 * roundRobinPenalty,
        totalScore: score
      };
    });

    // Sort by totalScore ascending (lower score is better suitability)
    ridersWithScores.sort((a, b) => a.totalScore - b.totalScore);

    return res.json({
      rankedRiders: ridersWithScores,
      excludedRiderIds
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update order status manually by operator
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const oldStatus = delivery.status;
    const riderId = delivery.ownRiderAssignment?.riderId;

    // Release rider if transitioning out of active states to completed/cancelled
    const activeStates = ['pending', 'rider_assigned', 'at_pickup', 'picked'];
    const finalStates = ['delivered', 'cancelled'];

    if (riderId && activeStates.includes(oldStatus) && finalStates.includes(status)) {
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: {
          'stats.activeDeliveries': -1,
          'stats.totalDeliveries': status === 'delivered' ? 1 : 0,
          'stats.cancelledCount': status === 'cancelled' ? 1 : 0
        }
      });
    }

    // Lock rider if manually assigning/re-activating status
    if (riderId && finalStates.includes(oldStatus) && activeStates.includes(status)) {
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: false },
        $inc: { 'stats.activeDeliveries': 1 }
      });
    }

    delivery.status = status;
    
    // Update milestones
    const now = new Date();
    if (status === 'rider_assigned') {
      delivery.milestones.riderAssignedAt = now;
      delivery.ownRiderAssignment.assignmentStatus = 'accepted';
      delivery.ownRiderAssignment.acceptedAt = now;
    } else if (status === 'at_pickup') {
      delivery.milestones.atPickupAt = now;
    } else if (status === 'picked') {
      delivery.milestones.pickedAt = now;
    } else if (status === 'delivered') {
      delivery.milestones.deliveredAt = now;
    }

    await delivery.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'STATUS_UPDATE',
      targetType: 'order',
      targetId: id,
      metadata: {
        oldStatus,
        newStatus: status,
        riderId
      },
      ip: req.ip
    });

    emitToOrg(delivery.ownchatOrgId.toString(), 'delivery_status_updated', {
      orderId: delivery.id,
      status,
      timestamp: now
    });

    return res.json({ message: 'Delivery status updated manually', delivery });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
