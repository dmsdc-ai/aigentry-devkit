"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const REPO = path.resolve(__dirname, "..");
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";
process.umask(0o077);
// Bounded JS tripwires, not universal syscall attribution.
function guard() {
 const fs = require("fs"), Module = require("module");
 const fail = () => { throw Error("EARLY_EFFECT"); };
 const modules = ["child_process","net","tls","http","https","dgram"].map(id => require(id));
 for (const m of modules) {
  for (const k of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork","connect","createConnection","createServer","request","get","createSocket"]) if (typeof m[k] === "function") m[k] = fail;
 }
 require("net").Socket.prototype.connect = fail;
 require("net").Server.prototype.listen = fail;
 global.fetch = fail;
 const load = Module._load;
 Module._load = function(id, ...rest) {
  if (/logger/.test(id)) throw Error("LOGGER_IMPORT");
  return load.call(this, id, ...rest);
 };
 if (process.env.TEST_NO_WRITES === "1") {
  for (const key of ["writeFileSync","appendFileSync","mkdirSync","renameSync","unlinkSync","rmSync","chmodSync","symlinkSync","linkSync","truncateSync","writeSync","createWriteStream"]) fs[key] = fail;
  const open = fs.openSync;
  fs.openSync = function(p, flags, ...rest) {
   if (flags !== "r" && flags !== 0) fail();
   return open.call(this,p,flags,...rest);
  };
 }
}
const GUARD = "(" + guard.toString() + ")();\n";
function fixture() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup1193-"));
 for (const d of ["home","tmp","package/bin","package/lib","package/config"]) fs.mkdirSync(path.join(root,d),{recursive:true,mode:0o700});
 fs.cpSync(path.join(REPO,"lib"),path.join(root,"package","lib"),{recursive:true});
 for (const f of ["bin/aigentry-devkit.js","lib/setup.js","lib/install-state.js","config/installer-manifest.json","config/setup-capabilities.json","package.json"]) {
  if(fs.existsSync(path.join(REPO,f))) fs.copyFileSync(path.join(REPO,f),path.join(root,"package",f));
 }
 fs.writeFileSync(path.join(root,"guard.cjs"),GUARD);
 return {root, home:path.join(root,"home"), pkg:path.join(root,"package"), dir:path.join(root,"home","aigentry-devkit")};
}
function snapshot(root) {
 const out = {};
 function walk(p) {
  const s=fs.lstatSync(p), rel=path.relative(root,p);
  out[rel]=[s.mode,s.isSymbolicLink()?fs.readlinkSync(p):s.isFile()?fs.readFileSync(p).toString("base64"):null];
  if(s.isDirectory()) for(const f of fs.readdirSync(p).sort()) walk(path.join(p,f));
 }
 walk(root); return out;
}
function cli(f,args,write=false,input="") {
 return spawnSync(process.execPath,["--require",path.join(f.root,"guard.cjs"),path.join(f.pkg,"bin/aigentry-devkit.js"),...args],{
  encoding:"utf8",timeout:10000,input,
  env:{HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:f.home,TMPDIR:path.join(f.root,"tmp"),TMP:path.join(f.root,"tmp"),TEMP:path.join(f.root,"tmp"),
   PATH:"",TEST_NO_WRITES:write?"0":"1",CLAUDE_CODE_OAUTH_TOKEN:"SYNTHETIC_SECRET_DO_NOT_COPY",DOCKER_HOST:"SYNTHETIC_ENDPOINT_DO_NOT_COPY"}
 });
}
const choices=["--configure-only","--non-interactive","--profile","core","--runtime","defer"];
function preview(f,extra=[]) {
 const r=cli(f,["setup",...choices,"--dry-run",...extra]);
 assert.equal(r.status,0,r.stderr+r.stdout);
 const match=r.stdout.match(/accept-plan ([a-f0-9]{64})/);
 assert.ok(match,r.stdout); return match[1];
}
function withFixture(fn) {const f=fixture();try{fn(f);}finally{if(!KEEP)fs.rmSync(f.root,{recursive:true,force:true});}}
// Retained real-module caller: options are data; module and failure target are fixed.
function moduleCaller(f) {
 const file=path.join(f.root,"module-caller.cjs");
 fs.writeFileSync(file,String.raw`"use strict";
const fs=require("fs"),path=require("path");
const setup=require("./package/lib/setup");
if(process.env.TEST_RENAME_FAILURE==="1") {
 const rename=fs.renameSync;
 fs.renameSync=function(from,to) {
  if(to===path.join(__dirname,"home","aigentry-devkit","install-journal.json")) {
   const error=Error("owned fixture rename failure");error.code="EIO";throw error;
  }
  return rename.apply(this,arguments);
 };
}
setup.run(JSON.parse(process.argv[2])).then(code=>{
 process.stdout.write("CALLER_SETTLED="+code+"\n");
}).finally(()=>process.stdout.write("CALLER_ALIVE\n"));
`);
 return (args, crash="", fail=false)=>spawnSync(process.execPath,["--require",path.join(f.root,"guard.cjs"),file,JSON.stringify(args)],{
  encoding:"utf8",timeout:10000,env:{HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:f.home,
   TMPDIR:path.join(f.root,"tmp"),TMP:path.join(f.root,"tmp"),TEMP:path.join(f.root,"tmp"),PATH:"",
   AIGENTRY_INSTALL_JOURNAL_CRASH:crash,TEST_RENAME_FAILURE:fail?"1":"0"}
 });
}
for(const [label,attempt,extra] of [
 ["string phase",{phases:[{phase:"5",status:"running"}]}],
 ["fraction phase",{phases:[{phase:5.5,status:"running"}]}],
 ["unknown status",{phases:[{phase:5,status:"runing"}]}],
 ["null record",{phases:[null]}],
 ["array record",{phases:[[]]}],
 ["degraded type",{phases:[{phase:5,status:"completed",degraded:"true"}]}],
 ["exit type",{phases:[{phase:5,status:"failed",exit_code:"1"}]}],
 ["label type",{phases:[{phase:5,status:"running",label:1}]}],
 ...[false,0,"",null].flatMap(value=>[
  ["root setup "+JSON.stringify(value),{phases:[]},{setup:value}],
  ["attempt setup "+JSON.stringify(value),{phases:[],setup:value}]
 ])
]) test("review R1 malformed history refuses unchanged: "+label,()=>withFixture(f=>{
 const run=moduleCaller(f);
 fs.mkdirSync(f.dir,{mode:0o700});
 const prior={schema:"aigentry-devkit/install-journal@1",attempts:[{run_id:"prior",outcome:"running",...attempt}],...extra};
 const file=path.join(f.dir,"install-journal.json");
 fs.writeFileSync(file,JSON.stringify(prior),{mode:0o600});
 const before=snapshot(f.root),r=run([...choices,"--dry-run"]);
 const match=r.stdout.match(/accept-plan ([a-f0-9]{64})/);
 const save=match?run([...choices,"--accept-plan",match[1]]):null;
 const after=snapshot(f.root);
 fs.writeFileSync(path.join(f.root,"module-result.json"),JSON.stringify({preview:r,save},null,2));
 assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);
 assert.match(r.stdout,/CALLER_SETTLED=1/,r.stdout);
 assert.match(r.stderr,/corrupt setup journal|invalid setup choice/);
 assert.deepEqual(after,before,"malformed history must never be rewritten");
}));
for(const phases of [[],[{phase:5,status:"running"}],
 [{phase:1,status:"completed",degraded:false},{phase:3,status:"failed",exit_code:1},{phase:6,status:"unknown"}]]) {
 test("review R1 valid legacy history survives: "+JSON.stringify(phases),()=>withFixture(f=>{
  fs.mkdirSync(f.dir,{mode:0o700});
  const file=path.join(f.dir,"install-journal.json"),prior={schema:"aigentry-devkit/install-journal@1",attempts:[{run_id:"legacy",phases}]};
  fs.writeFileSync(file,JSON.stringify(prior),{mode:0o600});
  const digest=preview(f),r=cli(f,["setup",...choices,"--accept-plan",digest],true);
  assert.equal(r.status,0,r.stderr);
  const after=JSON.parse(fs.readFileSync(file));
  assert.deepEqual(after.attempts[0],prior.attempts[0]);assert.equal(after.attempts.length,2);
 }));
}
for(const crash of ["after-tmp-write","before-rename","after-rename"]) {
 test("review R2 module caller survives inherited crash seam: "+crash,()=>withFixture(f=>{
  const run=moduleCaller(f),digest=preview(f),r=run([...choices,"--accept-plan",digest],crash);
  fs.writeFileSync(path.join(f.root,"module-result.json"),JSON.stringify(r,null,2));
  assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+r.stdout);
  assert.match(r.stdout,/CALLER_SETTLED=0\nCALLER_ALIVE/);
  assert.match(r.stdout,/Preference saved/);
  assert.deepEqual(fs.readdirSync(f.dir),["install-journal.json"]);
  const journal=JSON.parse(fs.readFileSync(path.join(f.dir,"install-journal.json")));
  assert.equal(journal.setup.runtime,"defer");assert.equal(journal.attempts.length,1);
 }));
}
test("review R2 filesystem failure settles and preserves live bytes",()=>withFixture(f=>{
 const run=moduleCaller(f);
 fs.mkdirSync(f.dir,{mode:0o700});
 const file=path.join(f.dir,"install-journal.json"),bytes='{"schema":"aigentry-devkit/install-journal@1","attempts":[]}';
 fs.writeFileSync(file,bytes,{mode:0o600});
 const digest=preview(f),r=run([...choices,"--accept-plan",digest],"after-rename",true);
 fs.writeFileSync(path.join(f.root,"module-result.json"),JSON.stringify(r,null,2));
 assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);
 assert.match(r.stdout,/CALLER_SETTLED=1\nCALLER_ALIVE/);
 assert.match(r.stderr,/metadata\/storage unavailable/);
 assert.doesNotMatch(r.stdout,/Preference saved/);
 assert.equal(fs.readFileSync(file,"utf8"),bytes);
 assert.equal(fs.existsSync(path.join(f.dir,"install-journal.lock")),false);
 assert.equal(fs.readdirSync(f.dir).filter(n=>n.startsWith("install-journal.json.tmp-")).length,1,
  "existing atomic-writer policy retains the own failed temp for inspection");
}));
test("actual setup preview is stable, secret-free and has zero early effects",()=>withFixture(f=>{
 const before=snapshot(f.root), a=preview(f), b=preview(f);
 assert.equal(a,b); assert.deepEqual(snapshot(f.root),before);
 const r=cli(f,["install",...choices,"--dry-run"]);
 assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/not runtime-verified/);
 assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC_/);
}));
for(const args of [["update"],["setup"],["setup","--yes"],["setup","--manifest","bad"],["setup",...choices,"--accept-plan","0".repeat(64)],["setup",...choices],["setup","--non-interactive","--runtime","defer","--dry-run"]]) {
 test("actual CLI refuses without effects: "+args.join(" "),()=>withFixture(f=>{
  const before=snapshot(f.root),r=cli(f,args);
  assert.equal(r.status,1,r.stderr+r.stdout);assert.doesNotMatch(r.stderr,/EARLY_EFFECT|LOGGER_IMPORT|MODULE_NOT_FOUND/);
  assert.deepEqual(snapshot(f.root),before);
 }));
}
for(const runtime of ["docker-desktop","docker-engine-rootless","podman","rancher-desktop","orbstack","rootful","__proto__"]) {
 test("gated or invalid runtime refuses: "+runtime,()=>withFixture(f=>{
  const before=snapshot(f.root),r=cli(f,["setup","--configure-only","--non-interactive","--profile","core","--runtime",runtime,"--dry-run"]);
  assert.equal(r.status,1);assert.deepEqual(snapshot(f.root),before);
 }));
}
test("save deferred choice, preserve history and require fresh revisit consent",()=>withFixture(f=>{
 const digest=preview(f);
 const r=cli(f,["setup",...choices,"--accept-plan",digest],true);
 assert.equal(r.status,0,r.stderr+r.stdout);
 const file=path.join(f.dir,"install-journal.json"),j=JSON.parse(fs.readFileSync(file));
 assert.equal(j.setup.runtime,"defer");assert.equal(j.setup.verification,"not-verified");
 assert.equal(j.attempts.length,1); assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(fs.statSync(f.dir).mode&0o777,0o700);
 const before=snapshot(f.root);
 const revisit=cli(f,["setup",...choices,"--revisit","--dry-run"]);
 assert.equal(revisit.status,0,revisit.stderr);assert.match(revisit.stdout,/suggestion/);
 assert.deepEqual(snapshot(f.root),before);
 assert.equal(cli(f,["setup",...choices,"--accept-plan",digest],true).status,1);
 const next=preview(f), save=cli(f,["setup",...choices,"--accept-plan",next],true);
 assert.equal(save.status,0,save.stderr); const after=JSON.parse(fs.readFileSync(file));
 assert.deepEqual(after.attempts[0],j.attempts[0]); assert.equal(after.attempts.length,2);
}));
test("changed package identity invalidates consent before any write",()=>withFixture(f=>{
 const digest=preview(f);fs.appendFileSync(path.join(f.pkg,"package.json")," ");
 const before=snapshot(f.root),r=cli(f,["setup",...choices,"--accept-plan",digest]);
 assert.equal(r.status,1);assert.deepEqual(snapshot(f.root),before);
}));
for(const bad of ["corrupt","unsupported","wide","symlink","locked"]) test("unsafe storage preserved: "+bad,()=>withFixture(f=>{
 fs.mkdirSync(f.dir,{mode:0o700});
 const file=path.join(f.dir,"install-journal.json");
 if(bad==="corrupt") fs.writeFileSync(file,"{");
 if(bad==="unsupported") fs.writeFileSync(file,JSON.stringify({schema:"aigentry-devkit/install-journal@9",attempts:[]}));
 if(bad==="wide") fs.chmodSync(f.dir,0o755);
 if(bad==="symlink") fs.symlinkSync(f.home,file);
 if(bad==="locked") fs.writeFileSync(path.join(f.dir,"install-journal.lock"),"held");
 const before=snapshot(f.root),r=cli(f,["setup",...choices,"--dry-run"]);
 assert.equal(r.status,1,r.stdout);assert.deepEqual(snapshot(f.root),before);
}));
test("inert major1 interface and interactive cancel/EOF/back/skip", async()=>{
 const setup=require("../lib/setup");
 assert.equal(setup.contractMajor,1);assert.equal(typeof setup.run,"function");
 const {PassThrough}=require("stream");
 for(const input of ["cancel\n","","core\nback\ncancel\n","skip\n"]) {
  const stdin=new PassThrough();stdin.isTTY=true;
  const stdout=new PassThrough(),stderr=new PassThrough();
  const promise=setup.run([], {stdin,stdout,stderr});
  stdin.end(input); const rc=await promise;
  assert.equal(rc,input==="skip\n"?0:1);
 }
});

