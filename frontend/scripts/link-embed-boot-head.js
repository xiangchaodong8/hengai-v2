#!/usr/bin/env node
/**
 * V4.5 · 子模块 <head> 唯一挂载 hengai-embed-boot.js，移除 body 重复引用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOT_TAG = '<script src="hengai-embed-boot.js"></script>';
const BOOT_RE = /<script\s+src=["']hengai-embed-boot\.js["']\s*><\/script>\s*/gi;

const files = fs.readdirSync(ROOT).filter((f) => /^HengAI_.*\.html$/i.test(f));
let updated = 0;

for (const f of files) {
  let html = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
  const hadBoot = BOOT_RE.test(html);
  BOOT_RE.lastIndex = 0;
  html = html.replace(BOOT_RE, '');
  const headClose = html.search(/<\/head>/i);
  if (headClose < 0) {
    console.warn('no </head>:', f);
    continue;
  }
  const headSlice = html.slice(0, headClose);
  if (!headSlice.includes('hengai-embed-boot.js')) {
    html = html.slice(0, headClose) + BOOT_TAG + '\n' + html.slice(headClose);
  }
  if (hadBoot || !headSlice.includes('hengai-embed-boot.js')) {
    fs.writeFileSync(path.join(ROOT, f), html, 'utf8');
    updated++;
    console.log('linked head:', f);
  } else {
    console.log('ok:', f);
  }
}

console.log('\nDone:', updated, 'files updated');
