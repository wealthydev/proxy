const http = require('http');
const WebSocket = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const MAX_CONNECTIONS = 1000;
const HEARTBEAT_INTERVAL = 30000;

let connectionCount = 0;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: "ok", connections: connectionCount }));
});

const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false,
  maxPayload: 256 * 1024,
  clientTracking: true
});

wss.on('connection', (clientWs, req) => {
  if (connectionCount >= MAX_CONNECTIONS) {
    clientWs.close(1008, 'Capacity reached');
    return;
  }

  connectionCount++;
  
  const reqUrl = new URL(req.url.replace(/^\/+/, '/'), `http://${req.headers.host}`);
  const targetUrl = reqUrl.searchParams.get('target');
  
  if (!targetUrl) {
    clientWs.close(1008, 'Missing target');
    connectionCount--;
    return;
  }

  let targetWs = null;
  let cleaned = false;
  let pingInterval = null;
  clientWs.isAlive = true;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    connectionCount--;
    
    if (pingInterval) clearInterval(pingInterval);
    
    if (targetWs) {
      targetWs.removeAllListeners();
      targetWs.terminate();
      targetWs = null;
    }

    clientWs.removeAllListeners();
    clientWs.terminate();
  };

  clientWs.on('message', (data, isBinary) => {
    if (data.toString() === 'pong') {
      clientWs.isAlive = true;
      return;
    }
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('pong', () => {
    clientWs.isAlive = true;
  });

  clientWs.on('close', cleanup);
  clientWs.on('error', cleanup);

  try {
    targetWs = new WebSocket(targetUrl, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024,
      handshakeTimeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://moomoo.io'
      }
    });

    targetWs.on('open', () => {
      pingInterval = setInterval(() => {
        if (clientWs.isAlive === false) {
          cleanup();
          return;
        }
        clientWs.isAlive = false;
        clientWs.ping();
      }, HEARTBEAT_INTERVAL);
    });

    targetWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    targetWs.on('close', cleanup);
    targetWs.on('error', cleanup);

  } catch (error) {
    cleanup();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket proxy with heartbeats on 0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    wss.clients.forEach(ws => ws.terminate());
    process.exit(0);
  });
});
//fly deploy -a cloud-proxy-server-purple-fire-5296