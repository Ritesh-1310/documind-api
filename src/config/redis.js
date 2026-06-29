const { Redis } = require('ioredis');
const env = require('./env');

// Default redis client (for caching, rate limiting)
const redis = new Redis(env.REDIS_URL);

// BullMQ requires maxRetriesPerRequest: null
const bullRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));

module.exports = { redis, bullRedis };
