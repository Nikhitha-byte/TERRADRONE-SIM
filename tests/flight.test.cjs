const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const ctxProxy=new Proxy({},{get:(_,key)=>key==='measureText'?()=>({width:20}):()=>{}});
const element=()=>({style:{},children:[],classList:{toggle(){},remove(){}},tHead:{},tBodies:[{}],getContext:()=>ctxProxy,addEventListener(){},appendChild(){},setAttribute(){},getBoundingClientRect:()=>({left:0,top:0})});
const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
const context=vm.createContext({console,Math,Date,JSON,Uint8Array,Float64Array,Buffer,atob:s=>Buffer.from(s,'base64').toString('binary'),window:{},document:{getElementById:el,createElement:element,querySelectorAll:()=>[],addEventListener(){}},addEventListener(){},devicePixelRatio:1,setTimeout(){}});
let source=fs.readFileSync(path.join(root,'app.js'),'utf8');source=source.slice(0,source.lastIndexOf('(async()=>'));
vm.runInContext(source,context);
vm.runInContext(fs.readFileSync(path.join(root,'drone_data.js'),'utf8'),context);
vm.runInContext(`
 renderPlan=()=>PLAN=plan();syncCfg=()=>{};draw=()=>{};cards=()=>{};renderTable=()=>{};updateButtons=()=>{};log=()=>{};
 const FI=window.REAL.fieldimager.ex2,bytes=atob(FI.canopy),canopy=Uint8Array.from(bytes,c=>c.charCodeAt(0));
 MAP={name:'FIELDimageR potato trial',W:FI.w*FI.gsd,H:FI.h*FI.gsd,sum:['Imagery and raster copied from the user-supplied Drone Scout project; original provenance not independently validated.'],valid:()=>1,layer:{},sample(x0,y0,x1,y1){let sum=0,n=0;for(let j=Math.max(0,Math.floor(y0/FI.cell_m));j<Math.min(FI.gh,Math.ceil(y1/FI.cell_m));j++)for(let i=Math.max(0,Math.floor(x0/FI.cell_m));i<Math.min(FI.gw,Math.ceil(x1/FI.cell_m));i++){sum+=canopy[j*FI.gw+i]/100;n++}return{valid:Math.max(0,Math.min(x1,this.W)-Math.max(x0,0))*Math.max(0,Math.min(y1,this.H)-Math.max(y0,0))/((x1-x0)*(y1-y0)),name:'canopy_cover',value:n?sum/n:null}}};
`,context);
const run=script=>vm.runInContext(script,context);
function reset(changes={}){run(`Object.assign(C,DEF,${JSON.stringify(changes)});AOI=null;normalizeConfig();resetMission();startMission();`)}
function finish(max=60000){run(`for(let i=0;i<${max}&&['fly','rth','landing'].includes(S.phase);i++)step(DT);`);return JSON.parse(run('JSON.stringify(missionObject())'))}
reset();run('step(DT)');assert.equal(run('S.route[S.wp].type'),'takeoff');assert(run('S.z')<.1,'First step must not jump to survey altitude');
const normal=finish();assert.equal(normal.summary.state,'done','Default mission must finish');assert(normal.captures.length>20,'Survey must capture many records');assert(normal.summary.coverage_pct>95,'Default mission should cover most of field');
assert.equal(run('S.z'),0);assert(run('Math.hypot(S.x-HOME().x,S.y-HOME().y)')<4,'Landed location must be near home');
assert(normal.telemetry.some(r=>r.alt_m>29));assert(normal.telemetry.some(r=>r.phase==='rth'&&r.alt_m>1&&r.alt_m<29),'Return must include actual descent');
assert(normal.captures.every(c=>c.alt>29&&c.valid>=0&&c.valid<=1&&c.mval!==''));
assert(normal.telemetry.every(r=>Number.isFinite(r.x_m)&&r.air_speed_ms<=14.001&&r.battery_pct>=0&&r.battery_pct<=100));
fs.writeFileSync(path.join(root,'sample-results','mission.json'),JSON.stringify(normal,null,2));fs.writeFileSync(path.join(root,'sample-results','captures.csv'),run('csvText()'));fs.writeFileSync(path.join(root,'sample-results','footprints-local.json'),run('geoText()'));fs.writeFileSync(path.join(root,'sample-results','configuration.json'),run('JSON.stringify(configObject(),null,2)'));
const signature=normal.captures.map(c=>[c.t,c.x,c.y,c.mval]);reset();assert.deepEqual(finish().captures.map(c=>[c.t,c.x,c.y,c.mval]),signature,'Seeded mission should be reproducible');
reset({wind:0,gust:0,gnss:0});run('AOI={x:8,y:20,W:12,H:30};resetMission();startMission()');const area=finish();assert.equal(area.summary.state,'done');assert(run('PLAN.wps.every(w=>w.x>=8&&w.x<=20&&w.y>=20&&w.y<=50)'));assert(area.summary.coverage_pct>95);
reset({start:20,rthres:15,crit:10});const low=finish();assert.equal(low.summary.state,'landed');assert(run('!!S.resume'));assert(low.summary.battery_remaining_pct>9,'Reserve should prevent battery exhaustion');run('C.start=100;swapBattery()');assert.equal(finish().summary.state,'done','Battery swap must resume and finish');
reset();run('for(let i=0;i<300;i++)step(DT);S.route0=S.route;startRTH("Test manual return")');assert.equal(finish().summary.state,'landed','Manual return should leave mission resumable');
reset();run('for(let i=0;i<200;i++)step(DT);S.E=C.energy*.09');assert.equal(finish().summary.state,'landed');assert(run('S.emergency&&!S.resume'),'Emergency land must not claim home or allow a home battery swap');
reset({alt:8,gsdk:30,tmin:10,fwd:95});assert(run('PLAN.vs*C.tmin<=PLAN.dF'),'Slow capture interval must limit speed without a minimum speed override');
console.log(JSON.stringify({result:'PASS',tests:['takeoff altitude gate','full flight and descent','data bounds','deterministic replay','survey area','battery return and resume','manual return','emergency landing','capture interval constraint'],defaultMission:normal.summary},null,2));
