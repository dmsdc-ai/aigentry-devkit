"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {spawnSync}=require("node:child_process");
const REPO=path.resolve(__dirname,".."),KEEP=process.env.AIGENTRY_TEST_KEEP==="1";
process.umask(0o077);
const SOURCES=["bin/aigentry-devkit.js","lib/workspace-init.js","lib/bootstrap.js","lib/logger-emit.js",
 "lib/scaffold/project/index.js","lib/scaffold/project/generate.js","lib/scaffold/project/merge.js",
 "lib/scaffold/project/stdout.js","lib/scaffold/project/uninstall.js","lib/scaffold/project/sentinel.js"];
const GUARD=String.raw`"use strict";
const fs=require("fs"),path=require("path"),Module=require("module");
const pkg=path.resolve(__dirname,"../tree/package"),dest=path.resolve(__dirname,"../tree/home/.config/aigentry/aigentry.yml");
const allowed=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,"sources.json"))).map(p=>path.join(pkg,p)));
const events=path.join(__dirname,"effects.jsonl");
const fail=effect=>()=>{fs.appendFileSync(events,JSON.stringify({effect})+"\n");throw Error("UNEXPECTED_EFFECT:"+effect);};
for(const n of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])require("child_process")[n]=fail("child_process."+n);
for(const [m,names] of [["net",["connect","createConnection","createServer"]],["tls",["connect","createServer"]],["http",["request","get","createServer"]],["https",["request","get","createServer"]],["dgram",["createSocket"]]]){
 for(const n of names)require(m)[n]=fail(m+"."+n);
}
require("net").Socket.prototype.connect=fail("Socket.connect");
require("net").Server.prototype.listen=fail("Server.listen");
global.fetch=fail("fetch");
const load=Module._load;
Module._load=function(request,parent,isMain){
 const resolved=Module._resolveFilename(request,parent,isMain);
 if(!Module.isBuiltin(resolved)&&!allowed.has(resolved))return fail("module:"+resolved)();
 return load.apply(this,arguments);
};
if(fs.existsSync(path.join(__dirname,"race"))){
 const copy=fs.copyFileSync;
 fs.copyFileSync=function(src,dst,flags){
  if(dst===dest){
   fs.symlinkSync(path.resolve(__dirname,"../tree/outside/sentinel"),dest);
   fs.writeFileSync(path.join(__dirname,"race.json"),JSON.stringify({destination:dest,target:fs.readlinkSync(dest)}));
  }
  return copy.apply(this,arguments);
 };
}
`;
function snapshot(root){
 const out={};
 function walk(p){
  const s=fs.lstatSync(p),rel=path.relative(root,p);
  out[rel]={mode:s.mode,nlink:s.nlink,value:s.isSymbolicLink()?fs.readlinkSync(p):s.isFile()?fs.readFileSync(p).toString("base64"):null};
  if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(path.join(p,n));
 }
 walk(root);return out;
}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"init1147-")),tree=path.join(root,"tree"),observer=path.join(root,"observers");
 for(const d of ["home","tmp","outside","package/bin","package/config"])fs.mkdirSync(path.join(tree,d),{recursive:true,mode:0o700});
 fs.mkdirSync(observer,{mode:0o700});
 for(const n of [...SOURCES,"package.json","config/aigentry.yml.template"]){
  fs.mkdirSync(path.dirname(path.join(tree,"package",n)),{recursive:true,mode:0o700});
  fs.copyFileSync(path.join(REPO,n),path.join(tree,"package",n));
 }
 fs.writeFileSync(path.join(tree,"outside/sentinel"),"outside must remain identical",{mode:0o600});
 fs.writeFileSync(path.join(observer,"guard.cjs"),GUARD);
 fs.writeFileSync(path.join(observer,"sources.json"),JSON.stringify(SOURCES));
 // Calibrate APFS/POSIX directory-link accounting outside the measured tree.
 const probe=path.join(observer,"probe");fs.mkdirSync(probe);
 const empty=fs.lstatSync(probe).nlink;fs.writeFileSync(path.join(probe,"file"),"x");
 const file=fs.lstatSync(probe).nlink-empty;fs.mkdirSync(path.join(probe,"dir"));
 const directory=fs.lstatSync(probe).nlink-empty-file;
 assert.equal(empty,2);assert.ok([0,1].includes(file));assert.equal(directory,1);
 fs.writeFileSync(path.join(observer,"link-model.json"),JSON.stringify({empty,file,directory}));
 return {root,tree,observer,home:path.join(tree,"home"),dest:path.join(tree,"home/.config/aigentry/aigentry.yml"),links:{empty,file,directory}};
}
function invoke(f){
 const env={HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,".config"),TMPDIR:path.join(f.tree,"tmp"),TMP:path.join(f.tree,"tmp"),TEMP:path.join(f.tree,"tmp"),PATH:"",AIGENTRY_LOGGER_DISABLED:"1"};
 const argv=[process.execPath,"--require",path.join(f.observer,"guard.cjs"),path.join(f.tree,"package/bin/aigentry-devkit.js"),"init"];
 const before=snapshot(f.tree);
 const out=fs.openSync(path.join(f.observer,"stdout"),"wx",0o600),err=fs.openSync(path.join(f.observer,"stderr"),"wx",0o600);
 let result;
 try{result=spawnSync(argv[0],argv.slice(1),{cwd:f.tree,env,stdio:["ignore",out,err],timeout:10000});}
 finally{fs.closeSync(out);fs.closeSync(err);}
 const after=snapshot(f.tree);
 fs.writeFileSync(path.join(f.observer,"result.json"),JSON.stringify({argv,env,cwd:f.tree,before,after,...result},null,2));
 assert.equal(result.error,undefined);assert.equal(result.signal,null);
 assert.equal(fs.existsSync(path.join(f.observer,"effects.jsonl")),false,"unexpected imported/child/network effect");
 return {before,after,result};
}
function addExpected(f,expected,rel,node,isDir){
 expected[rel]=node;
 expected[path.dirname(rel)==="."?"":path.dirname(rel)].nlink+=isDir?f.links.directory:f.links.file;
}
function runCase(name,prepare,verify){
 test(name,()=>{const f=fixture();try{prepare(f);const observed=invoke(f);verify(f,observed);}finally{if(!KEEP)fs.rmSync(f.root,{recursive:true,force:true});}});
}
function parents(f){fs.mkdirSync(path.dirname(f.dest),{recursive:true,mode:0o700});}
function refused(f,{before,after,result}){
 assert.deepEqual(after,before,"refusal must preserve complete tree/bytes/modes/link text");
 assert.equal(result.status,1);
 assert.match(fs.readFileSync(path.join(f.observer,"stderr"),"utf8"),/init refuses/);
}
runCase("init refuses dangling destination link",f=>{parents(f);fs.symlinkSync(path.join(f.tree,"outside/absent"),f.dest);},refused);
runCase("init refuses existing target link",f=>{parents(f);fs.symlinkSync(path.join(f.tree,"outside/sentinel"),f.dest);},refused);
runCase("init refuses ancestor link",f=>{fs.symlinkSync(path.join(f.tree,"outside"),path.join(f.home,".config"));},refused);
runCase("init refuses HOME link",f=>{fs.rmdirSync(f.home);fs.symlinkSync(path.join(f.tree,"outside"),f.home);},refused);
runCase("init refuses non-directory ancestor",f=>{fs.writeFileSync(path.join(f.home,".config"),"keep");},refused);
runCase("init refuses nonregular destination",f=>{parents(f);fs.mkdirSync(f.dest);},refused);
runCase("init preserves entry appearing after check",f=>{parents(f);fs.writeFileSync(path.join(f.observer,"race"),"enabled");},(f,{before,after,result})=>{
 const expected=structuredClone(before);
 addExpected(f,expected,"home/.config/aigentry/aigentry.yml",{mode:0o120000|0o700,nlink:1,value:path.join(f.tree,"outside/sentinel")},false);
 fs.writeFileSync(path.join(f.observer,"expected.json"),JSON.stringify(expected,null,2));
 assert.equal(fs.existsSync(path.join(f.observer,"race.json")),true,"real copy call must reach deterministic replacement");
 assert.deepEqual(after,expected,"only deliberate racing entry may change");
 assert.equal(result.status,1);
 assert.match(fs.readFileSync(path.join(f.observer,"stderr"),"utf8"),/EEXIST/);
});
runCase("init creates ordinary fixed destination",()=>{},(f,{before,after,result})=>{
 const expected=structuredClone(before);
 for(const rel of ["home/.config","home/.config/aigentry"])addExpected(f,expected,rel,{mode:0o40700,nlink:f.links.empty,value:null},true);
 const source=before["package/config/aigentry.yml.template"];
 addExpected(f,expected,"home/.config/aigentry/aigentry.yml",{...source,nlink:1},false);
 fs.writeFileSync(path.join(f.observer,"expected.json"),JSON.stringify(expected,null,2));
 assert.equal(result.status,0);assert.deepEqual(after,expected);
 assert.match(fs.readFileSync(path.join(f.observer,"stdout"),"utf8"),/Created config:/);
});
runCase("init preserves existing regular file",f=>{parents(f);fs.writeFileSync(f.dest,"existing configuration must survive",{mode:0o640});},(f,{before,after,result})=>{
 assert.equal(result.status,0);assert.deepEqual(after,before);
 assert.match(fs.readFileSync(path.join(f.observer,"stdout"),"utf8"),/Config already exists, skipping:/);
});
