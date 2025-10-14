// Backend/redisClient.js
const { createClient } = require('redis');

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const client = createClient({ url });

client.on('error', (err) => console.error('[redis] error', err));
client.on('connect', () => console.log('[redis] connected:', url.split('@').pop()));

let ready = false;
(async () => {
  try { await client.connect(); ready = true; } catch (e) { console.warn('[redis] connect failed', e.message); }
})();

async function cacheGet(key) {
  if (!ready) return null;
  try { return await client.get(key); } catch { return null; }
}
async function cacheSet(key, val, ttlSec = 15) {
  if (!ready) return;
  try { await client.set(key, val, { EX: ttlSec }); } catch {}
}

module.exports = { client, cacheGet, cacheSet };
