import { Client } from "@googlemaps/google-maps-services-js";

import { calculateDistance } from './haversine';

const client = new Client({});
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

export async function getDistanceMatrix(origins: { lat: number, lng: number }[], destination: { lat: number, lng: number }) {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_KEY_HERE') {
      console.warn("GOOGLE_MAPS_API_KEY is missing. Returning mock distance matrix.");
      return mockDistanceMatrix(origins, destination);
  }
  
  if (origins.length === 0) {
    return [];
  }

  try {
    const response = await client.distancematrix({
      params: {
        origins: origins.map(o => ({ lat: o.lat, lng: o.lng })),
        destinations: [{ lat: destination.lat, lng: destination.lng }],
        departure_time: new Date(),
        key: GOOGLE_MAPS_API_KEY
      }
    });

    return response.data.rows.map((row) => {
      const element = row.elements[0];
      return {
        duration_in_traffic: element.duration_in_traffic || element.duration,
        distance: element.distance
      };
    });
  } catch (err: any) {
    if (err.response?.status === 403) {
      console.warn("Google Maps API returned 403 Forbidden. Returning mock distance matrix.");
      return mockDistanceMatrix(origins, destination);
    }
    throw err;
  }
}

function mockDistanceMatrix(origins: { lat: number, lng: number }[], destination: { lat: number, lng: number }) {
  return origins.map(origin => {
    const distKm = calculateDistance(origin.lat, origin.lng, destination.lat, destination.lng);
    const durationSec = Math.round((distKm / 30) * 3600); // assume 30 km/h
    return {
      distance: { text: `${distKm.toFixed(1)} km`, value: Math.round(distKm * 1000) },
      duration: { text: `${Math.round(durationSec / 60)} mins`, value: durationSec },
      duration_in_traffic: { text: `${Math.round(durationSec / 60)} mins`, value: durationSec },
      status: "OK"
    };
  });
}
