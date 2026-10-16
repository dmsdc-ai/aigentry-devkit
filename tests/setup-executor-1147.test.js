"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("fs"), path=require("path"), os=require("os");
const {spawnSync}=require("child_process");
const REPO=path.resolve(__dirname,"..");
const KEEP=process.env.AIGENTRY_TEST_KEEP==="1";
const assetChoices=["--non-interactive","--profile","core","--runtime","defer","--install-assets","skills,hud"];
process.umask(0o077);
test("partial asset receipts cannot resolve unknown legacy phase 1",()=>{
  const state=require("../lib/install-state");
  const journal={attempts:[{phases:[{phase:1,status:"unknown"}]},{installer:"setup-assets",outcome:"completed",phases:[{phase:1,status:"completed",partial:true}]}]};
  assert.deepEqual(state.unresolvedPhases(journal),[1]);
  assert.equal(state.assetOutcome(journal),"completed");
});
// This observer is a bounded JavaScript tripwire, not a native descendant observer.
const GUARD=String.raw`
"use strict";
const Module=require("module"),fs=require("fs"),path=require("path");
const fail=(effect)=>()=>{fs.appendFileSync(path.join(__dirname,"attempted-effects.jsonl"),JSON.stringify({effect})+"\n");throw Error("EARLY_EFFECT");};
for(const id of ["child_process","net","tls","http","https","dgram"]){
 const m=require(id);
 for(const k of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork","connect","createConnection","createServer","request","get","createSocket"])
  if(typeof m[k]==="function")m[k]=fail(id+"."+k);
}
require("net").Socket.prototype.connect=fail("net.Socket.connect");
require("net").Server.prototype.listen=fail("net.Server.listen");
global.fetch=fail("fetch");
const load=Module._load;
Module._load=function(id,...rest){
 if(/logger|workspace-init/.test(id))throw Error("EARLY_IMPORT");
 return load.call(this,id,...rest);
};
const home=path.resolve(__dirname,"../tree/home"),journal=path.join(home,".config/aigentry-devkit/install-journal.json");
function durable(target){
 if(typeof target!=="string" || !target.startsWith(path.join(home,".claude")+path.sep) && target!==path.join(home,".claude"))return;
 const j=JSON.parse(fs.readFileSync(journal)),a=j.attempts.at(-1);
 if(a.outcome!=="running" || a.phases[0].phase!==1 || a.phases[0].status!=="running")throw Error("ASSET_BEFORE_DURABLE_BEGIN");
 fs.appendFileSync(path.join(__dirname,"durable.jsonl"),JSON.stringify({target,run:a.run_id})+"\n");
}
const mkdir=fs.mkdirSync,open=fs.openSync;
const assetFds=new Set(),write=fs.writeFileSync,lstat=fs.lstatSync;
const rename=fs.renameSync;
fs.renameSync=function(from,to){
 if(typeof from==="string" && path.basename(from).startsWith(".aigentry-assets-")){
  if(process.env.TEST_ASSET_EXIT==="before-publication")process.exit(72);
  const result=rename.apply(this,arguments);
  if(process.env.TEST_ASSET_EXIT==="after-publication")process.exit(73);
  return result;
 }
 return rename.apply(this,arguments);
};
fs.mkdirSync=function(target,...rest){durable(target);return mkdir.call(this,target,...rest);};
fs.openSync=function(target,flags,...rest){
 if(flags==="wx"){
  durable(target);
  if(process.env.TEST_ASSET_FAILURE==="1" && target===path.join(home,".claude/hud/simple-status.sh"))throw Error("OWNED_ASSET_FAILURE");
 }
 const fd=open.call(this,target,flags,...rest);
 if(flags==="wx" && typeof target==="string" && target.startsWith(path.join(home,".claude")+path.sep))assetFds.add(fd);
 return fd;
};
fs.writeFileSync=function(target,...rest){
 const result=write.call(this,target,...rest);
 if(assetFds.has(target) && process.env.TEST_ASSET_EXIT==="after-first-file")process.exit(71);
 return result;
};
fs.lstatSync=function(target,...rest){
 if(process.env.TEST_ASSET_CONFLICT==="skill" && target===path.join(home,".claude/skills/ambiguity-gate") &&
    fs.existsSync(journal) && fs.existsSync(path.dirname(target)) &&
    fs.readdirSync(path.dirname(target)).some(n=>n.startsWith(".aigentry-assets-")) && !fs.existsSync(target)){
  mkdir(target,{mode:0o700});write(path.join(target,"preserve.txt"),"concurrent owned fixture");
 }
 return lstat.call(this,target,...rest);
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
 // Measure directory link accounting outside the product tree. APFS counts
 // file entries too; traditional POSIX filesystems count subdirectories only.
 const probe=path.join(root,"observers/link-accounting");fs.mkdirSync(probe,{mode:0o700});
 const empty=fs.lstatSync(probe).nlink;
 fs.writeFileSync(path.join(probe,"file"),"link-accounting control",{mode:0o600});
 const withFile=fs.lstatSync(probe).nlink;
 fs.mkdirSync(path.join(probe,"directory"),{mode:0o700});
 const withDirectory=fs.lstatSync(probe).nlink;
 const linkModel={empty,file:withFile-empty,directory:withDirectory-withFile};
 fs.writeFileSync(path.join(root,"observers/link-accounting.json"),JSON.stringify({empty,withFile,withDirectory,linkModel},null,2));
 assert.equal(empty,2);assert.ok([0,1].includes(linkModel.file));assert.equal(linkModel.directory,1);
 return {root,tree,pkg,observer,home:path.join(tree,"home"),seq:0,linkModel};
}
function call(f,args,entry="bin/aigentry-devkit.js",extraEnv={}){
 const env={HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,".config"),
  TMPDIR:path.join(f.tree,"tmp"),TMP:path.join(f.tree,"tmp"),TEMP:path.join(f.tree,"tmp"),PATH:"",...extraEnv};
 const before=snapshot(f.tree),command=[process.execPath,"--require",f.observer,path.join(f.pkg,entry),...args];
 // Capture complete preview bytes outside the measured tree, without pipe limits.
 const seq=++f.seq,stdoutFile=path.join(f.root,"observers",seq+".stdout"),stderrFile=path.join(f.root,"observers",seq+".stderr");
 const stdoutFd=fs.openSync(stdoutFile,"wx",0o600);
 let stderrFd,result;
 try{
  stderrFd=fs.openSync(stderrFile,"wx",0o600);
  result=spawnSync(command[0],command.slice(1),{env,encoding:"utf8",timeout:10000,stdio:["ignore",stdoutFd,stderrFd]});
 }finally{fs.closeSync(stdoutFd);if(stderrFd!==undefined)fs.closeSync(stderrFd);}
 const after=snapshot(f.tree);
 const capture={stdoutFile,stderrFile,stdoutBytes:fs.statSync(stdoutFile).size,stderrBytes:fs.statSync(stderrFile).size};
 fs.writeFileSync(path.join(f.root,"observers",seq+".json"),JSON.stringify({command,args,entry,env,before,after,...result,capture},null,2));
 assert.ok(capture.stdoutBytes<=16*1024*1024&&capture.stderrBytes<=16*1024*1024,"capture exceeds bounded decode; raw files retained");
 result.stdout=fs.readFileSync(stdoutFile,"utf8");result.stderr=fs.readFileSync(stderrFile,"utf8");
 return result;
}
function withFixture(fn){const f=fixture();try{fn(f);}finally{if(!KEEP)fs.rmSync(f.root,{recursive:true,force:true});}}
test("D2 installed child/network detectors observe deliberate attempts; disabled detectors fail the oracle",()=>withFixture(f=>{
 const dir=path.join(f.root,"observers");
 fs.writeFileSync(path.join(dir,"inert-child.cjs"),'process.stdout.write("INERT_CHILD_RAN");\n');
 fs.writeFileSync(path.join(dir,"detector-control.cjs"),String.raw`"use strict";
