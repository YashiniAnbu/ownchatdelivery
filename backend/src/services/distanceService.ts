import axios from 'axios';

// IMPORTANT: This service is intended for distance/radius calculations only.
// It must NOT be directly integrated into or replace any existing rider assignment
// or matching logic without manual approval and wiring.

// Startup configuration validation
// We check process.env.GOOGLE_MAPS_API_KEY dynamically rather than capturing it in a static constant.
// This prevents hoisting issues when dotenv is loaded after importing this module.
const getApiKey = () => process.env.GOOGLE_MAPS_API_KEY || '';

// Simple Cache for Distance Matrix calls
// Key: string (origins+destinations), Value: { timestamp: number, data: DistanceMatrixResult }
const distanceCache = new Map<string, { timestamp: number; data: DistanceMatrixResult }>();
const CACHE_TTL_MS = 45000; // 45 seconds

// Helper for delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Log startup warning if env not loaded yet (or if key is actually missing when app initializes)
setTimeout(() => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn(
      '[DistanceService] Warning: GOOGLE_MAPS_API_KEY environment variable is not defined or is empty. Google Maps API calls will fail.'
    );
  }
}, 1000);

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface DistanceElement {
  distance?: {
    text: string;
    value: number; // meters
  };
  duration?: {
    text: string;
    value: number; // seconds
  };
  status: string; // "OK", "NOT_FOUND", "ZERO_RESULTS", "MAX_ROUTE_LENGTH_EXCEEDED"
}

export interface DistanceResult {
  distanceKm?: number;
  durationMinutes?: number;
  status: string; // "OK", "ERROR", etc.
  errorMessage?: string;
}

export interface DistanceMatrixResult {
  rows?: {
    elements: DistanceElement[];
  }[];
  originAddresses?: string[];
  destinationAddresses?: string[];
  status: string; // "OK", "INVALID_REQUEST", "MAX_ELEMENTS_EXCEEDED", "OVER_QUERY_LIMIT", "REQUEST_DENIED", "UNKNOWN_ERROR", "ERROR"
  errorMessage?: string;
}

/**
 * Converts a GeoJSON Point to the LatLng format expected by Google Maps
 */
export function geoJsonToLatLng(geo: GeoJSONPoint): LatLng {
  if (!geo || geo.type !== 'Point' || !Array.isArray(geo.coordinates) || geo.coordinates.length < 2) {
    throw new Error('Invalid GeoJSON Point coordinates');
  }
  return {
    lat: geo.coordinates[1],
    lng: geo.coordinates[0],
  };
}

/**
 * Converts a LatLng object to a GeoJSON Point
 */
export function latLngToGeoJson(latLng: LatLng): GeoJSONPoint {
  if (typeof latLng.lat !== 'number' || typeof latLng.lng !== 'number') {
    throw new Error('Invalid LatLng coordinate');
  }
  return {
    type: 'Point',
    coordinates: [latLng.lng, latLng.lat],
  };
}

/**
 * Converts local location model { latitude, longitude } to LatLng
 */
export function locationToLatLng(loc: { latitude: number | null; longitude: number | null }): LatLng {
  if (loc.latitude === null || loc.longitude === null || loc.latitude === undefined || loc.longitude === undefined) {
    throw new Error('Coordinate contains null or undefined values');
  }
  return {
    lat: loc.latitude,
    lng: loc.longitude,
  };
}

/**
 * Calculates distance and duration between a single origin and destination
 */
