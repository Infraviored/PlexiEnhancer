#!/usr/bin/env node
// Builds the extension for each browser from one shared source tree.
//
//   src/                    shared code, icons, libraries
//   src-<target>/           optional files only for that browser (copied over src/)
//   manifests/base.json     manifest keys common to all browsers
//   manifests/<target>.json per-browser overlay (deep-merged over base;
//                           objects merge, arrays replace, null deletes a key)
//
// Output: build/<target>/ (unpacked, load this in the browser) and
//         dist/<name>-<target>-<version>.zip (upload this to the store).
//
// Usage: node scripts/build.mjs [firefox] [chrome]   (default: both)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const name = readJson('package.json').name;
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['firefox', 'chrome'];

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

// Every file the manifest points at must exist in the build, or the browser refuses it.
function referencedFiles(m) {
  const files = [];
  const icons = o => o && typeof o === 'object' ? files.push(...Object.values(o)) : o && files.push(o);
  icons(m.icons);
  for (const a of [m.action, m.browser_action, m.page_action]) if (a) { icons(a.default_icon); a.default_popup && files.push(a.default_popup); }
  for (const cs of m.content_scripts || []) files.push(...(cs.js || []), ...(cs.css || []));
  if (m.background) files.push(...(m.background.scripts || []), ...(m.background.service_worker ? [m.background.service_worker] : []), ...(m.background.page ? [m.background.page] : []));
  if (m.options_ui) files.push(m.options_ui.page);
  if (m.options_page) files.push(m.options_page);
  for (const w of m.web_accessible_resources || []) files.push(...(typeof w === 'string' ? [w] : w.resources || []));
  return files.filter(f => typeof f === 'string' && !f.includes('*'));
}

for (const target of targets) {
  if (!existsSync(join(root, 'manifests', target + '.json'))) throw new Error('no manifests/' + target + '.json');
  const manifest = merge(readJson('manifests/base.json'), readJson('manifests/' + target + '.json'));
  const out = join(root, 'build', target);
  rmSync(out, { recursive: true, force: true });
  cpSync(join(root, 'src'), out, { recursive: true });
  if (existsSync(join(root, 'src-' + target))) cpSync(join(root, 'src-' + target), out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const missing = referencedFiles(manifest).filter(f => !existsSync(join(out, f)));
  if (missing.length) throw new Error(target + ': manifest references missing files: ' + missing.join(', '));

  mkdirSync(join(root, 'dist'), { recursive: true });
  const zip = join(root, 'dist', `${name}-${target}-${manifest.version}.zip`);
  rmSync(zip, { force: true });
  try {
    execFileSync('zip', ['-qr', '-X', zip, '.', '-x', '.*'], { cwd: out });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('the `zip` command is missing; install it (e.g. apt install zip). build/' + target + '/ is complete.');
    throw e;
  }
  console.log(`${target}: build/${target}/  dist/${name}-${target}-${manifest.version}.zip`);
}