const fs=require("fs"),path=require("path"),attempts=[];
for(const [effect,invoke] of [
 ["child_process.spawnSync",()=>require("child_process").spawnSync(process.execPath,[path.join(__dirname,"inert-child.cjs")],{env:{PATH:"",HOME:path.join(__dirname,"../tree/home")},encoding:"utf8",timeout:1000})],
 // An invalid port fails Node argument validation even without the detector:
 // no DNS request, socket connection or live service is needed for this control.
 ["net.createConnection",()=>require("net").createConnection({host:"127.0.0.1",port:-1})]
]){
 try{const result=invoke();attempts.push({effect,returned:true,status:result.status,stdout:result.stdout});}
 catch(err){attempts.push({effect,error:err.message,code:err.code});}
}
fs.writeFileSync(path.join(__dirname,"control-attempts.json"),JSON.stringify(attempts,null,2));
process.stdout.write(JSON.stringify(attempts));
`);
 const verify=()=>{
  const facts=JSON.parse(fs.readFileSync(path.join(dir,"control-attempts.json")));
  assert.deepEqual(facts.map(a=>[a.effect,a.error]),[["child_process.spawnSync","EARLY_EFFECT"],["net.createConnection","EARLY_EFFECT"]]);
  const events=fs.readFileSync(path.join(dir,"attempted-effects.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events,[{effect:"child_process.spawnSync"},{effect:"net.createConnection"}]);
 };
 const before=snapshot(f.tree),enabled=call(f,[],"../../observers/detector-control.cjs");
 assert.equal(enabled.status,0,enabled.stderr);assert.equal(enabled.signal,null);verify();
 assert.deepEqual(snapshot(f.tree),before);
 fs.renameSync(path.join(dir,"control-attempts.json"),path.join(dir,"enabled-control-attempts.json"));
 // Fixture-only negative calibration. No product entry is involved.
 fs.renameSync(f.observer,path.join(dir,"enabled-guard.cjs"));fs.writeFileSync(f.observer,'"use strict";\n');
 const disabled=call(f,[],"../../observers/detector-control.cjs");
 assert.equal(disabled.status,0,disabled.stderr);assert.equal(disabled.signal,null);
 assert.throws(verify,{code:"ERR_ASSERTION"});
 const facts=JSON.parse(fs.readFileSync(path.join(dir,"control-attempts.json")));
 assert.equal(facts[0].stdout,"INERT_CHILD_RAN");assert.equal(facts[1].code,"ERR_SOCKET_BAD_PORT");
 assert.deepEqual(snapshot(f.tree),before);
}));
for(const stale of [false,true])test("D2 actual in-process interactive asset consent "+(stale?"rejects stale source":"copies HUD"),()=>withFixture(f=>{
 const caller=path.join(f.root,"observers/interactive.cjs");
 fs.writeFileSync(caller,String.raw`"use strict";
