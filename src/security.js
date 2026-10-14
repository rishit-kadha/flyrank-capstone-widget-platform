import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = await derive(password, salt, 64);
  return 'scrypt:' + salt + ':' + digest.toString('hex');
}
export async function verifyPassword(password, stored) {
  const [format, salt, encoded] = (stored || '').split(':');
  if (format !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await derive(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const requestHash = value => sha256(JSON.stringify(value));
