import { Router, Request, Response } from 'express';
import Rider from '../models/Rider';
import Delivery from '../models/Delivery';
import Org from '../models/Org';
import { getEligibleRiders, manuallyAssignRider, tryNextCandidate, emitToOrg, emitToDispatchers, assignRider } from '../services/assignmentEngine';
import { Types } from 'mongoose';
import { logAudit } from '../services/auditLogger';
import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, 'rider-' + uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

const router = Router();

// Create Rider
router.post('/create', upload.single('profilePhoto'), async (req: Request, res: Response) => {
  try {
    const { name, phone, ownchatOrgId, vehicleType, vehicleNumber, email, pin, licenseNo, address } = req.body;

    let profilePhoto = req.body.profilePhoto;
    if (req.file) {
      profilePhoto = `http://localhost:${process.env.PORT || 3000}/uploads/${req.file.filename}`;
    }

    if (!name || !phone || !ownchatOrgId || !profilePhoto || !address || !vehicleType || !vehicleNumber) {
      return res.status(400).json({ error: 'Name, phone, vehicle type, vehicle number, profile photo, and address are required' });
    }

    const org = await Org.findById(ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Check duplicates
    const duplicatePhone = await Rider.findOne({ phone });
    if (duplicatePhone) {
      return res.status(400).json({ error: 'A rider with this phone number already exists' });
    }

    const duplicateVehicle = await Rider.findOne({ vehicleNumber });
    if (duplicateVehicle) {
      return res.status(400).json({ error: 'A rider with this vehicle number already exists' });
    }

    if (licenseNo) {
      const duplicateLicense = await Rider.findOne({ licenseNo });
      if (duplicateLicense) {
        return res.status(400).json({ error: 'A rider with this license number already exists' });
      }
    }

    const rider = new Rider({
      name,
      phone,
      ownchatOrgId,
      belongsTo: org._id,
      vehicleType: vehicleType || 'bike',
      vehicleNumber,
      licenseNo,
      address,
      profilePhoto,
      email,
      pin: pin || '1234', // default simple PIN for demo login
      isActive: true,
      isOnDuty: false,
      isAvailable: true,
      stats: { totalDeliveries: 0, activeDeliveries: 0, cancelledCount: 0 }
    });

    await rider.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'SETTINGS_CHANGED',
      targetType: 'rider',
      targetId: rider.id,
      metadata: {
        action: 'register_rider',
        riderName: rider.name,
        riderPhone: rider.phone
      },
      ip: req.ip
    });

    return res.status(201).json(rider);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// List riders (filtered by org if orgId is passed in query)
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.query;
    const filter = orgId ? { ownchatOrgId: orgId as string } : {};
    const riders = await Rider.find(filter);
    return res.json(riders);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get eligible riders for manual assignment picker
router.get('/:orgId/eligible', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const org = await Org.findById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const eligible = await getEligibleRiders(orgId, org);
    return res.json({ count: eligible.length, riders: eligible });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Manual assignment override
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const { deliveryId, riderId } = req.body;
    if (!deliveryId || !riderId) {
      return res.status(400).json({ error: 'deliveryId and riderId are required' });
    }

    const delivery = await manuallyAssignRider(deliveryId, riderId, req.body.operatorId);

    if (!delivery) {
      // Rider is no longer available. Trigger auto assignment for other eligible riders!
      const del = await Delivery.findById(deliveryId);
      if (!del) return res.status(404).json({ error: 'Delivery not found' });

      await assignRider(del);
      const updatedDel = await Delivery.findById(deliveryId);

      return res.json({
        message: 'Selected rider became unavailable. Auto-assigned to another eligible rider.',
        delivery: updatedDel
      });
    }

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'ORDER_ASSIGNED',
      targetType: 'order',
      targetId: deliveryId,
      metadata: {
        riderId,
        riderName: delivery.ownRiderAssignment?.riderName,
        mode: 'manual_override'
      },
      ip: req.ip
    });

    return res.json({ message: 'Rider manually assigned', delivery });
  } catch (error: any) {
    return res.status(409).json({ error: error.message });
  }
});

