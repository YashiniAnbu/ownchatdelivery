import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

console.log(`[Redis] Connecting to Redis: ${REDIS_HOST}:${REDIS_PORT}...`);

let retryCount = 0;
const MAX_RETRIES = 5;

const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  lazyConnect: true,         // Don't connect until first command
  enableOfflineQueue: false,  // Don't queue commands when disconnected
  maxRetriesPerRequest: 0,   // Fail immediately instead of retrying per-request
  retryStrategy(times) {
    retryCount = times;
    if (times > MAX_RETRIES) {
      return null; // stop retrying
    }
    return Math.min(times * 1000, 5000);
  }
});

redisClient.on('connect', () => {
  retryCount = 0;
  console.log('[Redis] Connected successfully.');
});

redisClient.on('error', (err) => {
  if (retryCount <= MAX_RETRIES) {
    if ((err as any).code === 'ECONNREFUSED') {
      console.error(`[Redis] Connection refused (attempt ${retryCount}/${MAX_RETRIES}). Is Redis running on ${REDIS_HOST}:${REDIS_PORT}?`);
    }
  }
  if (retryCount > MAX_RETRIES) {
    console.error('[Redis] Could not connect after max retries. Redis features will be disabled.');
  }
});

// Attempt connection in background — app continues without Redis
redisClient.connect().catch(() => {});

export default redisClient;

// Helper to check if Redis is usable before running commands
export function isRedisReady(): boolean {
  return redisClient.status === 'ready';
}
