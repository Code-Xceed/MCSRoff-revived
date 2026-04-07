'use strict';

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return '';
  }
  return value;
}

function sanitizeDisplayText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\r\n\t]/g, ' ').trim().substring(0, maxLength);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const divider = part.indexOf('=');
    if (divider < 0) {
      continue;
    }
    const key = part.substring(0, divider).trim();
    const value = part.substring(divider + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setCookie(response, name, value, maxAgeSeconds) {
  response.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, maxAgeSeconds)}`);
}

function clearCookie(response, name) {
  response.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  safeNext,
  sanitizeDisplayText,
  parseCookies,
  setCookie,
  clearCookie,
  escapeHtml
};
