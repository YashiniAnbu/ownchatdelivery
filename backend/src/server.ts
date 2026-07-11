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
import { setIOInstance } from './services/assignmentEngine';

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
app.use('/api/delivery', deliveryRoutes);
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

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// MongoDB Connection and Server Start
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ownchat_delivery_ts';

console.log(`[Database] Connecting to MongoDB: ${MONGO_URI}...`);
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('[Database] MongoDB connected successfully.');
    
    // Start background workers
    startAssignmentWorker();
    startSlaWorker();

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
