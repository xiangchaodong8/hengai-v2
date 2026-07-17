#!/usr/bin/env node
/** 为所有 HengAI_*.html 注入 module-pipeline + embed-boot */
const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '..');
const PIPE = 'hengai-module-pipeline.js';
const BOOT = 'hengai-embed-boot.js';
const tags =
  '<script src="hengai-module-pipeline.js"></script>\n' +
  '<script src="hengai-embed-boot.js"></script>\n';

const files = fs.readdirSync(frontendDir).filter((f) => /^HengAI_.*\.html$/i.test(f));
let updated = 0;

for (const f of files) {
  const p = path.join(frontendDir, f);
  let c = fs.readFileSync(p, 'utf8');
  const hasPipe = c.includes(PIPE);
  const hasBoot = c.includes(BOOT);
  if (hasPipe && hasBoot) {
    console.log('skip:', f);
    continue;
  }
  if (!/<\/body>/i.test(c)) {
    console.warn('no body:', f);
    continue;
  }
  if (hasBoot && !hasPipe) {
    c = c.replace(
      new RegExp('<script src="' + BOOT.replace('.', '\\.') + '"><\\/script>\\s*', 'i'),
      tags
    );
  } else if (!hasBoot) {
    c = c.replace(/<\/body>/i, tags + '</body>');
  }
  fs.writeFileSync(p, c, 'utf8');
  updated++;
  console.log('patched:', f);
}
console.log('Done:', updated, 'files');
