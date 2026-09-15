// Small HTTP helpers shared by the routes.
import { randomBytes } from 'node:crypto';
import { AppError } from './errors.mjs';

export const requestId = () => randomBytes(6).toString('hex');

export function readCookie(c, name) {
  const raw = c.req.header('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Set-Cookie with exact attributes: HttpOnly; [Secure;] SameSite=Strict; Path; Max-Age. */
export function setCookie(c, name, value, { path = '/admin', maxAge, secure }) {
  c.header('Set-Cookie', `${name}=${value}; Path=${path}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}`, { append: true });
}
export const clearCookie = (c, name, opts) => setCookie(c, name, '', { ...opts, maxAge: 0 });

export async function jsonBody(c, { optional = false } = {}) {
  let body;
  try { body = await c.req.json(); }
  catch { if (optional) return {}; throw new AppError(400, 'bad_request', 'The request body must be JSON.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'bad_request', 'The request body must be a JSON object.');
  return body;
}

export const remoteOf = (c) => c.env?.incoming?.socket?.remoteAddress || c.env?.remoteAddress || '127.0.0.1';

/** If-Match -> the single ETag all values agree on, or null. */
export function ifMatchValue(header) {
  if (!header) return null;
  const vals = String(header).split(',').map((s) => s.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1')).filter(Boolean);
  if (!vals.length || vals.length > 4 || vals.some((v) => v !== vals[0])) return null;
  return vals[0];
}

export const fail = (status, code, message, details) => { throw new AppError(status, code, message, details); };
