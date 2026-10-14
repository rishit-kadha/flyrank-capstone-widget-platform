import ipaddr from 'ipaddr.js';
import { z } from 'zod';

const geoSchema = z.object({ country: z.string().min(1).max(100), city: z.string().max(100), provider: z.string().min(1).max(30) });
export function isPublicIp(ip) {
  try { return ipaddr.process(ip).range() === 'unicast'; } catch { return false; }
}
export function createGeoService({ mode = 'mock', fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  async function json(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error('Geo provider unavailable');
    return response.json();
  }
  return {
    async lookup(ip, settings = {}) {
      if (mode === 'off') return null;
      if (mode !== 'mock' && !isPublicIp(ip)) return null;
      const providers = [
        async () => {
          if (settings.geo_a_down) throw new Error('Provider A disabled');
          if (mode === 'mock') return { country: 'India', city: 'Mumbai', provider: 'mock-a' };
          const data = await json('https://ipapi.co/' + encodeURIComponent(ip) + '/json/');
          if (data.error) throw new Error('Provider A rejected IP');
          return { country: data.country_name, city: data.city || '', provider: 'ipapi.co' };
        },
        async () => {
          if (settings.geo_b_down) throw new Error('Provider B disabled');
          if (mode === 'mock') return { country: 'United Kingdom', city: 'London', provider: 'mock-b' };
          const data = await json('https://ipwho.is/' + encodeURIComponent(ip));
          if (data.success !== true) throw new Error('Provider B rejected IP');
          return { country: data.country, city: data.city || '', provider: 'ipwho.is' };
        },
      ];
      for (const provider of providers) {
        try { return geoSchema.parse(await provider()); } catch { /* The next provider may still answer. */ }
      }
      return null;
    },
  };
}
