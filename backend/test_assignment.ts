import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { getShortlistedRiders } from './src/services/assignmentEngine';
import Org from './src/models/Org';
import Delivery from './src/models/Delivery';

async function test() {
  await mongoose.connect(process.env.MONGO_URI as string);
  const org = await Org.findOne({});
  if (!org) return console.log('No org');

  const deliveryId = '6a54bc45965ee96a0468e5e0';
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) { console.log('Delivery not found'); return; }

  const deliveryOrg = await Org.findById(delivery.ownchatOrgId);
  if (!deliveryOrg) { console.log('Org not found'); return; }

  const { getNearbyRiders } = require('./src/services/redisGeoService');
  const nearby = await getNearbyRiders(delivery.pickup.latitude, delivery.pickup.longitude, 5000);
  console.log('Nearby:', nearby);

  const { getShortlistedRiders } = require('./src/services/assignmentEngine');
  const shortlisted = await getShortlistedRiders(deliveryOrg.id, deliveryOrg, delivery.pickup.latitude, delivery.pickup.longitude);
  console.log('Shortlisted:', shortlisted);
  process.exit(0);
}

test().catch(console.error);
