import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>(), calls: Request[] = [];
  const cache = {put: async (key: string,response: Response) => {entries.set(key,response);},match:async (key: string) => entries.get(key)?.clone()};
  let claimed = false, activated = false;
  const context = {URL,Request,Response,Set,Promise,
    self: {location:{href:'https://example.test/service-worker.js'},addEventListener:(name:string,cb: (e:any) => void) => handlers.set(name,cb),
      clients:{claim:async()=>{claimed=true;}},skipWaiting:async()=>{activated=true;}},
    caches:{open:async()=>cache,match:async(key:string)=>entries.get(key)?.clone()},
    fetch:async(request:Request)=>{calls.push(request);return new Response('bundled static asset');},
  };
  const template=readFileSync(new URL('../scripts/service-worker.js',import.meta.url),'utf8');
  vm.runInNewContext(template.replace('__VERSION__','test').replace('__ASSETS__',JSON.stringify(['index.html','assets/app.js','pyodide/pyodide.asm.wasm'])),context);
  const lifetime=async(name:string,extra:object={})=>{let work:Promise<unknown> | undefined;handlers.get(name)!({...extra,waitUntil:(p:Promise<unknown>)=>{work=p;}});await work;};
  const request=async(url:string,method='GET',navigate=false)=>{
    let result:Promise<Response> | undefined;
    const req=new Request(url,{method});
    handlers.get('fetch')!({request:navigate?{url:req.url,method,mode:'navigate'}:req,respondWith:(p:Promise<Response>)=>{result=p;}});
    return await result!;
  };
  return {calls,entries,lifetime,request,get claimed(){return claimed;},get activated(){return activated;}};
}

test('offline app is complete before activation; fetches serve cache without sending requests',async()=>{
  const w=worker(); await w.lifetime('install');
  assert.equal(w.calls.length,3);
  assert.ok(w.calls.every((r)=>r.method==='GET' && r.credentials==='omit' && r.redirect==='error'));
  assert.equal(w.activated,false);
  await w.lifetime('activate'); assert.equal(w.claimed,true);
  for(const url of ['https://example.test/','https://example.test/index.html','https://example.test/assets/app.js','https://example.test/pyodide/pyodide.asm.wasm']) {
    const res=await w.request(url,'GET',url.endsWith('/'));
    assert.equal(res.status,200); assert.equal(await res.text(),'bundled static asset');
  }
  assert.equal(w.calls.length,3);
  await w.lifetime('message',{data:'ACTIVATE_UPDATE'}); assert.equal(w.activated,true);
});

test('worker blocks uploads, query values, unbundled URLs and external requests without caching data',async()=>{
  const w=worker(); await w.lifetime('install');
  for(const [url,method] of [
    ['https://example.test/','POST'], ['https://example.test/assets/app.js?project=PRIVATE','GET'],
    ['https://example.test/api/project','POST'], ['https://example.test/PRIVATE','GET'],
    ['https://third-party.test/collect','GET'],
  ]) assert.equal((await w.request(url,method)).status,403);
  assert.equal(w.calls.length,3); assert.equal(w.entries.size,3);
  w.entries.delete('https://example.test/assets/app.js');
  assert.equal((await w.request('https://example.test/assets/app.js')).status,503);
  assert.equal(w.calls.length,3);
});

test('Vercel deploy is a static frontend with restrictive headers, no API or analytics',()=>{
  const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.outputDirectory,'desktop/dist');
  assert.equal(config.functions,undefined);
  const headers=config.headers[0].headers;
  assert.ok(headers.some((h:any)=>h.key==='Content-Security-Policy'&&h.value.includes("connect-src 'self'")&&h.value.includes("frame-ancestors 'none'")));
  assert.ok(headers.some((h:any)=>h.key==='Referrer-Policy'&&h.value==='no-referrer'));
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.display,'standalone'); assert.equal(manifest.start_url,'./');
});