const {PassThrough,Writable}=require("stream"),fs=require("fs"),path=require("path");
const input=new PassThrough();input.isTTY=true;let output="",answered=false;
const out=new Writable({write(chunk,encoding,done){
 const text=chunk.toString();output+=text;process.stdout.write(chunk);
 if(!answered && text.includes("To save type")){
  answered=true;
  queueMicrotask(()=>{
   if(process.env.TEST_INTERACTIVE_STALE==="1")fs.appendFileSync(path.join(__dirname,"../tree/package/hud/simple-status.sh"),"\n# changed after preview\n");
   input.end(output.match(/--accept-plan ([a-f0-9]{64})/)[1]+"\n");
  });
 }
 done();
}});
input.write("core\ndefer\n");
require("../tree/package/lib/setup").run(["--install-assets","hud"],{stdin:input,stdout:out,stderr:process.stderr}).then(code=>{process.exitCode=code;});
`);
 const r=call(f,[],"../../observers/interactive.cjs",{TEST_INTERACTIVE_STALE:stale?"1":"0"});
 assert.equal(r.status,stale?1:0,r.stderr);
 const target=path.join(f.home,".claude/hud/simple-status.sh");
 if(stale){assert.match(r.stderr,/stale|digest/);assert.equal(fs.existsSync(path.join(f.home,".config")),false);assert.equal(fs.existsSync(target),false);}
 else assert.deepEqual(fs.readFileSync(target),fs.readFileSync(path.join(f.pkg,"hud/simple-status.sh")));
}));
for(const point of ["before-publication","after-publication"])test("D2 lost receipt "+point+" retains running history",()=>withFixture(f=>{
 const p=assetPreview(f,"skills"),r=call(f,["setup",...p.args,"--accept-plan",p.hash],"bin/aigentry-devkit.js",{TEST_ASSET_EXIT:point});
 assert.equal(r.status,point==="before-publication"?72:73);
 const j=JSON.parse(fs.readFileSync(path.join(f.home,".config/aigentry-devkit/install-journal.json")));
 assert.equal(j.attempts.at(-1).outcome,"running");assert.equal(j.attempts.at(-1).phases[0].status,"running");
 assert.ok(j.attempts.at(-1).staging.length);
 const before=snapshot(f.tree),retry=call(f,["setup",...p.args,"--dry-run"]);
 assert.equal(retry.status,1);assert.deepEqual(snapshot(f.tree),before);
}));
for(const record of [{phase:99,status:"completed"},{phase:1,status:"completed",partial:"yes"}])test("D2 unknown asset history refuses: "+JSON.stringify(record),()=>withFixture(f=>{
 const dir=path.join(f.home,".config/aigentry-devkit");fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(dir,"install-journal.json"),JSON.stringify({schema:"aigentry-devkit/install-journal@1",attempts:[{phases:[record]}]}),{mode:0o600});
 const before=snapshot(f.tree),r=call(f,["setup",...assetChoices,"--dry-run"]);
 assert.equal(r.status,1);assert.deepEqual(snapshot(f.tree),before);
}));
for(const args of [[],["--dry-run"]])test("D2 implicit CLI route refuses before imports: "+JSON.stringify(args),()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,args);
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/EARLY_EFFECT|EARLY_IMPORT|MODULE_NOT_FOUND/);
 assert.deepEqual(snapshot(f.tree),before);
}));

function assetPreview(f,selection="skills,hud"){
 const args=[...assetChoices];args[args.length-1]=selection;
 const r=call(f,["setup",...args,"--dry-run"]);
 assert.equal(r.status,0,r.stdout+r.stderr);
 const hash=r.stdout.match(/--accept-plan ([a-f0-9]{64})/)[1];
 return {args,hash,plan:JSON.parse(r.stdout.slice(r.stdout.indexOf("{"),r.stdout.indexOf("\n--accept-plan")))};
}
// Success oracle: start with the full observed tree, add only approved files
// and their necessary directories, then validate the one dynamic journal.
// This does not reproduce client selection, planning, copying or recovery.
function reconcileSuccess(f,preview,before,after,label){
 const expected=JSON.parse(JSON.stringify(before)),files=[],newDirs=new Set();
 const relative=absolute=>{
  const rel=path.relative(f.tree,absolute);
  assert.ok(rel && !rel.startsWith("..") && !path.isAbsolute(rel),"effect outside measured tree");
  return rel;
 };
 const addDir=absolute=>{
  const rel=relative(absolute);
  if(expected[rel]){assert.equal(expected[rel].mode&0o170000,0o040000);return;}
  addDir(path.dirname(absolute));
  expected[rel]={mode:0o040700,nlink:f.linkModel.empty,value:null};newDirs.add(rel);
 };
 const active=preview.plan.assets.filter(a=>!a.skip);
 for(const action of active)for(const file of action.files){
  const rel=relative(file.destination),source=before[relative(path.join(f.pkg,file.source))];
  assert.ok(source && source.value!==null,"source bytes observed before apply");
  assert.equal(expected[rel],undefined,"approved creation must be absent");
  addDir(path.dirname(file.destination));
  expected[rel]={mode:0o100000|parseInt(file.mode,8),nlink:1,value:source.value};files.push(file.destination);
 }
 if(active.length){
  assert.deepEqual(preview.plan.effects.map(e=>e.action),["create-missing-private-directories","exclusive-lock","atomic-replace-journal","release-own-lock"]);
  const journalEffect=preview.plan.effects[2],journalRel=relative(journalEffect.path);
  assert.equal(journalEffect.mode,"0600");
  assert.equal(preview.plan.effects[1].path,path.join(f.home,".config/aigentry-devkit/install-journal.lock"));
  assert.equal(preview.plan.effects[3].path,preview.plan.effects[1].path);
  assert.equal(journalEffect.temporary,journalEffect.path+".tmp-<pid>-<random>");
  for(const dir of preview.plan.effects[0].paths)addDir(dir);
  assert.equal(expected[journalRel],undefined,"these positive fixtures begin without a journal");
  const observed=after[journalRel];assert.ok(observed,"completed operation must have a journal");
  const journal=JSON.parse(Buffer.from(observed.value,"base64").toString("utf8"));
  const keys=(value,wanted)=>assert.deepEqual(Object.keys(value).sort(),wanted.sort());
  const timestamp=value=>assert.equal(new Date(value).toISOString(),value);
  keys(journal,["schema","state_file","attempts","updated_at"]);
  assert.equal(journal.schema,"aigentry-devkit/install-journal@1");
  assert.equal(journal.state_file,path.join(f.home,".config/aigentry-devkit/install-state.json"));
  timestamp(journal.updated_at);assert.equal(journal.attempts.length,1);
  const a=journal.attempts[0];
  keys(a,["attempt","run_id","installer","profile","started_at","ended_at","outcome","partial","asset_plan","staging","phases"]);
  assert.equal(a.attempt,1);assert.match(a.run_id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(a.installer,"setup-assets");assert.equal(a.profile,preview.plan.selection.profile);
  assert.equal(a.asset_plan,preview.hash);assert.equal(a.partial,true);assert.equal(a.outcome,"completed");
  timestamp(a.started_at);timestamp(a.ended_at);assert.equal(a.phases.length,1);
  const phase=a.phases[0];
  keys(phase,["phase","label","effect","replay","status","started_at","partial","action_set","created_files","ended_at"]);
  assert.deepEqual([phase.phase,phase.label,phase.effect,phase.replay,phase.status,phase.partial,phase.action_set],
   [1,"devkit-core","local-files","safe","completed",true,"bundled-assets@1"]);
  assert.deepEqual(phase.created_files,files);timestamp(phase.started_at);assert.equal(phase.ended_at,a.ended_at);
  const staged=active.filter(action=>action.action==="install-bundled-skills");
  assert.equal(a.staging.length,staged.length);assert.equal(new Set(a.staging).size,a.staging.length);
  a.staging.forEach((name,i)=>{
   assert.equal(path.dirname(name),path.dirname(staged[i].target));
   assert.equal(path.basename(name).slice(0,-16),".aigentry-assets-"+a.run_id+"-");
   assert.match(path.basename(name).slice(-16),/^[a-f0-9]{16}$/);
   assert.equal(after[relative(name)],undefined,"published staging must not survive");
  });
  // Only these validated dynamic receipt bytes may differ; arbitrary keys,
  // file lists, paths, outcomes and non-private file metadata are rejected.
  expected[journalRel]={mode:0o100600,nlink:1,value:observed.value};
 }else assert.deepEqual(preview.plan.effects,[]);
 // Apply the independently measured filesystem accounting only to approved
 // new entries. Existing file/link bytes, modes and counts stay exact.
 for(const [name,entry] of Object.entries(expected)){
  if(Object.hasOwn(before,name))continue;
  const parent=path.dirname(name)==="."?"":path.dirname(name);
  expected[parent].nlink+=(entry.mode&0o170000)===0o040000?f.linkModel.directory:f.linkModel.file;
 }
 const evidence={label,preview,linkModel:f.linkModel,before,after,expected};
 fs.writeFileSync(path.join(f.root,"observers",label+"-reconciliation.json"),JSON.stringify(evidence,null,2));
 assert.deepEqual(after,expected,"complete successful tree delta must match approved effects");
}
for(const selection of ["skills","hud","skills,hud"])test("D2 actual finite copy and repeat preservation: "+selection,()=>withFixture(f=>{
 const before=assetPreview(f,selection),inventoryBefore=snapshot(f.tree),r=call(f,["setup",...before.args,"--accept-plan",before.hash]);
 assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.signal,null);
 assert.match(r.stdout,/Partial assets completed/);
 for(const a of before.plan.assets)for(const file of a.files){
  assert.deepEqual(fs.readFileSync(file.destination),fs.readFileSync(path.join(f.pkg,file.source)));
  assert.equal(fs.statSync(file.destination).mode&0o777,parseInt(file.mode,8));
 }
 assert.equal(fs.existsSync(path.join(f.home,".claude","settings.json")),false);
 assert.equal(fs.existsSync(path.join(f.home,".local")),false);
 const journal=JSON.parse(fs.readFileSync(path.join(f.home,".config/aigentry-devkit/install-journal.json")));
 assert.equal(journal.attempts.length,1);assert.equal(journal.attempts[0].partial,true);
 assert.deepEqual(journal.attempts[0].phases.map(p=>p.phase),[1]);
 assert.equal(journal.attempts[0].phases[0].status,"completed");
 reconcileSuccess(f,before,inventoryBefore,snapshot(f.tree),"success-"+selection);
 const repeat=assetPreview(f,selection);assert.ok(repeat.plan.assets.every(a=>a.skip));
 const snapshotBefore=snapshot(f.tree),again=call(f,["install",...repeat.args,"--accept-plan",repeat.hash]);
 assert.equal(again.status,0,again.stdout+again.stderr);assert.match(again.stdout,/no changes/);
 assert.deepEqual(snapshot(f.tree),snapshotBefore);
 reconcileSuccess(f,repeat,snapshotBefore,snapshot(f.tree),"all-skip-"+selection);
}));
test("D2 five-client fanout reconciles every successful effect",()=>withFixture(f=>{
 for(const dir of [".codex",".gemini/config",".grok"])fs.mkdirSync(path.join(f.home,dir),{recursive:true,mode:0o700});
 const p=assetPreview(f,"skills"),before=snapshot(f.tree);
 const roots=[".claude/skills",".codex/skills",".gemini/skills",".gemini/config/skills",".grok/skills"].map(dir=>path.join(f.home,dir));
 assert.equal(p.plan.assets.reduce((n,a)=>n+a.files.length,0),38*5);
 for(const root of roots)assert.equal(p.plan.assets.flatMap(a=>a.files).filter(file=>file.destination.startsWith(root+path.sep)).length,38);
 const r=call(f,["setup",...p.args,"--accept-plan",p.hash]);
 assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);
 reconcileSuccess(f,p,before,snapshot(f.tree),"five-client-success");
}));
test("D2 successful-effect oracle detects a deliberate unrelated file",()=>withFixture(f=>{
 const p=assetPreview(f,"hud"),before=snapshot(f.tree);
 const r=call(f,["setup",...p.args,"--accept-plan",p.hash]);
 assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);
 reconcileSuccess(f,p,before,snapshot(f.tree),"control-clean-success");
 fs.writeFileSync(path.join(f.home,"unrelated-control.txt"),"fixture-only unexpected effect",{mode:0o600});
 assert.throws(()=>reconcileSuccess(f,p,before,snapshot(f.tree),"control-unrelated-effect"),{code:"ERR_ASSERTION"});
}));
for(const variant of ["source","destination","journal","lock","catalogue"])test("D2 stale authority refuses unchanged: "+variant,()=>withFixture(f=>{
 const p=assetPreview(f,"hud");
 const dir=path.join(f.home,".config/aigentry-devkit");
 if(variant==="source")fs.appendFileSync(path.join(f.pkg,"hud/simple-status.sh"),"\n# changed\n");
 if(variant==="destination"){fs.mkdirSync(path.join(f.home,".claude/hud"),{recursive:true});fs.writeFileSync(path.join(f.home,".claude/hud/simple-status.sh"),"local");}
 if(variant==="journal"||variant==="lock"){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dir,variant==="lock"?"install-journal.lock":"install-journal.json"),variant==="lock"?"foreign":JSON.stringify({schema:"aigentry-devkit/install-journal@1",attempts:[]}));
 }
 if(variant==="catalogue")fs.appendFileSync(path.join(f.pkg,"config/setup-capabilities.json")," ");
 const before=snapshot(f.tree),r=call(f,["setup",...p.args,"--accept-plan",p.hash]);
 assert.equal(r.status,1,r.stdout+r.stderr);assert.deepEqual(snapshot(f.tree),before);
}));
for(const phase of [1,3,5,6])test("D2 unresolved legacy phase refuses assets: "+phase,()=>withFixture(f=>{
 const dir=path.join(f.home,".config/aigentry-devkit");fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(dir,"install-journal.json"),JSON.stringify({schema:"aigentry-devkit/install-journal@1",attempts:[{phases:[{phase,status:"running"}]}]}));
 const before=snapshot(f.tree),r=call(f,["setup",...assetChoices,"--dry-run"]);
 assert.equal(r.status,1);assert.match(r.stderr,/unresolved legacy/);assert.deepEqual(snapshot(f.tree),before);
}));
for(const args of [["--force"],["--yes"],["--manifest","arbitrary"],["--accept-plan","0".repeat(64)],["--configure-only"]])test("D2 invalid asset authority: "+args.join(" "),()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,["setup",...assetChoices,...args],"bin/aigentry-devkit.js",{AIGENTRY_INSTALL_UNKNOWN_EFFECT:"replay",AIGENTRY_INSTALL_FORCE_UNLOCK:"1",AIGENTRY_ORCH_BUILD:"true"});
 assert.equal(r.status,1);assert.deepEqual(snapshot(f.tree),before);
}));
test("D2 fixed executor refuses missing authority without effects",()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,[],"lib/setup-executor.js");
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/EARLY_EFFECT|EARLY_IMPORT|MODULE_NOT_FOUND/);
 assert.deepEqual(snapshot(f.tree),before);
}));

test("D2 asset preview describes finite copies without effects",()=>withFixture(f=>{
 const before=snapshot(f.tree),r=call(f,["setup",...assetChoices,"--dry-run"]);
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 const plan=JSON.parse(r.stdout.slice(r.stdout.indexOf("{"),r.stdout.indexOf("\n--accept-plan")));
 assert.equal(plan.mode,"assets");
 assert.equal(plan.assets.reduce((n,a)=>n+a.files.length,0),39);
 assert.match(r.stdout,/partial/i);
 assert.deepEqual(snapshot(f.tree),before);
}));

test("D2 durable begin precedes asset failure and records partial failure",()=>withFixture(f=>{
 const p=assetPreview(f),r=call(f,["setup",...p.args,"--accept-plan",p.hash],"bin/aigentry-devkit.js",{TEST_ASSET_FAILURE:"1"});
 assert.equal(r.status,1);assert.match(r.stderr,/partial asset operation failed/);
 const j=JSON.parse(fs.readFileSync(path.join(f.home,".config/aigentry-devkit/install-journal.json")));
 assert.equal(j.attempts.at(-1).phases[0].status,"failed");
 assert.equal(j.attempts.at(-1).partial,true);
 assert.equal(fs.existsSync(path.join(f.home,".config/aigentry-devkit/install-journal.lock")),false);
 assert.ok(fs.existsSync(path.join(f.root,"observers/durable.jsonl")));
 assert.equal(fs.existsSync(path.join(f.home,".claude/hud/simple-status.sh")),false);
}));
for(const point of ["after-tmp-write","before-rename","after-rename"])test("D2 writer crash leaves assets untouched and no success receipt: "+point,()=>withFixture(f=>{
 const p=assetPreview(f,"hud"),r=call(f,["setup",...p.args,"--accept-plan",p.hash],"bin/aigentry-devkit.js",{AIGENTRY_INSTALL_JOURNAL_CRASH:point});
 assert.equal(r.status,70);assert.equal(r.signal,null);assert.doesNotMatch(r.stdout,/Partial assets completed/);
 assert.equal(fs.existsSync(path.join(f.home,".claude")),false);
 assert.equal(fs.existsSync(path.join(f.home,".config/aigentry-devkit/install-journal.lock")),true);
}));
for(const unsafe of ["symlink-source","hardlink-source","symlink-target","wide-parent"])test("D2 unsafe copy boundary refuses unchanged: "+unsafe,()=>withFixture(f=>{
 const source=path.join(f.pkg,"hud/simple-status.sh"),target=path.join(f.home,".claude/hud/simple-status.sh");
 if(unsafe==="symlink-source"){fs.renameSync(source,source+".original");fs.symlinkSync(source+".original",source);}
 if(unsafe==="hardlink-source")fs.linkSync(source,source+".alias");
 if(unsafe==="symlink-target"){fs.mkdirSync(path.dirname(target),{recursive:true});fs.symlinkSync(source,target);}
 if(unsafe==="wide-parent"){fs.mkdirSync(path.join(f.home,".claude"));fs.chmodSync(path.join(f.home,".claude"),0o777);}
 const before=snapshot(f.tree),r=call(f,["setup",...assetChoices,"--dry-run"]);
 assert.equal(r.status,1);assert.deepEqual(snapshot(f.tree),before);
}));

test("D2 lost receipt after first asset file remains running and refuses replay",()=>withFixture(f=>{
 const p=assetPreview(f,"hud"),r=call(f,["setup",...p.args,"--accept-plan",p.hash],"bin/aigentry-devkit.js",{TEST_ASSET_EXIT:"after-first-file"});
 assert.equal(r.status,71);assert.doesNotMatch(r.stdout,/Partial assets completed/);
 const dir=path.join(f.home,".config/aigentry-devkit"),j=JSON.parse(fs.readFileSync(path.join(dir,"install-journal.json")));
 assert.equal(j.attempts.at(-1).outcome,"running");assert.equal(j.attempts.at(-1).phases[0].status,"running");
 const before=snapshot(f.tree),next=call(f,["setup",...p.args,"--dry-run"]);
 assert.equal(next.status,1);assert.deepEqual(snapshot(f.tree),before);
}));
test("D2 observed skill publication conflict preserves the existing object",()=>withFixture(f=>{
 const p=assetPreview(f,"skills"),r=call(f,["setup",...p.args,"--accept-plan",p.hash],"bin/aigentry-devkit.js",{TEST_ASSET_CONFLICT:"skill"});
 assert.equal(r.status,1);assert.match(r.stderr,/partial asset operation failed/);
 const target=path.join(f.home,".claude/skills/ambiguity-gate");
 assert.deepEqual(fs.readdirSync(target),["preserve.txt"]);
 assert.equal(fs.readFileSync(path.join(target,"preserve.txt"),"utf8"),"concurrent owned fixture");
 const j=JSON.parse(fs.readFileSync(path.join(f.home,".config/aigentry-devkit/install-journal.json")));
 assert.equal(j.attempts.at(-1).phases[0].status,"failed");
 assert.equal(j.attempts.at(-1).staging.length,1);
 assert.ok(fs.existsSync(j.attempts.at(-1).staging[0]),"failed staging retained, not recursively deleted");
}));

for(const crash of [false,true])test("D2 actual Bash entry: "+(crash?"same PID recorded before crash":"HUD copy with sanitized loader environment"),()=>withFixture(f=>{
 const bin=path.join(f.root,"observers/bin");fs.mkdirSync(bin,{mode:0o700});fs.symlinkSync(process.execPath,path.join(bin,"node"));
 const args=[...assetChoices];args[args.length-1]="hud";
 const preview=call(f,["setup",...args,"--dry-run"],"bin/aigentry-devkit.js",{PATH:bin});
 assert.equal(preview.status,0,preview.stderr);
 const hash=preview.stdout.match(/--accept-plan ([a-f0-9]{64})/)[1];
 const loader=path.join(f.root,"observers/loader-tripwire.cjs");fs.writeFileSync(loader,'throw Error("UNSANITIZED_LOADER");\n');
 const guard=path.join(f.root,"observers/bash-entry-guard.sh");
 fs.writeFileSync(guard,String.raw`trap 'case "$BASH_COMMAND" in *\$\(*) printf "%s\n" EARLY_SUBSTITUTION >&2; exit 97;; esac' DEBUG
