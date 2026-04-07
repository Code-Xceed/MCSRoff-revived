'use strict';

const fs = require('fs');
const { URLSearchParams } = require('url');

function serveStatic(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    sendPlain(response, 404, 'Not Found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.end(fs.readFileSync(filePath));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] || '';
  if (!raw) {
    return {};
  }
  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const body = {};
    for (const [key, value] of params.entries()) {
      body[key] = value;
    }
    return body;
  }
  return {};
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response, statusCode, html) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(html);
}

function sendPlain(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(body);
}

function redirect(response, location) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.end();
}

module.exports = {
  serveStatic,
  readBody,
  sendJson,
  sendHtml,
  sendPlain,
  redirect
};
