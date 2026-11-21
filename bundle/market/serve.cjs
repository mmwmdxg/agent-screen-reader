// 本地插件市场索引服务：把同目录的 index.json 通过 http://127.0.0.1:47891/index.json 提供出去。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47891;
const INDEX = path.join(__dirname, 'index.json');

http.createServer((req, res) => {
  if (req.url === '/index.json' || req.url === '/') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('read error'); return; }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`索引已就绪: http://127.0.0.1:${PORT}/index.json`);
});
