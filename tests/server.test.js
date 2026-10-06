const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
let child, root, port;
async function freePort() {
 const probe=net.createServer(); await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
 const result=probe.address().port; await new Promise(resolve=>probe.close(resolve)); return result;
}
beforeEach(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'bugboard-test-'));
 fs.copyFileSync(path.join(__dirname,'../server.js'),path.join(root,'server.js'));
 fs.cpSync(path.join(__dirname,'../public'),path.join(root,'public'),{recursive:true});
 port=await freePort();
 const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,PORT:String(port),HOST:'127.0.0.1'};
 child=spawn(process.execPath,[path.join(root,'server.js')],{env,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('test server startup timeout')),5000);
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('test server exit '+code));});
  child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
 });
});
afterEach(async()=>{
 if(child && child.exitCode===null && child.signalCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 fs.rmSync(root,{recursive:true,force:true});
});
function request(method,target,body,headers={},split=false) {
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?Buffer.alloc(0):Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const req=http.request({host:'127.0.0.1',port,path:target,method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':bytes.length})}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text)}));
  });
  req.setTimeout(3000,()=>req.destroy(new Error('request timeout')));req.once('error',reject);
  if(split){const index=bytes.indexOf(Buffer.from('中文'))+1;req.write(bytes.subarray(0,index));setTimeout(()=>req.end(bytes.subarray(index)),25);}
  else req.end(bytes);
 });
}
const bug={title:'测试问题标题',detail:'完整测试现象描述',qqName:'Tester'};
test('create, support, duplicate protection, persisted reload',async()=>{
 const start=await request('GET','/api/bugs');assert.equal(start.status,200);assert.ok(Array.isArray(start.json()));
 const created=await request('POST','/api/bugs',bug);assert.equal(created.status,201);const id=created.json().id;
 assert.equal((await request('POST','/api/bugs',bug)).status,409);
 assert.equal((await request('POST',`/api/bugs/${id}/support`,{qqName:'Other'})).status,200);
 assert.equal((await request('POST',`/api/bugs/${id}/support`,{qqName:'other'})).status,409);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/bugs.json'),'utf8')).find(b=>b.id===id).supporters.length,2);
});
test('malformed Host cannot crash server',async()=>{
 assert.equal((await request('GET','/api/bugs',undefined,{Host:'['})).status,400);
 assert.equal((await request('GET','/api/bugs')).status,200);
});
test('malformed JSON is a client error',async()=>{assert.equal((await request('POST','/api/bugs','{"broken"')).status,400);});
test('null JSON body is a client error',async()=>{assert.equal((await request('POST','/api/bugs','null')).status,400);});
test('array JSON body is a client error',async()=>{assert.equal((await request('POST','/api/bugs',[])).status,400);});
test('invalid URI encoding is a client error',async()=>{assert.equal((await request('GET','/%E0%A4%A')).status,400);});
test('oversized request has a 413 response and server survives',async()=>{
 assert.equal((await request('POST','/api/bugs',JSON.stringify({...bug,detail:'x'.repeat(40000)}))).status,413);
 assert.equal((await request('GET','/api/bugs')).status,200);
});
test('UTF8 characters split between packets remain intact',async()=>{
 const value={...bug,title:'中文问题测试标题'};
 const result=await request('POST','/api/bugs',JSON.stringify(value),{},true);
 assert.equal(result.status,201);assert.equal(result.json().title,value.title);
});
test('encoded traversal cannot read server source',async()=>{
 const result=await request('GET','/%2e%2e%2fserver.js');assert.equal(result.status,403);assert.ok(!result.text.includes('initialBugs'));
});
test('corrupt persisted data is not overwritten or leaked',async()=>{
 const file=path.join(root,'data/bugs.json');fs.writeFileSync(file,'corrupt-data');
 const result=await request('POST','/api/bugs',bug);assert.equal(result.status,500);
 assert.equal(fs.readFileSync(file,'utf8'),'corrupt-data');assert.ok(!result.json().error.includes('JSON'));
});
test('unknown API and public page retain expected behavior',async()=>{
 assert.equal((await request('GET','/api/not-found')).status,404);assert.equal((await request('GET','/')).status,200);
});
