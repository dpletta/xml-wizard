import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dist = path.resolve(import.meta.dirname, '../dist');
function walk(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap((f) => f.isDirectory() ? walk(path.join(dir,f.name)) : [path.join(dir,f.name)]); }
const files = walk(dist).filter((f) => !f.endsWith('/service-worker.js')).sort();
const hash = createHash('sha256');
for (const f of files) { hash.update(path.relative(dist,f)); hash.update(fs.readFileSync(f)); }
const paths = files.map((f) => path.relative(dist,f));
const template = fs.readFileSync(path.resolve(import.meta.dirname,'service-worker.js'), 'utf8');
fs.writeFileSync(path.join(dist,'service-worker.js'), template.replace('__VERSION__', hash.digest('hex').slice(0,20)).replace('__ASSETS__', JSON.stringify(paths)));
console.log(`PWA: ${paths.length} static assets; no user files cached by the service worker`);
