const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 视频流 Range 代理端点 (全跨域 CORS 支持与防盗链 Header 透传)
 */
app.get('/api/proxy', (req, res) => {
  const targetUrlStr = req.query.url;
  if (!targetUrlStr) {
    return res.status(400).send('Missing url parameter');
  }

  function fetchUrl(currentUrlStr, redirectCount = 0) {
    if (redirectCount > 5) {
      return res.status(508).send('Too many redirects');
    }

    let targetUrl;
    try {
      targetUrl = new URL(currentUrlStr);
    } catch (e) {
      return res.status(400).send('Invalid url format');
    }

    const customReferer = req.query.referer || targetUrl.origin;
    const customUserAgent = req.query.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const clientHeaders = {};
    if (req.headers.range) {
      clientHeaders['Range'] = req.headers.range;
    }
    clientHeaders['Referer'] = customReferer;
    clientHeaders['User-Agent'] = customUserAgent;

    const requestModule = targetUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: clientHeaders,
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
      // 处理 301, 302, 307, 308 HTTP 重定向
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        let redirectUrl = proxyRes.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = targetUrl.origin + redirectUrl;
        }
        return fetchUrl(redirectUrl, redirectCount + 1);
      }

      // 转发响应状态码与关键 Content Header
      res.status(proxyRes.statusCode);

      const headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      headersToForward.forEach((h) => {
        if (proxyRes.headers[h]) {
          res.setHeader(h, proxyRes.headers[h]);
        }
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Cache-Control', 'no-cache');

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy Error:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Video Proxy Error: ' + err.message);
      }
    });

    proxyReq.end();
  }

  fetchUrl(targetUrlStr, 0);
});

function startServer(portToTry) {
  const server = app.listen(portToTry, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` Meta Quest 2D-to-3D Web Server Started Successfully!  `);
    console.log(` Access URL: http://localhost:${portToTry}             `);
    console.log(` Open this URL in Meta Quest Browser for 3D VR Mode!    `);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ 端口 ${portToTry} 已被占用，正在尝试端口 ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
