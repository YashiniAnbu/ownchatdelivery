import redisClient from '../config/redis';

const RIDER_GEO_KEY = 'riders:locations';

export async function updateRiderLocation(riderId: string, lat: number, lng: number, heading: number, speed: number) {
  // GEOADD key longitude latitude member
  await redisClient.geoadd(RIDER_GEO_KEY, lng, lat, riderId);
  await redisClient.setex(`rider:last_seen:${riderId}`, 120, '1'); 
}

export async function getNearbyRiders(lat: number, lng: number, radiusKm: number = 10) {
  // GEOSEARCH key FROMLONLAT longitude latitude BYRADIUS radius km ASC WITHDIST WITHCOORD
  const results = await redisClient.geosearch(
    RIDER_GEO_KEY,
    'FROMLONLAT', lng, lat,
    'BYRADIUS', radiusKm, 'km',
    'ASC',
    'WITHDIST',
    'WITHCOORD'
  ) as unknown as any[][];
  
  return results.map(res => ({
    riderId: res[0],
    distance: parseFloat(res[1]),
    lng: parseFloat(res[2][0]),
    lat: parseFloat(res[2][1])
  }));
}

export async function removeRiderLocation(riderId: string) {
  await redisClient.zrem(RIDER_GEO_KEY, riderId);
  await redisClient.del(`rider:last_seen:${riderId}`);
}

export async function checkArrivalDistance(riderId: string, tripId: string, pickupLat: number, pickupLng: number): Promise<number | null> {
  const pickupKey = `pickup:${tripId}`;
  
  // Temporarily add pickup location to GEO index to calculate distance
  await redisClient.geoadd(RIDER_GEO_KEY, pickupLng, pickupLat, pickupKey);
  
  // Calculate distance in meters ('m')
  const distanceStr = await redisClient.geodist(RIDER_GEO_KEY, riderId, pickupKey, 'm' as any);
  
  // Clean up the temporary pickup marker
  await redisClient.zrem(RIDER_GEO_KEY, pickupKey);
  
  if (distanceStr) {
    return parseFloat(distanceStr);
  }
  return null;
}
