const http = require('http');
const https = require('https');
const { URL } = require('url');

module.exports = (req, res) => {
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
      method: req.method || 'GET',
      headers: clientHeaders,
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
      // 301, 302, 307, 308 HTTP 重定向处理
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        let redirectUrl = proxyRes.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = targetUrl.origin + redirectUrl;
        }
        return fetchUrl(redirectUrl, redirectCount + 1);
      }

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
};
