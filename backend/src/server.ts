import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

// Import routes
import orgRoutes from './routes/orgRoutes';
import riderRoutes from './routes/riderRoutes';
import deliveryRoutes from './routes/deliveryRoutes';
import authRoutes from './routes/authRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import distanceRoutes from './routes/distanceRoutes';
import cookieParser from 'cookie-parser';
import { verifyToken } from './middleware/verifyToken';

// Import workers and services
import { startAssignmentWorker } from './workers/assignmentWorker';
import { startSlaWorker } from './workers/slaWorker';
import { updateRiderLocation } from './services/redisGeoService';
import Rider from './models/Rider';
import { setIOInstance, emitToOrg } from './services/assignmentEngine';
import Delivery from './models/Delivery';
import TripLocationHistory from './models/TripLocationHistory';
import redisClient from './config/redis';
import { getPrecalculatedEstimate } from './services/precalcService';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: '*', // Allow all origins for local testing
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Set global Socket.io instance in the assignment engine
setIOInstance(io);

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));

// Public API Endpoints
app.use('/api/auth', authRoutes);

// Auth Guard Middleware
app.use(verifyToken);

// Protected API Endpoints
app.use('/api/org', orgRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/trips', deliveryRoutes); // Updated as per prompt API surface
app.use('/api/delivery', deliveryRoutes); // Backward compatibility for frontend
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/distance', distanceRoutes);

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Operator or rider joining their organization room
  socket.on('join_org', (orgId: string) => {
    if (orgId) {
      socket.join(orgId);
      console.log(`[Socket.io] Socket ${socket.id} joined room: ${orgId}`);
    }
  });

  // Dispatcher dashboards specifically joining a dispatchers room
  socket.on('join_dispatchers', (orgId: string) => {
    if (orgId) {
      const room = `dispatchers_${orgId}`;
      socket.join(room);
      console.log(`[Socket.io] Socket ${socket.id} joined room: ${room}`);
    }
  });

  // Customer or app joining a specific trip channel for live tracking
  socket.on('join_trip', (tripId: string) => {
    if (tripId) {
      const room = `trip:${tripId}`;
      socket.join(room);
      console.log(`[Socket.io] Socket ${socket.id} joined room: ${room}`);
    }
  });

  // Live Tracking ping from Rider (Section 8)
  socket.on('rider:location', async (data: { riderId: string, lat: number, lng: number, heading?: number, speed?: number, tripId?: string }) => {
    try {
      console.log(`[LiveTracking] Received GPS ping from Rider ${data.riderId} - [${data.lat}, ${data.lng}] (Trip: ${data.tripId || 'None'})`);
      const { updateRiderLocation, checkArrivalDistance } = require('./services/redisGeoService');
      await updateRiderLocation(data.riderId, data.lat, data.lng, data.heading || 0, data.speed || 0);

      if (data.tripId) {
        io.to(`trip:${data.tripId}`).emit('location:update', {
          riderId: data.riderId,
          lat: data.lat,
          lng: data.lng,
          heading: data.heading,
          speed: data.speed,
          timestamp: new Date()
        });

        const delivery = await Delivery.findById(data.tripId);
        if (delivery) {
          // Auto-Arrival Trigger
          if (delivery.status === 'RIDER_EN_ROUTE_TO_PICKUP') {
             const distStr = await checkArrivalDistance(data.riderId, data.tripId, delivery.pickup.latitude, delivery.pickup.longitude);
             if (distStr !== null && distStr <= 50) {
                 console.log(`[GeoTrigger] Rider ${data.riderId} within 50m of pickup for trip ${data.tripId}. Auto-arriving.`);
                 delivery.status = 'ARRIVED_AT_PICKUP';
                 delivery.milestones.atPickupAt = new Date();
                 await delivery.save();
                 emitToOrg(delivery.ownchatOrgId.toString(), 'delivery_status_updated', {
                    orderId: delivery.id, status: 'ARRIVED_AT_PICKUP', timestamp: new Date()
                 });
                 io.to(`trip:${data.tripId}`).emit('trip:status', {
                    orderId: delivery.id, status: 'ARRIVED_AT_PICKUP', timestamp: new Date()
                 });
             }
          }

          // Breadcrumb Throttle (30s)
          const breadcrumbKey = `trip:${data.tripId}:last_breadcrumb`;
          const canSave = await redisClient.set(breadcrumbKey, '1', 'EX', 30, 'NX');
          if (canSave) {
             await TripLocationHistory.create({
                 deliveryId: delivery._id,
                 lat: data.lat,
                 lng: data.lng,
                 recorded_at: new Date()
             });
          }

          // ETA Recalculation Throttle (60s)
          if (['RIDER_EN_ROUTE_TO_PICKUP', 'IN_TRIP'].includes(delivery.status)) {
             const etaKey = `trip:${data.tripId}:last_eta_calc`;
             const canCalcEta = await redisClient.set(etaKey, '1', 'EX', 60, 'NX');
             if (canCalcEta) {
                const destLat = delivery.status === 'IN_TRIP' ? delivery.drop.latitude : delivery.pickup.latitude;
                const destLng = delivery.status === 'IN_TRIP' ? delivery.drop.longitude : delivery.pickup.longitude;
                const precalc = await getPrecalculatedEstimate(data.lat, data.lng, destLat, destLng);
                if (precalc) {
                   io.to(`trip:${data.tripId}`).emit('eta:update', {
                      duration_seconds: precalc.duration_seconds,
                      distance_meters: precalc.distance_meters,
                      timestamp: new Date()
                   });
                }
             }
          }
        }
      }
    } catch (err) {
      console.error('[Socket.io] Error updating rider location:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// MongoDB Connection and Server Start
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ownchat_delivery_ts';

console.log(`[Database] Connecting to MongoDB: ${MONGO_URI}...`);
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('[Database] MongoDB connected successfully.');
    
    // Start background workers
    startAssignmentWorker();
    startSlaWorker();
    
    // Sync On-Duty riders to Redis on startup
    try {
      const activeRiders = await Rider.find({ isOnDuty: true });
      for (const r of activeRiders) {
        if (r.lastKnownLocation && r.lastKnownLocation.latitude && r.lastKnownLocation.longitude) {
          await updateRiderLocation(r.id.toString(), r.lastKnownLocation.latitude, r.lastKnownLocation.longitude, 0, 0);
        }
      }
      console.log(`[App] Synced ${activeRiders.length} on-duty riders to Redis.`);
    } catch (err) {
      console.error('[App] Failed to sync riders to Redis on startup:', err);
    }

    // Start Cron Jobs
    const { startCronJobs } = require('./cron');
    startCronJobs();

    // Start HTTP Server
    server.listen(PORT, () => {
      console.log(`[Server] Express server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Fatal Database Error] MongoDB connection failed:', err);
    process.exit(1);
  });

// Handle Port Conflicts Gracefully
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Server Error] Port ${PORT} is already in use. Please terminate any running processes on this port or change it in the .env file.`);
    process.exit(1);
  } else {
    throw error;
  }
});
