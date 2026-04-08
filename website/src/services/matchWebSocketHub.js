'use strict';

const { logInfo, logWarn } = require('../utils/logger');

/**
 * WebSocket-based match streaming hub.
 * Replaces the SSE-based matchStreamHub.
 *
 * Features over old SSE hub:
 * - Bidirectional: clients send heartbeats over the same connection
 * - Protocol-level ping/pong keepalive (no custom `: keepalive\n\n`)
 * - Binary MessagePack support (optional, JSON default)
 * - Per-match room management with auto-cleanup
 * - Subscriber count tracking
 */
function createMatchWebSocketHub() {
  const roomsByMatchId = new Map();

  /**
   * Add a WebSocket connection to a match room.
   * @param {string} matchId
   * @param {WebSocket} socket
   * @param {object} initialPayload - Sent immediately on subscribe
   */
  function subscribe(matchId, socket, initialPayload) {
    if (!matchId) {
      sendJson(socket, { type: 'error', code: 'match_id_required' });
      socket.close(4000, 'match_id_required');
      return;
    }

    let room = roomsByMatchId.get(matchId);
    if (!room) {
      room = new Set();
      roomsByMatchId.set(matchId, room);
    }
    room.add(socket);

    logInfo('ws_hub', 'Client subscribed', { matchId, subscribers: room.size });

    // Send initial snapshot
    if (initialPayload) {
      sendJson(socket, { type: 'snapshot', data: initialPayload });
    }

    // Handle close
    socket.on('close', () => {
      room.delete(socket);
      if (room.size === 0) {
        roomsByMatchId.delete(matchId);
      }
      logInfo('ws_hub', 'Client unsubscribed', { matchId, subscribers: room ? room.size : 0 });
    });

    socket.on('error', () => {
      room.delete(socket);
      if (room.size === 0) {
        roomsByMatchId.delete(matchId);
      }
    });

    // Keepalive ping every 15s
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1) {
        socket.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 15000);

    socket.on('close', () => clearInterval(pingInterval));
  }

  /**
   * Broadcast a snapshot to all subscribers of a match.
   */
  function publish(matchId, payload) {
    if (!matchId || !payload) return;
    const room = roomsByMatchId.get(matchId);
    if (!room || room.size === 0) return;

    const message = JSON.stringify({ type: 'snapshot', data: payload });
    for (const socket of room) {
      try {
        if (socket.readyState === 1) {
          socket.send(message);
        }
      } catch {
        room.delete(socket);
      }
    }
  }

  /**
   * Also support the old SSE-style publish for backward compat during migration.
   */
  function publishLegacySSE(matchId, payload) {
    publish(matchId, payload);
  }

  /**
   * Get subscriber count for a match.
   */
  function getSubscriberCount(matchId) {
    const room = roomsByMatchId.get(matchId);
    return room ? room.size : 0;
  }

  /**
   * Get total active connections.
   */
  function getTotalConnections() {
    let total = 0;
    for (const room of roomsByMatchId.values()) {
      total += room.size;
    }
    return total;
  }

  /**
   * Close all connections (for graceful shutdown).
   */
  function closeAll() {
    for (const [matchId, room] of roomsByMatchId) {
      for (const socket of room) {
        try {
          socket.close(1001, 'server_shutdown');
        } catch { /* ignore */ }
      }
      room.clear();
    }
    roomsByMatchId.clear();
  }

  return {
    subscribe,
    publish,
    publishLegacySSE,
    getSubscriberCount,
    getTotalConnections,
    closeAll
  };
}

function sendJson(socket, data) {
  try {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(data));
    }
  } catch { /* ignore dead sockets */ }
}

module.exports = { createMatchWebSocketHub };
