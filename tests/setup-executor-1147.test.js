"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("fs"), path=require("path"), os=require("os");
const {spawnSync}=require("child_process");
const REPO=path.resolve(__dirname,"..");
const KEEP=process.env.AIGENTRY_TEST_KEEP==="1";
process.umask(0o077);
// This observer is a bounded JavaScript tripwire, not a native descendant observer.
const GUARD=String.raw`
"use strict";
const Module=require("module");
const fail=()=>{throw Error("EARLY_EFFECT");};
for(const id of ["child_process","net","tls","http","https","dgram"]){
 const m=require(id);
 for(const k of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork","connect","createConnection","createServer","request","get","createSocket"])
  if(typeof m[k]==="function")m[k]=fail;
}
require("net").Socket.prototype.connect=fail;
require("net").Server.prototype.listen=fail;
global.fetch=fail;
const load=Module._load;
Module._load=function(id,...rest){
 if(/logger|workspace-init/.test(id))throw Error("EARLY_IMPORT");
 return load.call(this,id,...rest);
};
`;
function snapshot(root){
 const out={};
 function walk(p){
  const s=fs.lstatSync(p);
  out[path.relative(root,p)]={mode:s.mode,nlink:s.nlink,
   value:s.isSymbolicLink()?fs.readlinkSync(p):s.isFile()?fs.readFileSync(p).toString("base64"):null};
  if(s.isDirectory())for(const name of fs.readdirSync(p).sort())walk(path.join(p,name));
 }
 walk(root);return out;
}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"assets1147-"));
 for(const d of ["tree/home","tree/tmp","tree/package/bin","tree/package/config","tree/package/lib","observers"])
  fs.mkdirSync(path.join(root,d),{recursive:true,mode:0o700});
 const tree=path.join(root,"tree"),pkg=path.join(tree,"package");
 for(const name of ["package.json","bin/aigentry-devkit.js","lib/setup.js","lib/install-state.js","lib/setup-executor.js","install.sh","install.ps1","config/setup-capabilities.json","config/installer-manifest.json"]){
  if(fs.existsSync(path.join(REPO,name)))fs.copyFileSync(path.join(REPO,name),path.join(pkg,name));
 }
 for(const name of ["skills","hud","templates/skills"]){
  fs.mkdirSync(path.dirname(path.join(pkg,name)),{recursive:true,mode:0o700});
  fs.cpSync(path.join(REPO,name),path.join(pkg,name),{recursive:true});
 }
 const observer=path.join(root,"observers","guard.cjs");fs.writeFileSync(observer,GUARD);
 return {root,tree,pkg,observer,home:path.join(tree,"home"),seq:0};
}
function call(f,args,entry="bin/aigentry-devkit.js"){
 const env={HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,".config"),
  TMPDIR:path.join(f.tree,"tmp"),TMP:path.join(f.tree,"tmp"),TEMP:path.join(f.tree,"tmp"),PATH:""};
 const result=spawnSync(process.execPath,["--require",f.observer,path.join(f.pkg,entry),...args],{env,encoding:"utf8",timeout:10000});
 fs.writeFileSync(path.join(f.root,"observers",++f.seq+".json"),JSON.stringify({args,entry,env,...result},null,2));
 return result;
}
function withFixture(fn){const f=fixture();try{fn(f);}finally{if(!KEEP)fs.rmSync(f.root,{recursive:true,force:true});}}
for(const args of [[],["--dry-run"]])test("D2 implicit CLI route refuses before imports: "+JSON.stringify(args),()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,args);
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/EARLY_EFFECT|EARLY_IMPORT|MODULE_NOT_FOUND/);
 assert.deepEqual(snapshot(f.tree),before);
}));
test("D2 fixed executor refuses missing authority without effects",()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,[],"lib/setup-executor.js");
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/EARLY_EFFECT|EARLY_IMPORT|MODULE_NOT_FOUND/);
 assert.deepEqual(snapshot(f.tree),before);
}));
