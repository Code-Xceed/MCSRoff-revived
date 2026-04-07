'use strict';

const crypto = require('crypto');

function sanitizeRequestId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    return '';
  }
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : '';
}

function getClientIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  const forwarded = request.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.trim();
  }
  return request.socket && request.socket.remoteAddress
    ? String(request.socket.remoteAddress)
    : 'unknown';
}

function applyDefaultSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

function createRequestContext(request, response) {
  const requestId = sanitizeRequestId(request.headers['x-request-id']) || crypto.randomUUID();
  const context = {
    id: requestId,
    startedAt: Date.now(),
    ip: getClientIp(request),
    method: request.method || 'GET',
    path: request.url || '/'
  };
  request.context = context;
  response.setHeader('X-Request-Id', requestId);
  applyDefaultSecurityHeaders(response);
  return context;
}

module.exports = {
  createRequestContext,
  getClientIp
};