export async function getDistance(origin: LatLng, destination: LatLng): Promise<DistanceResult> {
  // Validate coordinates
  if (
    typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
    typeof destination.lat !== 'number' || typeof destination.lng !== 'number'
  ) {
    return {
      status: 'INVALID_COORDINATES',
      errorMessage: 'Origin or destination coordinates are invalid or missing.'
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      status: 'API_KEY_MISSING',
      errorMessage: 'Google Maps API key is not configured.'
    };
  }

  try {
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;

    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: {
        origins: originStr,
        destinations: destStr,
        key: apiKey,
      },
      timeout: 10000 // 10s timeout
    });

    const data = response.data;

    if (data.status !== 'OK') {
      return {
        status: data.status,
        errorMessage: data.error_message || `API error with status ${data.status}`
      };
    }

    const row = data.rows?.[0];
    const element = row?.elements?.[0];

    if (!element) {
      return {
        status: 'NO_ELEMENTS',
        errorMessage: 'Response contained no elements.'
      };
    }

    if (element.status !== 'OK') {
      return {
        status: element.status,
        errorMessage: `Calculations failed with status ${element.status}`
      };
    }

    const distanceKm = element.distance.value / 1000;
    const durationMinutes = element.duration.value / 60;

    return {
      distanceKm,
      durationMinutes,
      status: 'OK'
    };
  } catch (error: any) {
    return {
      status: 'ERROR',
      errorMessage: error.response?.data?.error_message || error.message || 'Unknown HTTP/API error'
    };
  }
}

/**
 * Batch distance calculation for multiple origins/destinations with Cache and Retry (Exponential Backoff)
 */
export async function getDistanceMatrix(origins: LatLng[], destinations: LatLng[]): Promise<DistanceMatrixResult> {
  if (!origins || origins.length === 0 || !destinations || destinations.length === 0) {
    return {
      status: 'INVALID_REQUEST',
      errorMessage: 'Origins and destinations arrays must not be empty.'
    };
  }

  // Validate coordinates
  for (const origin of origins) {
    if (typeof origin.lat !== 'number' || typeof origin.lng !== 'number') {
      return {
        status: 'INVALID_COORDINATES',
        errorMessage: 'One or more origin coordinates are invalid.'
      };
    }
  }
  for (const dest of destinations) {
    if (typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
      return {
        status: 'INVALID_COORDINATES',
        errorMessage: 'One or more destination coordinates are invalid.'
      };
    }
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      status: 'API_KEY_MISSING',
      errorMessage: 'Google Maps API key is not configured.'
    };
  }

  const originsStr = origins.map(o => `${o.lat},${o.lng}`).join('|');
  const destinationsStr = destinations.map(d => `${d.lat},${d.lng}`).join('|');
  
  // Cache check
  const cacheKey = `${originsStr}::${destinationsStr}`;
  const cached = distanceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  let attempt = 0;
  const maxAttempts = 3; // Initial + 2 retries
  const backoffDelays = [500, 1500]; // 500ms, then 1500ms

  while (attempt < maxAttempts) {
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        params: {
          origins: originsStr,
          destinations: destinationsStr,
          key: apiKey,
        },
        timeout: 10000 // 10s timeout
      });

      const data = response.data;

      if (data.status !== 'OK') {
        // If it's a structural API error (e.g. OVER_QUERY_LIMIT, REQUEST_DENIED), we still might want to fail fast
        // But for things like rate limit, we can retry.
        if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'UNKNOWN_ERROR') {
          throw new Error(`API error with status ${data.status}: ${data.error_message || ''}`);
        }
        return {
          status: data.status,
          errorMessage: data.error_message || `API error with status ${data.status}`
        };
      }

      const result: DistanceMatrixResult = {
        rows: data.rows,
        originAddresses: data.origin_addresses,
        destinationAddresses: data.destination_addresses,
        status: 'OK'
      };

      // Save to cache
      distanceCache.set(cacheKey, { timestamp: Date.now(), data: result });
      
      // Cleanup old cache entries randomly or periodically (simple prune here)
      if (distanceCache.size > 100) {
        const now = Date.now();
        for (const [key, val] of distanceCache.entries()) {
          if (now - val.timestamp > CACHE_TTL_MS) distanceCache.delete(key);
        }
      }

      return result;
    } catch (error: any) {
      attempt++;
      if (attempt < maxAttempts) {
        const delay = backoffDelays[attempt - 1];
        console.warn(`[DistanceService] API call failed (attempt ${attempt}). Retrying in ${delay}ms... Error: ${error.message}`);
        await sleep(delay);
      } else {
        return {
          status: 'ERROR',
          errorMessage: error.response?.data?.error_message || error.message || 'Unknown HTTP/API error after retries'
        };
      }
    }
  }

  return { status: 'ERROR', errorMessage: 'Max retries exceeded' };
}
