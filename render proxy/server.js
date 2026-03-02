const http = require('http');
const WebSocket = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const MAX_CONNECTIONS = 1000;

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

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    connectionCount--;
    
    if (targetWs) {
      targetWs.removeAllListeners();
      targetWs.terminate();
      targetWs = null;
    }

    if (clientWs) {
      clientWs.removeAllListeners();
      clientWs.terminate();
    }
  };

  clientWs.on('message', (data, isBinary) => {
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('close', (code, reason) => {
    cleanup();
  });
  
  clientWs.on('error', (err) => {
    console.error(`Client error: ${err.message}`);
    cleanup();
  });

  try {
    const parsedTarget = new URL(targetUrl);
    
    targetWs = new WebSocket(targetUrl, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024,
      handshakeTimeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://moomoo.io',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
        'Host': parsedTarget.host
      }
    });

    targetWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    targetWs.on('close', (code, reason) => {
      cleanup();
    });
    
    targetWs.on('error', (err) => {
      console.error(`Target error: ${err.message}`);
      cleanup();
    });

  } catch (error) {
    console.error(`Connection error: ${error.message}`);
    cleanup();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ WebSocket proxy on 0.0.0.0:${PORT}`);
  console.log(`✓ Max connections: ${MAX_CONNECTIONS}`);
});

server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
    process.exit(0);
  });
});