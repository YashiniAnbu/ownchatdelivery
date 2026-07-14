import { Router, Request, Response } from 'express';
import Org from '../models/Org';

const router = Router();

// Create a new Organization
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { name, ownRiderConfig } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Organization name is required' });
    }

    const org = new Org({
      name,
      ownRiderConfig: ownRiderConfig || { enabled: true }
    });

    await org.save();
    return res.status(201).json(org);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// List all Organizations
router.get('/list', async (req: Request, res: Response) => {
  try {
    const orgs = await Org.find();
    return res.json(orgs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get Org Details
router.get('/:orgId', async (req: Request, res: Response) => {
  try {
    const org = await Org.findById(req.params.orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    return res.json(org);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update Organization Config
router.put('/:orgId/config', async (req: Request, res: Response) => {
  try {
    const { ownRiderConfig } = req.body;
    if (!ownRiderConfig) {
      return res.status(400).json({ error: 'ownRiderConfig is required' });
    }

    const org = await Org.findById(req.params.orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Merge settings
    org.ownRiderConfig = {
      ...org.ownRiderConfig,
      ...ownRiderConfig
    };

    await org.save();
    return res.json({ message: 'Organization config updated', org });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// SLA and Stats imports
import Delivery from '../models/Delivery';
import { calculateDistance } from '../services/haversine';
import { logAudit } from '../services/auditLogger';

// Get dashboard stats
router.get('/:orgId/dashboard-stats', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const deliveries = await Delivery.find({ ownchatOrgId: orgId });

    const totalOrders = deliveries.length;
    let totalSpend = 0;
    let totalRadius = 0;
    let validRadiusCount = 0;
    let totalDeliveryTimeMs = 0;
    let validDeliveryTimeCount = 0;

    // Timeline variables
    let totalCreateToAssignMs = 0;
    let validCreateToAssignCount = 0;
    let totalAssignToPickupMs = 0;
    let validAssignToPickupCount = 0;
    let totalPickupToPickedMs = 0;
    let validPickupToPickedCount = 0;
    let totalPickedToDeliveredMs = 0;
    let validPickedToDeliveredCount = 0;

    // Hourly map
    const hourlyDataMap: Record<string, number> = {
      '8 AM': 0, '10 AM': 0, '12 PM': 0, '2 PM': 0,
      '4 PM': 0, '6 PM': 0, '8 PM': 0, '10 PM': 0
    };

    // Locations frequency map
    const locationsMap: Record<string, number> = {};

    deliveries.forEach((d) => {
      totalSpend += d.cost || 0;
      
      if (d.pickup && d.drop) {
        const dist = calculateDistance(
          d.pickup.latitude,
          d.pickup.longitude,
          d.drop.latitude,
          d.drop.longitude
        );
        totalRadius += dist;
        validRadiusCount++;
      }

      if (d.status === 'COMPLETED' && d.milestones?.riderAssignedAt && d.milestones?.deliveredAt) {
        const duration = new Date(d.milestones.deliveredAt).getTime() - new Date(d.milestones.riderAssignedAt).getTime();
        totalDeliveryTimeMs += duration;
        validDeliveryTimeCount++;
      }

      // Timeline stages
      const m = d.milestones;
      if (m) {
        if (d.createdAt && m.riderAssignedAt) {
          totalCreateToAssignMs += new Date(m.riderAssignedAt).getTime() - new Date(d.createdAt).getTime();
          validCreateToAssignCount++;
        }
        if (m.riderAssignedAt && m.atPickupAt) {
          totalAssignToPickupMs += new Date(m.atPickupAt).getTime() - new Date(m.riderAssignedAt).getTime();
          validAssignToPickupCount++;
        }
        if (m.atPickupAt && m.pickedAt) {
          totalPickupToPickedMs += new Date(m.pickedAt).getTime() - new Date(m.atPickupAt).getTime();
          validPickupToPickedCount++;
        }
        if (m.pickedAt && m.deliveredAt) {
          totalPickedToDeliveredMs += new Date(m.deliveredAt).getTime() - new Date(m.pickedAt).getTime();
          validPickedToDeliveredCount++;
        }
      }

      // Hourly distribution
      if (d.createdAt) {
        const hour = new Date(d.createdAt).getHours();
        let label = '';
        if (hour >= 8 && hour < 10) label = '8 AM';
        else if (hour >= 10 && hour < 12) label = '10 AM';
        else if (hour >= 12 && hour < 14) label = '12 PM';
        else if (hour >= 14 && hour < 16) label = '2 PM';
        else if (hour >= 16 && hour < 18) label = '4 PM';
        else if (hour >= 18 && hour < 20) label = '6 PM';
        else if (hour >= 20 && hour < 22) label = '8 PM';
        else if (hour >= 22 || hour < 8) label = '10 PM';

        if (label) {
          hourlyDataMap[label]++;
        }
      }

      // Locations frequency mapping
      if (d.drop?.label) {
        locationsMap[d.drop.label] = (locationsMap[d.drop.label] || 0) + 1;
      }
    });

    const avgRadius = validRadiusCount > 0 ? totalRadius / validRadiusCount : 0;
    const avgValue = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const avgDeliveryMin = validDeliveryTimeCount > 0 
      ? (totalDeliveryTimeMs / validDeliveryTimeCount) / (1000 * 60) 
      : 25;

    // Timeline Averages in minutes
    const avgCreateToAssignMin = validCreateToAssignCount > 0
      ? (totalCreateToAssignMs / validCreateToAssignCount) / (1000 * 60)
      : 2;
    const avgAssignToPickupMin = validAssignToPickupCount > 0
      ? (totalAssignToPickupMs / validAssignToPickupCount) / (1000 * 60)
      : 6;
    const avgPickupToPickedMin = validPickupToPickedCount > 0
      ? (totalPickupToPickedMs / validPickupToPickedCount) / (1000 * 60)
      : 5;
    const avgPickedToDeliveredMin = validPickedToDeliveredCount > 0
      ? (totalPickedToDeliveredMs / validPickedToDeliveredCount) / (1000 * 60)
      : 12;

    const hourlyDistribution = Object.keys(hourlyDataMap).map(key => ({
      hour: key,
      orders: hourlyDataMap[key]
    }));

    const topLocations = Object.keys(locationsMap)
      .map(name => ({ name, orders: locationsMap[name] }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

    return res.json({
      totalOrders,
      avgRadius,
      totalSpend,
      avgValue,
      avgDeliveryMin,
      timeline: {
        avgCreateToAssignMin,
        avgAssignToPickupMin,
        avgPickupToPickedMin,
        avgPickedToDeliveredMin
      },
      hourlyDistribution,
      topLocations
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get delivery stats
router.get('/:orgId/delivery-stats', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const deliveries = await Delivery.find({ ownchatOrgId: orgId });

    const totalShipments = deliveries.length;
    const activeDeliveries = deliveries.filter(d => 
      ['pending', 'rider_assigned', 'at_pickup', 'picked'].includes(d.status)
    ).length;

    let totalCost = 0;
    deliveries.forEach(d => {
      totalCost += d.cost || 0;
    });
    const averageCost = totalShipments > 0 ? totalCost / totalShipments : 0;

    return res.json({
      totalShipments,
      activeDeliveries,
      averageCost
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Wallet top-up
router.patch('/:orgId/wallet', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid top-up amount is required' });
    }

    const org = await Org.findById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const oldBalance = org.walletBalance;
    org.walletBalance += Number(amount);
    await org.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'SETTINGS_CHANGED',
      targetType: 'wallet',
      targetId: orgId,
      metadata: {
        action: 'wallet_topup',
        oldBalance,
        newBalance: org.walletBalance,
        amount
      },
      ip: req.ip
    });

    return res.json({ message: 'Wallet topped up successfully', walletBalance: org.walletBalance });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update SLA config
router.patch('/:orgId/sla', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { assignmentMins, pickupMins, deliveryMins, assignmentStrategy, allowStaffManualAssignment } = req.body;

    const org = await Org.findById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const oldConfig = { ...org.ownRiderConfig };

    if (assignmentMins !== undefined) org.ownRiderConfig.riderAcceptanceTimeoutMinutes = Number(assignmentMins);
    if (pickupMins !== undefined) org.ownRiderConfig.pickupTimeoutMinutes = Number(pickupMins);
    if (deliveryMins !== undefined) org.ownRiderConfig.deliveryTimeoutMinutes = Number(deliveryMins);
    if (assignmentStrategy !== undefined) org.ownRiderConfig.assignmentStrategy = assignmentStrategy;
    if (allowStaffManualAssignment !== undefined) org.ownRiderConfig.allowStaffManualAssignment = allowStaffManualAssignment;

    await org.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'SETTINGS_CHANGED',
      targetType: 'settings',
      targetId: orgId,
      metadata: {
        oldConfig,
        newConfig: org.ownRiderConfig
      },
      ip: req.ip
    });

    return res.json({ message: 'SLA config updated successfully', org });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
