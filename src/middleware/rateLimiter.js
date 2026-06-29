const { redis } = require('../config/redis');

const rateLimiter = (limit = 20, windowSec = 60) => async (req, res, next) => {
  const key = `rate:${req.user?.id || req.ip}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, windowSec);
    if (current > limit) {
      return res.status(429).json({
        success: false,
        message: `Too many requests. Limit is ${limit} per ${windowSec}s`,
      });
    }
    next();
  } catch (err) {
    next();
  }
};

module.exports = rateLimiter;