`);
 const env={HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,".config"),PATH:bin,
  TMPDIR:path.join(f.tree,"tmp"),TMP:path.join(f.tree,"tmp"),TEMP:path.join(f.tree,"tmp"),BASH_ENV:guard,
  NODE_OPTIONS:"--require "+loader,NODE_PATH:path.join(f.root,"observers"),
  ...(crash?{AIGENTRY_INSTALL_JOURNAL_CRASH:"after-rename"}:{})};
 const before=snapshot(f.tree),command=["/bin/bash","--noprofile","--norc",path.join(f.pkg,"install.sh"),...args,"--accept-plan",hash];
 const r=spawnSync(command[0],command.slice(1),{env,encoding:"utf8",timeout:10000});
 fs.writeFileSync(path.join(f.root,"observers/bash-result.json"),JSON.stringify({command,env,before,after:snapshot(f.tree),...r},null,2));
 assert.equal(r.status,crash?70:0,r.stderr);assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/UNSANITIZED_LOADER|EARLY_SUBSTITUTION/);
 if(crash){
  const lock=JSON.parse(fs.readFileSync(path.join(f.home,".config/aigentry-devkit/install-journal.lock")));
  assert.equal(lock.pid,r.pid,"native shell child PID must equal Node writer PID after exec");
  assert.equal(fs.existsSync(path.join(f.home,".claude")),false);
 }else{
  assert.match(r.stdout,/Partial assets completed/);
  assert.deepEqual(fs.readFileSync(path.join(f.home,".claude/hud/simple-status.sh")),fs.readFileSync(path.join(f.pkg,"hud/simple-status.sh")));
 }
 // Same-PID evidence is not a system-wide zero-descendant observer receipt.
}));

test("D2 direct Bash refuses before command substitution",()=>withFixture(f=>{
 // DEBUG stops the baseline's first command substitution before it can run.
 // This is a negative entry discriminator, not native zero-descendant proof.
 const observer=path.join(f.root,"observers","shell-guard.sh");
 fs.writeFileSync(observer,String.raw`trap 'case "$BASH_COMMAND" in *\$\(*) printf "%s\n" EARLY_SUBSTITUTION >&2; exit 97;; esac' DEBUG
`);
 const before=snapshot(f.tree),env={HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,".config"),
  TMPDIR:path.join(f.tree,"tmp"),TMP:path.join(f.tree,"tmp"),TEMP:path.join(f.tree,"tmp"),PATH:"",BASH_ENV:observer};
 const r=spawnSync("/bin/bash",["--noprofile","--norc",path.join(f.pkg,"install.sh")],{env,encoding:"utf8",timeout:10000});
 fs.writeFileSync(path.join(f.root,"observers","shell-result.json"),JSON.stringify({env,...r},null,2));
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.equal(r.signal,null);
 assert.doesNotMatch(r.stderr,/EARLY_SUBSTITUTION/);
 assert.deepEqual(snapshot(f.tree),before);
}));
