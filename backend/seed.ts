import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Org from './src/models/Org';
import Rider from './src/models/Rider';
import Delivery from './src/models/Delivery';
import User from './src/models/User';
import bcrypt from 'bcryptjs';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ownchat_delivery_ts';

async function seed() {
  try {
    console.log(`[Seeder] Connecting to MongoDB at ${MONGO_URI}...`);
    await mongoose.connect(MONGO_URI);
    console.log('[Seeder] Connected successfully.');

    // Clear existing collections
    console.log('[Seeder] Clearing Org, Rider, Delivery, and User collections...');
    await Org.deleteMany({});
    await Rider.deleteMany({});
    await Delivery.deleteMany({});
    await User.deleteMany({});

    // Seed default Owner User
    console.log('[Seeder] Seeding default owner user...');
    const ownerPasswordHash = bcrypt.hashSync('123456', 10);
    const ownerUser = new User({
      name: 'Owner',
      email: 'owner@ownchat.io',
      passwordHash: ownerPasswordHash,
      role: 'owner'
    });
    await ownerUser.save();
    console.log(`[Seeder] Seeded Owner User: ${ownerUser.email}`);

    // Store coordinate reference: Zafran Biryani House is at T. Nagar, Chennai
    // Latitude: 13.0418, Longitude: 80.2341 (Let's use these coordinates for the store)
    const storeLat = 13.0418;
    const storeLng = 80.2341;

    // 1. Create Organization (Zafran Biryani House)
    console.log('[Seeder] Creating Organization "Zafran Biryani House"...');
    const org = new Org({
      name: 'Zafran Biryani House',
      status: 'active',
      walletBalance: 15000,
      city: 'Chennai',
      coords: { lat: storeLat, lng: storeLng },
      ownRiderConfig: {
        enabled: true,
        assignmentStrategy: 'hybrid',
        maxConcurrentOrdersPerRider: 3,
        riderAcceptanceTimeoutMinutes: 2, // 2 minutes for testing convenience
        pickupTimeoutMinutes: 20,
        deliveryTimeoutMinutes: 45,
        fallbackToExternalProvider: true,
        fallbackProvider: 'porter'
      }
    });
    await org.save();
    // 2. Create Riders (5 riders representing various states)
    console.log('[Seeder] Seeding riders...');
    
    const ridersData = [
      {
        name: 'Rajan',
        phone: '9876543211',
        ownchatOrgId: org._id.toString(),
        belongsTo: org._id,
        vehicleType: 'bike' as const,
        vehicleNumber: 'TN-01-AB-1234',
        pin: '1111',
        isActive: true,
        isOnDuty: true,
        isAvailable: true,
        lastKnownLocation: {
          // Rajan is ~2.3 km from store
          latitude: 13.0550,
          longitude: 80.2480,
          updatedAt: new Date()
        },
        lastAssignedAt: new Date(Date.now() - 3 * 3600000), // 3 hours ago
        stats: { totalDeliveries: 10, activeDeliveries: 1, cancelledCount: 0 }
      },
      {
        name: 'Arun',
        phone: '9876543212',
        ownchatOrgId: org._id.toString(),
        belongsTo: org._id,
        vehicleType: 'scooter' as const,
        vehicleNumber: 'TN-01-CD-5678',
        pin: '2222',
        isActive: true,
        isOnDuty: false, // Off duty
        isAvailable: false,
        lastKnownLocation: {
          latitude: null,
          longitude: null,
          updatedAt: null
        },
        lastAssignedAt: null,
        stats: { totalDeliveries: 2, activeDeliveries: 0, cancelledCount: 1 }
      },
      {
        name: 'Suresh',
        phone: '9876543213',
        ownchatOrgId: org._id.toString(),
        belongsTo: org._id,
        vehicleType: 'bike' as const,
        vehicleNumber: 'TN-01-EF-9012',
        pin: '3333',
        isActive: true,
        isOnDuty: true,
        isAvailable: true,
        lastKnownLocation: {
          // Suresh is ~1.2 km from store
          latitude: 13.0480,
          longitude: 80.2410,
          updatedAt: new Date()
        },
        lastAssignedAt: new Date(Date.now() - 1 * 3600000), // 1 hour ago
        stats: { totalDeliveries: 15, activeDeliveries: 3, cancelledCount: 0 } // At max concurrent load (3)
      },
      {
        name: 'Vikram',
        phone: '9876543214',
        ownchatOrgId: org._id.toString(),
        belongsTo: org._id,
        vehicleType: 'car' as const,
        vehicleNumber: 'TN-01-GH-3456',
        pin: '4444',
        isActive: false, // Inactive account
        isOnDuty: false,
        isAvailable: false,
        lastKnownLocation: {
          latitude: null,
          longitude: null,
          updatedAt: null
        },
        lastAssignedAt: null,
        stats: { totalDeliveries: 0, activeDeliveries: 0, cancelledCount: 0 }
      },
      {
        name: 'Priya',
        phone: '9876543215',
        ownchatOrgId: org._id.toString(),
        belongsTo: org._id,
        vehicleType: 'scooter' as const,
        vehicleNumber: 'TN-01-IJ-7890',
        pin: '5555',
        isActive: true,
        isOnDuty: true,
        isAvailable: true,
        lastKnownLocation: {
          // Priya is ~0.8 km from store
          latitude: 13.0450,
          longitude: 80.2380,
          updatedAt: new Date()
        },
        lastAssignedAt: new Date(Date.now() - 2 * 3600000), // 2 hours ago
        stats: { totalDeliveries: 8, activeDeliveries: 0, cancelledCount: 0 } // Priya is closest and has 0 active load
      }
    ];

    const seededRiders = await Rider.insertMany(ridersData);
    console.log(`[Seeder] Seeded ${seededRiders.length} riders successfully.`);

    // 3. Seed 2 dummy orders
    console.log('[Seeder] Seeding initial deliveries...');
    const delivery1 = new Delivery({
      ownchatOrgId: org._id,
      provider: 'own_rider',
      status: 'unassigned',
      customer: {
        name: 'Jane Doe',
        phone: '9876501234'
      },
      pickup: {
        label: 'Zafran Biryani House',
        latitude: storeLat,
        longitude: storeLng
      },
      drop: {
        label: 'Nungambakkam High Road',
        latitude: 13.0654,
        longitude: 80.2398
      },
      ownRiderAssignment: {
        riderId: null,
        riderName: null,
        riderPhone: null,
        assignedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        assignmentStatus: 'unassigned',
        assignmentStrategy: 'nearest',
        assignmentMode: 'auto',
        attemptCount: 0,
        candidateQueue: []
      }
    });

    const delivery2 = new Delivery({
      ownchatOrgId: org._id,
      provider: 'porter', // external provider order
      status: 'delivered',
      customer: {
        name: 'John Smith',
        phone: '9123456789'
      },
      pickup: {
        label: 'Zafran Biryani House',
        latitude: storeLat,
        longitude: storeLng
      },
      drop: {
        label: 'Anna Nagar West',
        latitude: 13.0850,
        longitude: 80.2100
      },
      ownRiderAssignment: {
        riderId: null,
        riderName: null,
        riderPhone: null,
        assignedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        assignmentStatus: 'unassigned',
        assignmentStrategy: null,
        assignmentMode: 'auto',
        attemptCount: 0,
        candidateQueue: []
      },
      milestones: {
        riderAssignedAt: new Date(Date.now() - 3600000),
        atPickupAt: new Date(Date.now() - 3000000),
        pickedAt: new Date(Date.now() - 2400000),
        deliveredAt: new Date(Date.now() - 1200000)
      }
    });

    await delivery1.save();
    await delivery2.save();
    console.log('[Seeder] Seeded 2 orders.');
    
    console.log('\n=========================================');
    console.log('SEEDING COMPLETED SUCCESSFULLY.');
    console.log(`Organization ID: ${org._id}`);
    console.log('Riders created:');
    seededRiders.forEach(r => {
      console.log(` - ${r.name} (Phone: ${r.phone}, PIN: ${r.pin}) - OnDuty: ${r.isOnDuty}, Available: ${r.isAvailable}`);
    });
    console.log('=========================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Seeder Error] Failed to seed database:', err);
    process.exit(1);
  }
}

seed();
