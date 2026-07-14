import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function runTests() {
  console.log('[Test] Connecting to DB to forge a token...');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ownchat_delivery_ts');
  const db = mongoose.connection.db;

  if (!db) {
      console.log('No DB connection');
      process.exit(1);
  }

  // Find a user
  const user = await db.collection('users').findOne({});
  if (!user) {
    console.error('[Test] No users found in database. Cannot test protected endpoints.');
    process.exit(1);
  }

  const token = jwt.sign(
    { userId: user._id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET || 'ownchat_super_secret_jwt_key_2024',
    { expiresIn: '15m' }
  );

  console.log('[Test] Token generated for user:', user.email);

  const api = axios.create({
    baseURL: 'http://localhost:5001/api',
    headers: { Authorization: `Bearer ${token}` }
  });

  try {
    console.log('\n--- 1. Testing Location Resolution ---');
    const locRes = await api.post('/trips/resolve-location', {
      address: '1600 Amphitheatre Parkway, Mountain View, CA'
    });
    console.log('Result:', locRes.data);

    // Let's create a trip (Assuming we have an org)
    console.log('\n--- 2. Fetching an Organization ---');
    const org = await db.collection('orgs').findOne({});
    if (!org) {
        console.log('[Test] No Orgs found to create a trip.');
    } else {
        console.log('Found Org:', org.name);
        console.log('\n--- 3. Testing Trip Creation ---');
        const tripRes = await api.post('/trips', {
            ownchatOrgId: org._id,
            provider: 'own_rider',
            assignmentStrategy: 'nearest',
            customer: {
                name: "Test Customer",
                phone: "+1234567890",
            },
            pickup: {
                address: "Pickup Addr",
                latitude: locRes.data.lat || 37.422,
                longitude: locRes.data.lng || -122.084
            },
            drop: {
                address: "Drop Addr",
                latitude: locRes.data.lat ? locRes.data.lat + 0.01 : 37.432,
                longitude: locRes.data.lng ? locRes.data.lng + 0.01 : -122.074
            },
            cost: 150
        });
        console.log('Trip Created:', tripRes.data._id);
        
        console.log('\n--- 4. Checking Assignment Engine Output ---');
        // Wait briefly for the async assignment engine to run (it has 100ms timeout)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const fetchTripRes = await api.get(`/trips/${tripRes.data._id}`);
        console.log('Trip Status after 2 seconds:', fetchTripRes.data.status);
        console.log('Assignment Info:', fetchTripRes.data.ownRiderAssignment);
    }
    
    console.log('\n✅ All tests completed successfully!');
  } catch (err: any) {
    console.error('\n❌ Test Failed:', err.response?.data || err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

runTests();
