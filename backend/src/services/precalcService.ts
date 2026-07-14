import ngeohash from 'ngeohash';
import ZoneDistanceMatrix from '../models/ZoneDistanceMatrix';
import TrafficMultiplier from '../models/TrafficMultiplier';

const GEOHASH_PRECISION = 5; // Approx 5km x 5km

/**
 * Gets a precalculated, rough estimate of duration and distance before any live API call.
 * Uses historical zone-to-zone averages modified by current traffic multipliers.
 */
export async function getPrecalculatedEstimate(originLat: number, originLng: number, destLat: number, destLng: number): Promise<{ duration_seconds: number, distance_meters: number } | null> {
  try {
    const originZone = ngeohash.encode(originLat, originLng, GEOHASH_PRECISION);
    const destZone = ngeohash.encode(destLat, destLng, GEOHASH_PRECISION);

    const matrixEntry = await ZoneDistanceMatrix.findOne({
      origin_zone: originZone,
      destination_zone: destZone
    });

    if (!matrixEntry) {
      return null; // No historical data for this route, must rely on live API
    }

    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    const trafficData = await TrafficMultiplier.findOne({
      hour_of_day: hour,
      day_of_week: day
    });

    const multiplier = trafficData ? trafficData.multiplier : 1.0;

    return {
      duration_seconds: Math.round(matrixEntry.average_duration_seconds * multiplier),
      distance_meters: matrixEntry.average_distance_meters
    };
  } catch (error) {
    console.error('[Precalc Service] Error getting estimate:', error);
    return null;
  }
}
