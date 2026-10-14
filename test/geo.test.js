import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeoService, isPublicIp } from '../src/geo.js';

test('live geolocation does not send private, loopback, invalid, or mapped private IPs to providers', async () => {
  let calls = 0;
  const service = createGeoService({ mode: 'live', fetchImpl: async () => { calls++; throw new Error('Should not fetch'); } });
  for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.5', '169.254.169.254', '::ffff:127.0.0.1', 'not-an-ip']) {
    assert.equal(isPublicIp(ip), false);
    assert.equal(await service.lookup(ip), null);
  }
  assert.equal(calls, 0);
  assert.equal(isPublicIp('8.8.8.8'), true);
});

test('live provider A is used when its response is valid', async () => {
  const calls = [];
  const service = createGeoService({ mode: 'live', fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ country_name: 'India', city: 'Mumbai' });
  } });
  assert.deepEqual(await service.lookup('8.8.8.8'), { country: 'India', city: 'Mumbai', provider: 'ipapi.co' });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).hostname, 'ipapi.co');
});

test('live provider B handles primary HTTP errors, invalid responses, and rejected requests', async () => {
  for (const primary of [
    async () => new Response('Unavailable', { status: 503 }),
    async () => Response.json({ country_name: 123, city: 'Invalid country' }),
    async () => { throw new TypeError('Local simulated connection failure'); },
  ]) {
    const calls = [];
    const service = createGeoService({ mode: 'live', fetchImpl: async url => {
      calls.push(url);
      if (new URL(url).hostname === 'ipapi.co') return primary();
      return Response.json({ success: true, country: 'United Kingdom', city: 'London' });
    } });
    assert.deepEqual(await service.lookup('8.8.8.8'), { country: 'United Kingdom', city: 'London', provider: 'ipwho.is' });
    assert.equal(calls.length, 2);
  }
});

test('unavailable or invalid live providers result in null enrichment', async () => {
  const unavailable = createGeoService({ mode: 'live', fetchImpl: async () => { throw new Error('Both providers unavailable'); } });
  assert.equal(await unavailable.lookup('8.8.8.8'), null);
  const invalid = createGeoService({ mode: 'live', fetchImpl: async () => Response.json({ success: false, error: true }) });
  assert.equal(await invalid.lookup('8.8.8.8'), null);
});

test('disabled enrichment makes no provider requests', async () => {
  const service = createGeoService({ mode: 'off', fetchImpl: async () => assert.fail('Provider must not be called') });
  assert.equal(await service.lookup('8.8.8.8'), null);
});
