// Small static server for the Trude demo. It only serves the three named app
// assets from this folder; requests cannot read arbitrary local files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const asset = assets.get(pathname);
  if (!asset || request.method !== 'GET') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const file = path.join(root, asset[0]);
  fs.readFile(file, (error, contents) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to read app asset');
      return;
    }
    response.writeHead(200, { 'Content-Type': asset[1], 'X-Content-Type-Options': 'nosniff' });
    response.end(contents);
  });
}).listen(4173, '0.0.0.0', () => console.log('Trude demo: http://localhost:4173'));