function previewPlan(f, runtime="defer") {
 const result=cli(f,["setup","--configure-only","--non-interactive","--profile","core","--runtime",runtime,"--dry-run"]);
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout.slice(result.stdout.indexOf("{"),result.stdout.indexOf("\n--accept-plan")));
}
test("filesystem detection distinguishes missing, detected, unknown and unsupported without readiness",()=>withFixture(f=>{
 const p=path.join(f.pkg,"node_modules","@anthropic-ai","sandbox-runtime");
 let plan=previewPlan(f);
 assert.equal(plan.observations.find(x=>x.id==="native-srt").status,"missing");
 fs.mkdirSync(p,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(p,"package.json"),'{"version":"999.0.0"}');
 plan=previewPlan(f,"native-srt");
 const native=plan.observations.find(x=>x.id==="native-srt");
 assert.equal(native.status,"detected");assert.equal(native.runtime_readiness,"unknown");
 assert.equal(native.version,undefined,"presence must not become observed version");
 fs.unlinkSync(path.join(p,"package.json"));
 fs.symlinkSync(path.join(f.pkg,"package.json"),path.join(p,"package.json"));
 plan=previewPlan(f);
 assert.equal(plan.observations.find(x=>x.id==="native-srt").status,"unknown");
 const unsupported=process.platform==="darwin"?"docker-engine-rootless":"orbstack";
 assert.equal(plan.observations.find(x=>x.id===unsupported).status,"unsupported");
}));
test("corrupt existing state cannot leak parser contents",()=>withFixture(f=>{
 fs.mkdirSync(f.dir,{mode:0o700});fs.writeFileSync(path.join(f.dir,"install-state.json"),"SYNTHETIC_SECRET_DO_NOT_COPY");
 const before=snapshot(f.root),r=cli(f,["setup",...choices,"--dry-run"]);
 assert.equal(r.status,1);assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC_SECRET_DO_NOT_COPY/);
 assert.deepEqual(snapshot(f.root),before);
}));
test("revalidation rejects a destination changed during interactive consent", async()=>{
 const f=fixture(),setup=require(path.join(f.pkg,"lib/setup")), {PassThrough}=require("stream");
 const saved={HOME:process.env.HOME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME};
 process.env.HOME=f.home;process.env.XDG_CONFIG_HOME=f.home;
 const stdin=new PassThrough();stdin.isTTY=true;
 const stdout=new PassThrough(),stderr=new PassThrough();let output="",changed=false;
 stdout.on("data",chunk=>{
  output+=chunk;
  if(!changed && output.includes("To save type the exact plan digest")) {
   changed=true; const hash=output.match(/accept-plan ([a-f0-9]{64})/)[1];
   fs.mkdirSync(f.dir,{mode:0o700});
   fs.writeFileSync(path.join(f.dir,"install-journal.lock"),"another writer");
   stdin.end(hash+"\n");
  }
 });
 try {
  const promise=setup.run(["--configure-only"],{stdin,stdout,stderr});
  stdin.write("core\ndefer\n");
  assert.equal(await promise,1);
  assert.equal(fs.readFileSync(path.join(f.dir,"install-journal.lock"),"utf8"),"another writer");
  assert.equal(fs.existsSync(path.join(f.dir,"install-journal.json")),false);
 } finally {
  for(const [key,value] of Object.entries(saved)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  if(!KEEP)fs.rmSync(f.root,{recursive:true,force:true});
 }
});
