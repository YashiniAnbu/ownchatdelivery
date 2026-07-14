import { Client } from "@googlemaps/google-maps-services-js";
import GeocodeCache from '../models/GeocodeCache';
import axios from 'axios';

const client = new Client({});
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

export async function resolveAddress(address: string) {
  const cached = await GeocodeCache.findOne({ address_text: address });
  if (cached) {
    cached.last_used_at = new Date();
    await cached.save();
    return { lat: cached.lat, lng: cached.lng, formatted_address: cached.formatted_address, place_id: cached.place_id };
  }

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_KEY_HERE') {
      console.warn("GOOGLE_MAPS_API_KEY is missing or invalid. Returning mock geocode.");
      return mockGeocode(address);
  }

  try {
    const response = await client.geocode({
      params: {
        address,
        key: GOOGLE_MAPS_API_KEY,
        components: `country:${process.env.GEOCODE_DEFAULT_COUNTRY || 'IN'}`
      }
    });

    if (response.data.results.length === 0) {
      throw new Error('Address not found');
    }

    const result = response.data.results[0];
    const { lat, lng } = result.geometry.location;
    const formatted_address = result.formatted_address;
    const place_id = result.place_id;

    const newCache = new GeocodeCache({
      address_text: address,
      lat,
      lng,
      formatted_address,
      place_id
    });
    await newCache.save();

    return { lat, lng, formatted_address, place_id };
  } catch (err: any) {
    if (err.response?.status === 403) {
      console.warn("Google Maps API returned 403 Forbidden. Returning mock geocode.");
      return mockGeocode(address);
    }
    throw err;
  }
}

function mockGeocode(address: string) {
  // Generate slightly random coordinates around Chennai for testing
  const lat = 12.9 + Math.random() * 0.2;
  const lng = 80.1 + Math.random() * 0.2;
  return {
    lat,
    lng,
    formatted_address: `${address} (Mocked Resolution)`,
    place_id: `mock_place_${Date.now()}`
  };
}

export async function resolveMapsUrl(url: string) {
  let expandedUrl = url;
  
  if (url.includes('maps.app.goo.gl') || url.includes('goo.gl')) {
    try {
      const response = await axios.get(url, { maxRedirects: 5 });
      expandedUrl = response.request.res.responseUrl || expandedUrl;
    } catch (err: any) {
      if (err.request && err.request.res) {
        expandedUrl = err.request.res.responseUrl || expandedUrl;
      }
    }
  }

  const atMatch = expandedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    return await resolveReverseGeocode(lat, lng);
  }
  
  const qMatch = expandedUrl.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    return await resolveReverseGeocode(lat, lng);
  }

  let placeName = 'Unknown Place';
  const placeMatch = expandedUrl.match(/\/place\/([^\/]+)/);
  if (placeMatch) {
    placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
  }
  return await resolveAddress(placeName);
}

export async function resolveReverseGeocode(lat: number, lng: number) {
  if (!GOOGLE_MAPS_API_KEY) {
    return { lat, lng, formatted_address: `${lat}, ${lng}`, place_id: null };
  }

  const response = await client.reverseGeocode({
    params: {
      latlng: { lat, lng },
      key: GOOGLE_MAPS_API_KEY
    }
  });

  if (response.data.results.length === 0) {
    return { lat, lng, formatted_address: `${lat}, ${lng}`, place_id: null };
  }

  const result = response.data.results[0];
  return {
    lat,
    lng,
    formatted_address: result.formatted_address,
    place_id: result.place_id
  };
}