// Unassign rider and re-run auto-strategy or flag manual
router.post('/unassign', async (req: Request, res: Response) => {
  try {
    const { deliveryId, useManual } = req.body;
    if (!deliveryId) {
      return res.status(400).json({ error: 'deliveryId is required' });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const org = await Org.findById(delivery.ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const riderId = delivery.ownRiderAssignment.riderId;

    // Release current rider
    if (riderId) {
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: { 'stats.activeDeliveries': -1 }
      });
    }

    // Reset assignment fields
    delivery.status = 'unassigned';
    delivery.ownRiderAssignment.riderId = null;
    delivery.ownRiderAssignment.riderName = null;
    delivery.ownRiderAssignment.riderPhone = null;
    delivery.ownRiderAssignment.assignmentStatus = 'unassigned';
    delivery.ownRiderAssignment.candidateQueue = [];

    await delivery.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'ORDER_ASSIGNED',
      targetType: 'order',
      targetId: deliveryId,
      metadata: {
        action: 'unassign_rider',
        previousRiderId: riderId
      },
      ip: req.ip
    });

    if (useManual) {
      emitToOrg(org.id, 'own_rider_manual_required', {
        orderId: delivery.id,
        message: 'Order unassigned. Operator intervention requested.'
      });
      return res.json({ message: 'Order unassigned and flagged for manual selection', delivery });
    }

    // Otherwise, re-trigger auto-assignment engine
    // Wait for async execution
    setTimeout(() => {
      assignRider(delivery);
    }, 100);

    return res.json({ message: 'Rider unassigned, auto-assignment re-trigger scheduled', delivery });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Rider App Emulator endpoints

// Login
router.post('/app/login', async (req: Request, res: Response) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }

    const rider = await Rider.findOne({ phone, pin });
    if (!rider) {
      return res.status(401).json({ error: 'Invalid phone or PIN' });
    }

    await logAudit({
      actorId: rider._id.toString(),
      actorType: 'rider',
      actorName: rider.name,
      action: 'LOGIN',
      targetType: 'rider',
      targetId: rider._id.toString(),
      metadata: { ip: req.ip, source: 'rider_app' },
      ip: req.ip
    });

    // Simple session mockup, return rider document
    return res.json({
      message: 'Login successful',
      rider
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle Duty Status
router.post('/app/duty', async (req: Request, res: Response) => {
  try {
    const { riderId, isOnDuty } = req.body;
    if (!riderId) {
      return res.status(400).json({ error: 'riderId is required' });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    if (isOnDuty === false && rider.stats.activeDeliveries > 0) {
      return res.status(400).json({
        error: `Cannot go off-duty. You have ${rider.stats.activeDeliveries} active deliveries in progress.`
      });
    }

    rider.isOnDuty = isOnDuty;
    // If going off duty, set availability to false. If going on duty, set to true.
    rider.isAvailable = isOnDuty;
    await rider.save();

    await logAudit({
      actorId: rider._id.toString(),
      actorType: 'rider',
      actorName: rider.name,
      action: 'SETTINGS_CHANGED',
      targetType: 'rider',
      targetId: rider._id.toString(),
      metadata: {
        action: 'toggle_duty',
        isOnDuty: rider.isOnDuty
      },
      ip: req.ip
    });

    emitToDispatchers(rider.ownchatOrgId, 'rider:status_changed', {
      riderId: rider._id,
      isOnDuty: rider.isOnDuty,
      isAvailable: rider.isAvailable
    });

    return res.json({ message: `Duty toggled to ${isOnDuty ? 'ON' : 'OFF'}`, rider });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle Break Status (Manual availability override)
router.post('/app/break', async (req: Request, res: Response) => {
  try {
    const { riderId, isAvailable } = req.body;
    if (!riderId) {
      return res.status(400).json({ error: 'riderId is required' });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    if (!rider.isOnDuty) {
      return res.status(400).json({ error: 'Must be on duty to take a break' });
    }

    rider.isAvailable = isAvailable;
    await rider.save();

    await logAudit({
      actorId: rider._id.toString(),
      actorType: 'rider',
      actorName: rider.name,
      action: 'SETTINGS_CHANGED',
      targetType: 'rider',
      targetId: rider._id.toString(),
      metadata: {
        action: 'toggle_break',
        isAvailable: rider.isAvailable
      },
      ip: req.ip
    });

    emitToDispatchers(rider.ownchatOrgId, 'rider:status_changed', {
      riderId: rider._id,
      isOnDuty: rider.isOnDuty,
      isAvailable: rider.isAvailable
    });

    return res.json({ message: `Break toggled to ${!isAvailable ? 'ON' : 'OFF'}`, rider });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Live Location update
router.post('/app/location', async (req: Request, res: Response) => {
  try {
    const { riderId, latitude, longitude } = req.body;
    if (!riderId) {
      return res.status(400).json({ error: 'riderId is required' });
    }

    const rider = await Rider.findByIdAndUpdate(riderId, {
      $set: {
        'lastKnownLocation.latitude': Number(latitude),
        'lastKnownLocation.longitude': Number(longitude),
        'lastKnownLocation.updatedAt': new Date()
      }
    }, { new: true });

    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    emitToDispatchers(rider.ownchatOrgId, 'rider:location_update', {
      riderId: rider._id,
      latitude: rider.lastKnownLocation?.latitude,
      longitude: rider.lastKnownLocation?.longitude
    });

    return res.json({ message: 'Location updated successfully', rider });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update order status / milestone
router.post('/app/status', async (req: Request, res: Response) => {
  try {
    const { deliveryId, status, riderId } = req.body;
    if (!deliveryId || !status || !riderId) {
      return res.status(400).json({ error: 'deliveryId, status, and riderId are required' });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const org = await Org.findById(delivery.ownchatOrgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    if (status === 'accepted') {
      // Transition from pending to accepted
      delivery.status = 'RIDER_EN_ROUTE_TO_PICKUP';
      if (!delivery.ownRiderAssignment) {
        delivery.ownRiderAssignment = {} as any;
      }
      delivery.ownRiderAssignment.assignmentStatus = 'accepted';
      delivery.ownRiderAssignment.acceptedAt = new Date();
      
      if (!delivery.milestones) delivery.milestones = {} as any;
      delivery.milestones.riderAssignedAt = new Date();

      // Update candidate queue entry
      if (delivery.ownRiderAssignment.candidateQueue && Array.isArray(delivery.ownRiderAssignment.candidateQueue)) {
        const cand = delivery.ownRiderAssignment.candidateQueue.find(
          (c: any) => c && c.riderId && c.riderId.toString() === riderId.toString()
        );
        if (cand) {
          cand.result = 'accepted';
          delivery.markModified('ownRiderAssignment.candidateQueue');
        }
      }

      await delivery.save();

      await logAudit({
        actorId: riderId,
        actorType: 'rider',
        actorName: rider.name,
        action: 'STATUS_UPDATE',
        targetType: 'order',
        targetId: deliveryId,
        metadata: { status: 'rider_assigned' },
        ip: req.ip
      });

      emitToOrg(org.id, 'own_rider_accepted', {
        orderId: delivery.id,
        riderId: rider.id,
        riderName: rider.name
      });

      // Simulation removed, stages manually controlled by rider
    } else if (status === 'rejected') {
      // Release rider
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: { 'stats.activeDeliveries': -1 }
      });

      // Update candidate queue entry
      if (delivery.ownRiderAssignment && delivery.ownRiderAssignment.candidateQueue && Array.isArray(delivery.ownRiderAssignment.candidateQueue)) {
        const cand = delivery.ownRiderAssignment.candidateQueue.find(
          (c: any) => c && c.riderId && c.riderId.toString() === riderId.toString()
        );
        if (cand) {
          cand.result = 'rejected';
          delivery.markModified('ownRiderAssignment.candidateQueue');
        }
      }

      if (!delivery.ownRiderAssignment) {
        delivery.ownRiderAssignment = {} as any;
      }
      delivery.ownRiderAssignment.assignmentStatus = 'rejected';
      delivery.ownRiderAssignment.rejectedAt = new Date();
      await delivery.save();

      await logAudit({
        actorId: riderId,
        actorType: 'rider',
        actorName: rider.name,
        action: 'STATUS_UPDATE',
        targetType: 'order',
        targetId: deliveryId,
        metadata: { status: 'rejected' },
        ip: req.ip
      });

      emitToOrg(org.id, 'own_rider_rejected', {
        orderId: delivery.id,
        riderId: rider.id,
        riderName: rider.name,
        message: 'Rider declined the assignment request.'
      });

      // Try next candidate in background
      setTimeout(() => {
        tryNextCandidate(delivery, org);
      }, 100);
    } else if (status === 'at_pickup') {
      delivery.status = 'ARRIVED_AT_PICKUP';
      delivery.milestones.atPickupAt = new Date();
      await delivery.save();

      await logAudit({
        actorId: riderId,
        actorType: 'rider',
        actorName: rider.name,
        action: 'STATUS_UPDATE',
        targetType: 'order',
        targetId: deliveryId,
        metadata: { status: 'ARRIVED_AT_PICKUP' },
        ip: req.ip
      });

      emitToOrg(org.id, 'delivery_status_updated', {
        orderId: delivery.id,
        status: 'ARRIVED_AT_PICKUP',
        timestamp: new Date()
      });
    } else if (status === 'picked') {
      delivery.status = 'IN_TRIP';
      delivery.milestones.pickedAt = new Date();
      await delivery.save();

      await logAudit({
        actorId: riderId,
        actorType: 'rider',
        actorName: rider.name,
        action: 'STATUS_UPDATE',
        targetType: 'order',
        targetId: deliveryId,
        metadata: { status: 'IN_TRIP' },
        ip: req.ip
      });

      emitToOrg(org.id, 'delivery_status_updated', {
        orderId: delivery.id,
        status: 'IN_TRIP',
        timestamp: new Date()
      });
    } else if (status === 'delivered') {
      delivery.status = 'COMPLETED';
      delivery.milestones.deliveredAt = new Date();
      await delivery.save();

      // Release rider and record stats
      await Rider.findByIdAndUpdate(riderId, {
        $set: { isAvailable: true },
        $inc: { 'stats.activeDeliveries': -1, 'stats.totalDeliveries': 1 }
      });

      await logAudit({
        actorId: riderId,
        actorType: 'rider',
        actorName: rider.name,
        action: 'STATUS_UPDATE',
        targetType: 'order',
        targetId: deliveryId,
        metadata: { status: 'COMPLETED' },
        ip: req.ip
      });

      emitToOrg(org.id, 'delivery_status_updated', {
        orderId: delivery.id,
        status: 'COMPLETED',
        timestamp: new Date()
      });
    } else {
      return res.status(400).json({ error: 'Unsupported status tap parameter' });
    }

    return res.json({ message: `Status updated to ${status}`, delivery });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get rider profile
router.get('/:riderId', async (req: Request, res: Response) => {
  try {
    const rider = await Rider.findById(req.params.riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }
    return res.json(rider);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update rider profile
router.put('/:riderId', upload.single('profilePhoto'), async (req: Request, res: Response) => {
  try {
    const { name, phone, vehicleType, vehicleNumber, email, licenseNo, address } = req.body;

    let profilePhoto = req.body.profilePhoto;
    if (req.file) {
      profilePhoto = `http://localhost:${process.env.PORT || 3000}/uploads/${req.file.filename}`;
    }

    if (phone && phone.length !== 10) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits' });
    }

    const rider = await Rider.findById(req.params.riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    if (phone && phone !== rider.phone) {
      const existing = await Rider.findOne({ phone });
      if (existing) {
        return res.status(400).json({ error: 'A rider with this phone number already exists' });
      }
    }

    if (vehicleNumber && vehicleNumber !== rider.vehicleNumber) {
      const existing = await Rider.findOne({ vehicleNumber });
      if (existing) {
        return res.status(400).json({ error: 'A rider with this vehicle number already exists' });
      }
    }

    if (licenseNo && licenseNo !== rider.licenseNo) {
      const existing = await Rider.findOne({ licenseNo });
      if (existing) {
        return res.status(400).json({ error: 'A rider with this license number already exists' });
      }
    }

    rider.name = name || rider.name;
    rider.phone = phone || rider.phone;
    rider.vehicleType = vehicleType || rider.vehicleType;
    rider.vehicleNumber = vehicleNumber || rider.vehicleNumber;
    rider.licenseNo = licenseNo !== undefined ? licenseNo : rider.licenseNo;
    rider.address = address || rider.address;
    rider.profilePhoto = profilePhoto || rider.profilePhoto;
    rider.email = email || rider.email;

    await rider.save();

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'SETTINGS_CHANGED',
      targetType: 'rider',
      targetId: rider.id,
      metadata: {
        action: 'update_rider',
        riderName: rider.name,
        riderPhone: rider.phone
      },
      ip: req.ip
    });

    return res.json({ message: 'Rider updated successfully', rider });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Delete rider completely
router.delete('/:riderId', async (req: Request, res: Response) => {
  try {
    const rider = await Rider.findById(req.params.riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider not found' });
    }

    await Rider.findByIdAndDelete(req.params.riderId);

    await logAudit({
      actorId: req.body.operatorId || 'system',
      actorType: 'user',
      actorName: req.body.operatorName || 'System',
      action: 'SETTINGS_CHANGED',
      targetType: 'rider',
      targetId: rider.id,
      metadata: {
        action: 'delete_rider',
        riderName: rider.name
      },
      ip: req.ip
    });

    return res.json({ message: 'Rider deleted successfully', rider });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Import the auto-assignment trigger after definition to prevent circular require warnings
import { simulateOrderLifecycleToPicked } from '../services/assignmentEngine';

export default router;
