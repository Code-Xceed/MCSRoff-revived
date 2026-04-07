'use strict';

function createMatchStreamHub() {
  const subscribersByMatchId = new Map();

  function subscribe(matchId, request, response, initialPayload) {
    if (!matchId) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end('{"error":"match_id is required"}\n');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write('retry: 1500\n\n');

    const subscriber = {
      response,
      keepAliveTimer: setInterval(() => {
        try {
          response.write(': keepalive\n\n');
        } catch (error) {
          removeSubscriber(matchId, subscriber);
        }
      }, 15000)
    };

    let subscribers = subscribersByMatchId.get(matchId);
    if (!subscribers) {
      subscribers = new Set();
      subscribersByMatchId.set(matchId, subscribers);
    }
    subscribers.add(subscriber);

    const cleanup = () => removeSubscriber(matchId, subscriber);
    request.on('close', cleanup);
    request.on('aborted', cleanup);
    response.on('close', cleanup);
    response.on('error', cleanup);

    if (initialPayload) {
      writeSnapshot(response, initialPayload);
    }
  }

  function publish(matchId, payload) {
    if (!matchId || !payload) {
      return;
    }

    const subscribers = subscribersByMatchId.get(matchId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    for (const subscriber of Array.from(subscribers)) {
      try {
        writeSnapshot(subscriber.response, payload);
      } catch (error) {
        removeSubscriber(matchId, subscriber);
      }
    }
  }

  function removeSubscriber(matchId, subscriber) {
    if (!subscriber) {
      return;
    }
    if (subscriber.keepAliveTimer) {
      clearInterval(subscriber.keepAliveTimer);
    }

    const subscribers = subscribersByMatchId.get(matchId);
    if (!subscribers) {
      return;
    }

    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      subscribersByMatchId.delete(matchId);
    }
  }

  return {
    subscribe,
    publish
  };
}

function writeSnapshot(response, payload) {
  response.write('event: snapshot\n');
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

module.exports = {
  createMatchStreamHub
};
