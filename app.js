const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),D2R=Math.PI/180;
/* ===== configuration ===== */
const GROUPS=[
 {id:"plat",title:"Platform · DJI Phantom 4 Multispectral",p:[
  ["mass","Take-off mass","kg",1.487,"SPEC",{min:0.5,max:5,step:0.001},"Manufacturer take-off weight (1,487 g) including battery."],
  ["capmAh","Battery capacity","mAh",5870,"SPEC",{min:1000,max:20000,step:10},"Intelligent Flight Battery, LiPo 4S."],
  ["vnom","Battery nominal voltage","V",15.2,"SPEC",{min:7,max:30,step:0.1},""],
  ["energy","Battery energy","Wh",null,"DERIVED",{ro:1},"Capacity × voltage (89.2 Wh for the stock battery)."],
  ["tmaxSpec","Max flight time (reference)","min",27,"SPEC",{ro:1},"Manufacturer figure; used only to calibrate hover power below."],
  ["vmax","Max horizontal speed","m/s",14,"SPEC",{min:3,max:20,step:0.5},"50 km/h in P-mode."],
  ["vup","Max climb rate","m/s",6,"SPEC",{min:1,max:8,step:0.5},"Automatic flight."],
  ["vdown","Max descent rate","m/s",3,"SPEC",{min:0.5,max:6,step:0.5},""]]},
 {id:"sens",title:"Camera",p:[
  ["px","Image width","px",1600,"SPEC",{ro:1},"Each of the 5 monochrome bands and RGB: 1600 × 1300 px (2.08 MP)."],
  ["py","Image height","px",1300,"SPEC",{ro:1},""],
  ["focal","Focal length","mm",5.74,"SPEC",{ro:1},"Field of view 62.7° (spec, diagonal). The footprint below uses the published GSD formula instead."],
  ["gsdk","GSD constant (GSD cm/px = altitude m ÷ this)","",18.9,"SPEC",{min:10,max:30,step:0.1},"Manufacturer ground sample distance formula, height above the mapped area."],
  ["tmin","Shortest allowed capture interval","s",2,"ASSUMED",{min:0.5,max:10,step:0.5},"I use 2 s; the interval limit is not confirmed in the spec sheet I checked."]]},
 {id:"dyn",title:"Flight dynamics (modelled)",p:[
  ["acc","Horizontal acceleration limit","m/s²",3,"ASSUMED",{min:0.5,max:8,step:0.5},"Not a manufacturer figure."],
  ["dec","Braking limit","m/s²",3,"ASSUMED",{min:0.5,max:8,step:0.5},""],
  ["tau","Velocity response time constant","s",0.7,"ASSUMED",{min:0.1,max:3,step:0.1},"First-order lag between commanded and actual velocity."],
  ["zacc","Vertical acceleration limit","m/s²",3,"ASSUMED",{min:0.5,max:8,step:0.5},""],
  ["yawr","Yaw rate limit","°/s",90,"ASSUMED",{min:10,max:250,step:10},""],
  ["kp","Lane-tracking gain","1/s",0.8,"ASSUMED",{min:0.1,max:3,step:0.1},"Cross-track correction toward the lane line."],
  ["ki","Lane-tracking integral gain","1/s²",0.05,"ASSUMED",{min:0,max:0.5,step:0.01},"Removes the steady drift caused by wind."]]},
 {id:"pow",title:"Power and battery logic (modelled)",p:[
  ["phov","Hover power","W",165,"ASSUMED",{min:50,max:500,step:5},"Chosen so a gentle flight lasts about the 27 min spec."],
  ["pload","Avionics and camera power","W",12,"ASSUMED",{min:0,max:60,step:1},""],
  ["kv","Forward-flight power factor","per (m/s)²",0.004,"ASSUMED",{min:0,max:0.02,step:0.001},"Power = hover × (1 + factor × speed²)."],
  ["eta","Climb efficiency","",0.85,"ASSUMED",{min:0.4,max:1,step:0.01},"Extra power for climbing = mass × g × climb rate ÷ efficiency."],
  ["start","Starting battery","%",100,"SIM",{min:20,max:100,step:5},"Set low to see return-to-home on low battery."],
  ["rthres","Return-home reserve","%",15,"ASSUMED",{min:5,max:40,step:1},"Return home when energy left is less than the energy to fly home plus this reserve."],
  ["crit","Critical level (land immediately)","%",10,"ASSUMED",{min:3,max:25,step:1},""]]},
 {id:"mis",title:"Mission",p:[
  ["alt","Survey altitude above ground","m",30,"SIM",{min:8,max:120,step:1},"Sets GSD and footprint; lower is sharper but slower."],
  ["fwd","Forward overlap","%",80,"SIM",{min:50,max:95,step:1},"Shot spacing along the lane."],
  ["side","Side overlap","%",70,"SIM",{min:30,max:90,step:1},"Lane spacing."],
  ["vtr","Transit speed","m/s",8,"ASSUMED",{min:2,max:14,step:0.5},"Between home, lanes and back."],
  ["dir","Lane direction","",0,"SIM",{sel:[["0","Along the long side"],["1","Along the short side"]]},""]]},
 {id:"env",title:"Environment and sensor noise (simulated)",p:[
  ["wind","Mean wind speed","m/s",3,"SIM",{min:0,max:12,step:0.5},"Aircraft rated for 10 m/s wind in the spec; above that the model still flies but behaves unrealistically."],
  ["wdir","Wind from (up on the map = 0°)","°",270,"SIM",{min:0,max:355,step:5},"Relative to the top of the map image."],
  ["gust","Gust strength (1σ)","m/s",0.8,"SIM",{min:0,max:3,step:0.1},"Random gusts, correlation time 5 s."],
  ["gnss","GNSS position error (1σ per axis)","m",0.75,"ASSUMED",{min:0,max:3,step:0.05},"Spec hover accuracy is ±1.5 m horizontally with GNSS only; the controller steers by this noisy position."],
  ["gtau","GNSS error correlation time","s",15,"ASSUMED",{min:1,max:60,step:1},""],
  ["seed","Random seed","",7,"SIM",{min:1,max:9999,step:1},"Same seed gives the same wind and noise."]]}
];
const DEF={};GROUPS.forEach(g=>g.p.forEach(p=>DEF[p[0]]=p[3]));const C={...DEF};
function derive(){C.energy=C.capmAh*C.vnom/1000}
derive();
function buildCfg(){const el=$("cfg");el.innerHTML="";GROUPS.forEach((g,gi)=>{const d=document.createElement("details");d.className="grp";if(gi===4)d.open=true;
  d.innerHTML=`<summary>${g.title}<span class="n">${g.p.length} settings</span></summary>`;
  g.p.forEach(p=>{const [k,lab,u,def,tag,o,note]=p,row=document.createElement("div");row.className="prm";
   const inp=o.sel?`<select id="cfg-${k}" data-k="${k}">${o.sel.map(s=>`<option value="${s[0]}">${s[1]}</option>`).join("")}</select>`:`<input id="cfg-${k}" data-k="${k}" type="number" ${o.ro?"disabled":""} min="${o.min??""}" max="${o.max??""}" step="${o.step??"any"}">`;
   row.innerHTML=`<label for="cfg-${k}">${lab} <span class="tag t-${tag}">${tag}</span></label><div class="in">${inp}<span class="u">${u}</span></div>${note?`<div class="nt">${note}</div>`:""}`;d.appendChild(row)});el.appendChild(d)});syncCfg();
  el.addEventListener("change",e=>{const k=e.target.dataset.k;if(!k)return;let v=e.target.tagName==="SELECT"?+e.target.value:parseFloat(e.target.value);const p=GROUPS.flatMap(g=>g.p).find(p=>p[0]===k),o=p[5];if(!isFinite(v))v=DEF[k];if(o.sel)v=o.sel.some(q=>+q[0]===v)?v:DEF[k];else v=clamp(v,o.min??-Infinity,o.max??Infinity);C[k]=v;normalizeConfig();derive();syncCfg();resetMission();notice("Configuration updated. The simulation has been reset.")})}
function syncCfg(){$("activeMass").textContent=C.mass.toFixed(3)+" kg";$("activeEnergy").textContent=C.energy.toFixed(1)+" Wh";document.querySelectorAll("#cfg [data-k]").forEach(e=>{const k=e.dataset.k;e.value=k==="energy"?C.energy.toFixed(1):C[k];const p=GROUPS.flatMap(g=>g.p).find(p=>p[0]===k),tag=e.closest(".prm").querySelector(".tag");if(p[4]==="SPEC"){const custom=C[k]!==DEF[k];tag.className="tag t-"+(custom?"CUSTOM":"SPEC");tag.textContent=custom?"CUSTOM":"SPEC"}})}
/* ===== maps ===== */
const MAPS={},loadImg=src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src});
let MAP=null,VIEWM=10,AOI=null;
async function buildMaps(){
 const R=window.REAL,FI=R.fieldimager.ex2,gs=FI.gsd;
 const img=await loadImg(FI.img),b=atob(FI.canopy),can=new Uint8Array(b.length);for(let i=0;i<b.length;i++)can[i]=b.charCodeAt(i);
 const fw=FI.w*gs,fh=FI.h*gs,cell=FI.cell_m;
 MAPS.field={name:"FIELDimageR potato trial",W:fw,H:fh,real:"orthophoto + excess-green canopy raster",base:img,layer:img,valid:()=>1,
  sample(x0,y0,x1,y1){let s=0,n=0;for(let r=Math.max(0,Math.floor(y0/cell));r<Math.min(FI.gh,Math.ceil(y1/cell));r++)for(let c=Math.max(0,Math.floor(x0/cell));c<Math.min(FI.gw,Math.ceil(x1/cell));c++){s+=can[r*FI.gw+c]/100;n++}
   const area=(x1-x0)*(y1-y0),inside=Math.max(0,Math.min(x1,fw)-Math.max(x0,0))*Math.max(0,Math.min(y1,fh)-Math.max(y0,0));return{valid:inside/area,name:"canopy_cover",value:n?s/n:null}},
  sub:"Real orthophoto of a potato trial · "+fw.toFixed(0)+" × "+fh.toFixed(0)+" m · "+(gs*100).toFixed(2)+" cm/px",
  sum:["A real orthophoto (stitched aerial map) of a potato research trial, with a canopy-cover raster computed from it (excess-green index). Metric logged per capture: mean canopy cover under the footprint.","Imagery and canopy raster are real and derived from real pixels. The map is shown in its original orientation (tall, not north-up).","Map size "+fw.toFixed(1)+" × "+fh.toFixed(1)+" m. A footprint at 30 m altitude is about 25 m wide, so a survey needs only a couple of lanes."]};
 const C5=window.REAL5,cw=C5.w,ch=C5.h,cg=C5.gsd,cir=await loadImg("data:image/jpeg;base64,"+C5.cir),nd=await loadImg("data:image/png;base64,"+C5.nd);
 const cc=document.createElement("canvas");cc.width=cw;cc.height=ch;const x=cc.getContext("2d",{willReadFrequently:true});x.drawImage(nd,0,0);const px=x.getImageData(0,0,cw,ch).data,q=new Uint8Array(cw*ch);for(let k=0;k<cw*ch;k++)q[k]=px[k*4];
 const IW=cw+1,I1=new Float64Array(IW*(ch+1)),I2=new Float64Array(IW*(ch+1));
 for(let y=0;y<ch;y++){let rs=0,rc=0;for(let xx=0;xx<cw;xx++){const v=q[y*cw+xx];if(v>0){rs+=C5.ndlo+v/255*(C5.ndhi-C5.ndlo);rc++}const i=(y+1)*IW+xx+1;I1[i]=I1[i-IW]+rs;I2[i]=I2[i-IW]+rc}}
 const col=document.createElement("canvas");col.width=cw;col.height=ch;const c2=col.getContext("2d"),im=c2.createImageData(cw,ch),o=im.data;
 for(let k=0;k<cw*ch;k++){const v=q[k];if(!v)continue;const n=C5.ndlo+v/255*(C5.ndhi-C5.ndlo),t=clamp((n-0.5)/0.4,0,1);let r,g,b2;if(t<0.5){const u=t/0.5;r=217+15*u;g=43+148*u;b2=69-11*u}else{const u=(t-0.5)/0.5;r=232-172*u;g=191+u;b2=58+48*u}o[k*4]=r;o[k*4+1]=g;o[k*4+2]=b2;o[k*4+3]=255}c2.putImageData(im,0,0);
 MAPS.cherry={name:"Cherry orchard, Kerasia",W:cw*cg,H:ch*cg,real:"multispectral orthomosaic + NDVI raster",base:cir,layer:col,valid:(x,y)=>{const i=Math.floor(x/cg),j=Math.floor(y/cg);return i>=0&&j>=0&&i<cw&&j<ch&&q[j*cw+i]>0?1:0},
  sample(x0,y0,x1,y1){let a=Math.max(0,Math.floor(x0/cg)),b=Math.min(cw,Math.ceil(x1/cg)),c=Math.max(0,Math.floor(y0/cg)),d=Math.min(ch,Math.ceil(y1/cg));const area=(x1-x0)*(y1-y0)/(cg*cg);if(b<=a||d<=c)return{valid:0,name:"ndvi",value:null};
   const cnt=I2[d*IW+b]-I2[c*IW+b]-I2[d*IW+a]+I2[c*IW+a],sum=I1[d*IW+b]-I1[c*IW+b]-I1[d*IW+a]+I1[c*IW+a];return{valid:Math.min(1,cnt/area),name:"ndvi",value:cnt>20?sum/cnt:null}},
  sub:"Real reflectance orthomosaic · "+(cw*cg).toFixed(0)+" × "+(ch*cg).toFixed(0)+" m · "+(cg*100).toFixed(1)+" cm/px",
  sum:["A real multispectral orthomosaic of a cherry orchard (green, red, red-edge and near-infrared bands) rotated to the tree rows. Metric logged per capture: mean NDVI of the real pixels under the footprint, and the share of the footprint that has data.","Imagery and NDVI are real, taken from sun-corrected reflectance rasters. NDVI colours appear where the drone has already captured.","Map size "+(cw*cg).toFixed(0)+" × "+(ch*cg).toFixed(0)+" m. The aerial map is a trapezoid, so footprints near the ends are partly empty."]};
 const fr=R.webodm.frames,imgs=await Promise.all(fr.map(f=>loadImg(f.rgb))),nds=await Promise.all(fr.map(f=>loadImg(f.ndvi))),BOX=12,MX=18,WW=-fr[fr.length-1].n+2*MX,HH=40;
 const boxes=fr.map((f,i)=>({f,i,x:-f.n+MX,y:HH/2+f.e*3}));
 const lay=document.createElement("canvas");lay.width=Math.round(WW*8);lay.height=Math.round(HH*8);const lx=lay.getContext("2d");lx.fillStyle="#0f1418";lx.fillRect(0,0,lay.width,lay.height);
 boxes.forEach((b,i)=>{if(imgs[i])lx.drawImage(imgs[i],(b.x-BOX/2)*8,(b.y-BOX/2)*8,BOX*8,BOX*8)});
 MAPS.webodm={name:"WebODM transect (GPS-placed frames)",W:WW,H:HH,real:"15 real frame pairs placed along the GPS transect",base:lay,layer:lay,valid:(x,y)=>boxes.some(b=>Math.abs(x-b.x)<=BOX/2&&Math.abs(y-b.y)<=BOX/2)?1:0,boxes,BOX,
  sample(x0,y0,x1,y1){let best=null,ba=0;for(const b of boxes){const a=Math.max(0,Math.min(x1,b.x+BOX/2)-Math.max(x0,b.x-BOX/2))*Math.max(0,Math.min(y1,b.y+BOX/2)-Math.max(y0,b.y-BOX/2));if(a>ba){ba=a;best=b}}
   return best?{valid:ba/((x1-x0)*(y1-y0)),name:"frame_mean_rel_ndvi",value:best.f.mean,frame:best.f.id}:{valid:0,name:"frame_mean_rel_ndvi",value:null}},
  sub:"15 real frames placed by GPS · "+(-fr[fr.length-1].n).toFixed(0)+" m transect · frame size on the map is assumed",
  sum:["15 real NIR + red frame pairs from a drone flight, placed along their real GPS positions. They do not overlap, so there is no true mosaic: the gaps between frames are empty.","Frame images and GPS positions are real. The size of each frame on the map (12 × 12 m) is ASSUMED, because the survey altitude and footprint are not recorded. The cross-track offsets are exaggerated three times for visibility.","A capture records the real frame it overlaps most, with that frame's mean gain-matched relative NDVI. Where the footprint overlaps no frame, there is no real data."]};
}
/* ===== planner ===== */
const gsdOf=h=>h/C.gsdk/100;                         // m/px
const footOf=h=>({w:C.px*gsdOf(h),l:C.py*gsdOf(h)});    // across-track width, along-track length
const powerOf=(v,vz)=>C.pload+C.phov*(1+C.kv*v*v)+(vz>0?C.mass*9.81*vz/C.eta:0);
const HOME=()=>({x:-5,y:-5});
function plan(){const m=AOI||{W:MAP.W,H:MAP.H,x:0,y:0},f=footOf(C.alt),vertical=(m.H>m.W)?(+C.dir===0):(+C.dir===1);   // lanes run along y when vertical
 const along=vertical?m.H:m.W,across=vertical?m.W:m.H,sp=Math.max(0.01,f.w*(1-C.side/100)),dF=Math.max(0.01,f.l*(1-C.fwd/100));
 const n=across<=f.w?1:Math.ceil((across-f.w)/sp)+1,pos=[];for(let i=0;i<n;i++)pos.push(n===1?across/2:f.w/2+i*(across-f.w)/(n-1));
 const vOv=dF/(C.tmin*1.05),vs=Math.min(C.vmax,vOv),lim=vOv<C.vmax?"capture interval":"max speed";
 const pt=(a,c)=>vertical?{x:c+m.x,y:a+m.y}:{x:a+m.x,y:c+m.y},wps=[];
 for(let i=0;i<n;i++){const a0=i%2?along:0,a1=i%2?0:along;wps.push({...pt(a0,pos[i]),z:C.alt,type:"lane0"},{...pt(a1,pos[i]),z:C.alt,type:"lane"})}
 let len=0,prev=HOME();const home=HOME();wps.forEach(w=>{len+=Math.hypot(w.x-prev.x,w.y-prev.y);prev=w});len+=Math.hypot(prev.x-home.x,prev.y-home.y);
 const laneLen=n*along,transLen=len-laneLen,tLane=laneLen/vs,tTrans=transLen/C.vtr+n*3+4*C.vmax/C.dec,tClimb=C.alt/C.vup*1.3,tDesc=C.alt/C.vdown*1.2;
 const E=(tLane*powerOf(vs,0)+tTrans*powerOf(C.vtr,0)+tClimb*powerOf(0,C.vup*0.7)+tDesc*powerOf(0,0))/3600,T=tLane+tTrans+tClimb+tDesc,photos=n*(Math.floor(along/dF)+1);
 return{f,n,sp:n>1?(across-f.w)/(n-1):0,dF,vs,lim,vertical,wps,len,E,T,photos,along,across,gsd:gsdOf(C.alt),pctE:E/C.energy*100,usable:C.start-C.rthres}}
function renderPlan(){const p=PLAN=plan(),m=MAP;const rows=[["Altitude / GSD",C.alt+" m / "+(p.gsd*100).toFixed(2)+" cm/px"],["Camera footprint",p.f.w.toFixed(1)+" × "+p.f.l.toFixed(1)+" m"],["Lanes",p.n+(p.vertical?" (vertical on image)":" (horizontal on image)")+", spacing "+p.sp.toFixed(1)+" m"],["Shot spacing",p.dF.toFixed(1)+" m, one every "+(p.dF/p.vs).toFixed(1)+" s"],["Survey speed",p.vs.toFixed(1)+" m/s (limited by "+p.lim+")"],["Photos",String(p.photos)],["Path length",p.len.toFixed(0)+" m"],["Estimated time",fmtT(p.T)],["Estimated battery",p.pctE.toFixed(0)+" % of a full battery"]];
 $("plan").innerHTML=rows.map(r=>`<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")+(p.pctE>p.usable?`<div class="warn">This mission needs about ${p.pctE.toFixed(0)} % of a battery but only ${p.usable.toFixed(0)} % is usable before the return-home reserve. The drone will return home and wait for a battery swap.</div>`:"")+(C.wind>10?`<div class="warn">Wind above the 10 m/s the airframe is rated for; results are not realistic.</div>`:"")}
const fmtT=t=>{t=Math.max(0,Math.round(t));return Math.floor(t/60)+":"+String(t%60).padStart(2,"0")};
let PLAN=null;
/* ===== simulation ===== */
const DT=0.1;let rng=null,S=null;
const mulberry=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const randn=()=>{let u=0,v=0;while(!u)u=rng();v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
let REV=null,revCtx=null,covCells=null,covValid=0,covHit=0,CAPS=[],HIST=[];
function newState(){const h=HOME();return{phase:"idle",t:0,x:h.x,y:h.y,z:0,vax:0,vay:0,vz:0,yaw:vYaw0(),gx:0,gy:0,gz:0,E:C.energy*C.start/100,wp:0,route:[],route0:null,I:0,sinceCap:1e9,tCap:-99,trail:[],gust:[0,0],ct2:0,ctn:0,gs:0,vair:0,P:0,resume:null,done:0,mission:[],flown:0}}
function vYaw0(){return 0}
function resetMission(){paused=false;acc=0;TELEMETRY=[];runStarted=null;renderedTableCount=-1;derive();syncCfg();rng=mulberry(C.seed);REV&&(REV.width=REV.width);S=newState();CAPS=[];HIST=[];covCells=null;$("log").innerHTML="";renderPlan();initCoverage();updateButtons();renderTable();draw();cards();}
function initCoverage(){const m=MAP,cs=0.5,gw=Math.ceil(m.W/cs),gh=Math.ceil(m.H/cs);covCells={cs,gw,gh,a:new Uint8Array(gw*gh),v:new Uint8Array(gw*gh)};covValid=0;covHit=0;for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){if(inSurvey((i+0.5)*cs,(j+0.5)*cs)&&m.valid((i+0.5)*cs,(j+0.5)*cs)){covCells.v[j*gw+i]=1;covValid++}}}
function log(msg,c){const d=document.createElement("div");if(c)d.className=c;d.innerHTML=`<span class="t">T+${fmtT(S.t)}</span> ${msg}`;const L=$("log");L.appendChild(d);L.scrollTop=L.scrollHeight}
function startMission(){if(S.phase!=="idle")return;runStarted=new Date().toISOString();const p=PLAN;S.mission=p.wps.map(w=>({...w}));const h=HOME();
 S.route=[{x:h.x,y:h.y,z:C.alt,type:"takeoff"},{...S.mission[0],type:"transit"},...S.mission.slice(1)];S.wp=0;S.phase="fly";S.t0=S.t;log(`Mission start · ${p.n} lanes · ${p.photos} photos planned · survey ${p.vs.toFixed(1)} m/s`,"o")}
function energyHome(){const d=Math.hypot(S.x-HOME().x,S.y-HOME().y);return(d/C.vtr*powerOf(C.vtr,0)+(S.z/C.vdown*1.2)*powerOf(0,0)+10*powerOf(0,0))/3600}
function startRTH(why){S.resume={wp:S.wp,x:S.x,y:S.y};const h=HOME();S.route=[{x:S.x,y:S.y,z:Math.max(S.z,C.alt),type:"rthstart"},{x:h.x,y:h.y,z:Math.max(S.z,C.alt),type:"rth"},{x:h.x,y:h.y,z:0,type:"land"}];S.wp=1;S.phase="rth";S.sinceCap=1e9;log(why,"w")}
function swapBattery(){if(S.phase!=="landed"||!S.resume)return;S.E=C.energy*C.start/100;const h=HOME(),r=S.resume,rest=S.route0.slice(r.wp);
 S.route=[{x:h.x,y:h.y,z:C.alt,type:"takeoff"},{x:r.x,y:r.y,z:C.alt,type:"transit"},...rest];S.wp=0;S.phase="fly";S.z=0;S.sinceCap=1e9;S.resume=null;log("Battery swapped · resuming at the interrupted lane","o");updateButtons()}
function step(dt){
 if(!["fly","rth","landing"].includes(S.phase))return;
 const previousTime=S.t;S.t+=dt;
 const th=(C.wdir+180)*D2R,ga=Math.exp(-dt/5);
 S.gust[0]=S.gust[0]*ga+C.gust*Math.sqrt(1-ga*ga)*randn();
 S.gust[1]=S.gust[1]*ga+C.gust*Math.sqrt(1-ga*ga)*randn();
 const wx=Math.sin(th)*C.wind+S.gust[0],wy=-Math.cos(th)*C.wind+S.gust[1];
 const na=Math.exp(-dt/C.gtau),ns=C.gnss*Math.sqrt(1-na*na);
 S.nx=(S.nx||0)*na+ns*randn();S.ny=(S.ny||0)*na+ns*randn();
 S.gx=S.x+S.nx;S.gy=S.y+S.ny;S.gz=S.z;
 const soc=S.E/C.energy*100;
 if(S.phase==="fly"&&S.z>C.alt*.9&&S.E<=energyHome()*1.1+C.energy*C.rthres/100){
  S.route0=S.route;startRTH(`Battery reserve reached (${soc.toFixed(1)} %) · returning home`);updateButtons();
 }
 if(soc<=C.crit&&S.phase!=="landing"){
  S.route=[{x:S.x,y:S.y,z:0,type:"land"}];S.wp=0;S.phase="landing";S.emergency=true;S.resume=null;
  log("Critical battery · simulated landing at current position","c");updateButtons();
 }
 let target=S.route[S.wp];if(!target)return;
 const previous=S.wp>0?S.route[S.wp-1]:HOME();
 const dx=target.x-S.gx,dy=target.y-S.gy,distance=Math.hypot(dx,dy);
 const lx=target.x-previous.x,ly=target.y-previous.y,length=Math.hypot(lx,ly);
 const ux=length>.01?lx/length:0,uy=length>.01?ly/length:0;
 const along=dx*ux+dy*uy,cross=(S.gx-previous.x)*(-uy)+(S.gy-previous.y)*ux;
 const groundSpeed=Math.hypot(S.vax+wx,S.vay+wy);
 if(target.type==="land"&&S.z<=.12){
  S.z=0;S.vz=0;S.vax=S.vay=S.gs=S.vair=S.P=0;
  S.roll=S.pitch=0;if(S.emergency){S.phase="landed";log("Emergency landing complete · mission incomplete","w");updateButtons()}
  else advance(target);
  recordTelemetry();return;
 }
 // Both horizontal and vertical arrival matter; takeoff cannot complete at z=0.
 if(target.type!=="land"&&Math.abs(S.z-target.z)<.6&&
    (distance<1 || (length>1&&along<.25&&Math.abs(cross)<2))){
  advance(target);target=S.route[S.wp];if(!target)return;
  recordTelemetry();return;
 }
 let vx=0,vy=0;
 const speedLimit=target.type==="lane"?PLAN.vs:Math.min(C.vtr,C.vmax);
 if(length>1&&target.type!=="takeoff"&&target.type!=="land"){
  const speed=Math.min(speedLimit,Math.sqrt(2*C.dec*Math.max(0,along)),Math.max(.3,distance));
  S.I=clamp(S.I+cross*dt,-8,8);
  const correction=clamp(-C.kp*cross-C.ki*S.I,-3,3);
  vx=ux*speed-uy*correction;vy=uy*speed+ux*correction;
  if(along<0){vx=clamp(dx*C.kp,-2,2);vy=clamp(dy*C.kp,-2,2)}
 }else{vx=clamp(dx*C.kp,-2,2);vy=clamp(dy*C.kp,-2,2)}
 // Wind estimate, as a real autopilot does it: the controller does not know the wind, it learns it
 // from the gap between ground and air velocity with a 3 s time constant (starts at zero after takeoff).
 // Steady wind is learned and cancelled; changes in wind (gusts, turns, takeoff) cause real tracking error.
 if(S.z>0.5){const k=Math.min(1,dt/3);S.wex=(S.wex||0)+(wx-(S.wex||0))*k;S.wey=(S.wey||0)+(wy-(S.wey||0))*k}
 let airX=vx-(S.wex||0),airY=vy-(S.wey||0);
 const desiredAir=Math.hypot(airX,airY);if(desiredAir>C.vmax){airX*=C.vmax/desiredAir;airY*=C.vmax/desiredAir}
 let ax=(airX-S.vax)/C.tau,ay=(airY-S.vay)/C.tau;
 const a=Math.hypot(ax,ay),limit=desiredAir<S.vair?C.dec:C.acc;
 if(a>limit){ax*=limit/a;ay*=limit/a}S.vax+=ax*dt;S.vay+=ay*dt;
 const vair=Math.hypot(S.vax,S.vay);if(vair>C.vmax){S.vax*=C.vmax/vair;S.vay*=C.vmax/vair}
 const vzDesired=target.type==="land"?-Math.min(C.vdown,Math.max(.25,S.z*.65)):clamp((target.z-S.z)*1.2,-C.vdown,C.vup);
 S.vz+=clamp((vzDesired-S.vz)/.45,-C.zacc,C.zacc)*dt;
 const gvx=S.vax+wx,gvy=S.vay+wy;
 S.x+=gvx*dt;S.y+=gvy*dt;S.z=Math.max(0,S.z+S.vz*dt);
 S.gs=Math.hypot(gvx,gvy);S.vair=Math.hypot(S.vax,S.vay);S.flown+=S.gs*dt;S.sinceCap+=S.gs*dt;
 let heading=S.yaw;if(target.type==="lane"&&length>1)heading=Math.atan2(ux,-uy);else if(S.gs>.3)heading=Math.atan2(gvx,-gvy);
 const yawDelta=((heading-S.yaw+3*Math.PI)%(2*Math.PI))-Math.PI;S.yaw+=clamp(yawDelta,-C.yawr*D2R*dt,C.yawr*D2R*dt);
 // Lean = acceleration + air drag (rotor drag 0.2 N per m/s + body drag 0.5*rho*CdA*v^2, CdA 0.05 m^2):
 // the drone tilts into the wind to hold its track, same drag model as physics6dof.js.
 const vA=Math.hypot(S.vax,S.vay),dK=(0.2+0.5*1.225*0.05*vA)/C.mass,tx=ax+dK*S.vax,ty=ay+dK*S.vay;
 S.roll=clamp(Math.atan2(tx*Math.cos(S.yaw)+ty*Math.sin(S.yaw),9.81),-.61,.61);
 S.pitch=clamp(Math.atan2(tx*Math.sin(S.yaw)-ty*Math.cos(S.yaw),9.81),-.61,.61);
 S.P=powerOf(S.vair,S.vz);S.E=Math.max(0,S.E-S.P*dt/3600);
 if(target.type==="lane"){S.ct2+=cross*cross;S.ctn++;
  if(Math.abs(S.z-C.alt)<.8&&S.sinceCap>=PLAN.dF&&S.t-S.tCap>=C.tmin)capture();
 }
 if(Math.floor(S.t)>Math.floor(previousTime)){
  HIST.push([S.t,S.P,S.E/C.energy*100,S.gs]);if(HIST.length>400)HIST.shift();recordTelemetry();
 }
 if(Math.floor(S.t*2)>Math.floor(previousTime*2)){S.trail.push([S.x,S.y]);if(S.trail.length>4000)S.trail.shift()}
}

function advance(tg){const prev=tg;if(tg.type==="land"){S.phase="landed";S.z=0;S.vax=S.vay=0;S.vz=0;S.gs=S.vair=S.P=0;
  if(S.resume&&S.route0&&S.route0.slice(S.resume.wp).some(w=>w.type==="lane"||w.type==="lane0")){log("Landed at home · mission incomplete · swap battery to continue","w");S.phase="landed"}else{S.phase="done";log("Mission complete · landed at home · "+CAPS.length+" captures · coverage "+covPct().toFixed(0)+" %","o")}updateButtons();return}
 S.wp++;S.I=0;const nx=S.route[S.wp];if(!nx){S.route.push({x:HOME().x,y:HOME().y,z:C.alt,type:"rth"},{x:HOME().x,y:HOME().y,z:0,type:"land"});S.phase="rth";log("Survey complete · returning home","o");S.sinceCap=1e9;return}
 if(nx.type==="lane0"||nx.type==="lane"){if(nx.type==="lane")S.sinceCap=1e9;} if(S.phase==="fly"&&tg.type==="takeoff")log("Reached survey altitude · transit to first lane")}
const covPct=()=>covValid?covHit/covValid*100:0;
function capture(){const f=footOf(S.z),vert=PLAN.vertical,w=vert?f.w:f.l,h=vert?f.l:f.w;
 // footprint: across-track = f.w, along-track = f.l; lane axis picks orientation
 const x0=S.x-w/2,x1=S.x+w/2,y0=S.y-h/2,y1=S.y+h/2,s=MAP.sample(x0,y0,x1,y1);
 const r={id:CAPS.length+1,t:+S.t.toFixed(1),x:+S.x.toFixed(2),y:+S.y.toFixed(2),alt:+S.z.toFixed(1),yaw:+((S.yaw/D2R+360)%360).toFixed(0),gx:+S.gx.toFixed(2),gy:+S.gy.toFixed(2),spd:+S.gs.toFixed(2),bat:+(S.E/C.energy*100).toFixed(1),fw:+w.toFixed(2),fh:+h.toFixed(2),gsd:+(gsdOf(S.z)*100).toFixed(2),valid:+s.valid.toFixed(3),mname:s.name,mval:s.value===null?"":+s.value.toFixed(4),frame:s.frame||"",x0,y0,x1,y1};
 CAPS.push(r);S.sinceCap=0;S.tCap=S.t;
 // reveal + coverage
 const cs=covCells;for(let j=Math.max(0,Math.floor(y0/cs.cs));j<Math.min(cs.gh,Math.ceil(y1/cs.cs));j++)for(let i=Math.max(0,Math.floor(x0/cs.cs));i<Math.min(cs.gw,Math.ceil(x1/cs.cs));i++){const k=j*cs.gw+i;if(cs.v[k]&&!cs.a[k]){cs.a[k]=1;covHit++}}
 ensureRev();const k=PPM;revCtx.save();revCtx.beginPath();revCtx.rect(x0*k,y0*k,(x1-x0)*k,(y1-y0)*k);revCtx.clip();const L=MAP.layer;revCtx.drawImage(L,0,0,MAP.W*k,MAP.H*k);revCtx.restore()}
let PPM=8;function ensureRev(){if(!REV){REV=document.createElement("canvas")}if(REV.width!==Math.round(MAP.W*PPM)||REV.height!==Math.round(MAP.H*PPM)){REV.width=Math.round(MAP.W*PPM);REV.height=Math.round(MAP.H*PPM)}revCtx=REV.getContext("2d")}
/* ===== drawing ===== */
const mc=$("map"),mx=mc.getContext("2d"),chc=$("chart"),chx=chc.getContext("2d");let cw=0,chh=0,SC=1,dpr=1;
function size(){const w=mc.clientWidth;if(!w||!MAP)return;dpr=Math.min(2,devicePixelRatio||1);cw=w;const maxH=innerWidth<700?520:640;SC=Math.min(w/(MAP.W+2*VIEWM),maxH/(MAP.H+2*VIEWM));chh=Math.round((MAP.H+2*VIEWM)*SC);mc.style.height=chh+"px";mc.width=Math.round(cw*dpr);mc.height=Math.round(chh*dpr);mx.setTransform(dpr,0,0,dpr,0,0);
 const cw2=chc.clientWidth;chc.width=Math.round(cw2*dpr);chc.height=Math.round(200*dpr);chx.setTransform(dpr,0,0,dpr,0,0)}
function draw(){if(!MAP||!cw)return;const c=mx,ox=(cw-(MAP.W+2*VIEWM)*SC)/2,X=x=>ox+(x+VIEWM)*SC,Y=y=>(y+VIEWM)*SC;
 c.fillStyle="#0f1418";c.fillRect(0,0,cw,chh);c.globalAlpha=0.32;c.drawImage(MAP.base,X(0),Y(0),MAP.W*SC,MAP.H*SC);c.globalAlpha=1;
 if(REV&&CAPS.length)c.drawImage(REV,X(0),Y(0),MAP.W*SC,MAP.H*SC);
 c.strokeStyle="#2d3b45";c.lineWidth=1;c.strokeRect(X(0),Y(0),MAP.W*SC,MAP.H*SC);
 if(MAP===MAPS.webodm){c.strokeStyle="rgba(138,153,164,0.5)";for(const b of MAP.boxes)c.strokeRect(X(b.x-MAP.BOX/2),Y(b.y-MAP.BOX/2),MAP.BOX*SC,MAP.BOX*SC)}
 // planned route
 c.setLineDash([5,5]);c.strokeStyle="rgba(220,228,233,0.5)";c.lineWidth=1.2;c.beginPath();let p=HOME();c.moveTo(X(p.x),Y(p.y));PLAN.wps.forEach(w=>{c.lineTo(X(w.x),Y(w.y))});c.lineTo(X(p.x),Y(p.y));c.stroke();c.setLineDash([]);
 // home
 c.fillStyle="#e8bf3a";c.fillRect(X(HOME().x)-5,Y(HOME().y)-5,10,10);c.font="11px "+getComputedStyle(document.body).getPropertyValue("--mono");c.fillText("home",X(HOME().x)+8,Y(HOME().y)+4);
 // trail
 if(S.trail.length>1){c.strokeStyle="#4f93e0";c.lineWidth=1.6;c.beginPath();S.trail.forEach((q,i)=>i?c.lineTo(X(q[0]),Y(q[1])):c.moveTo(X(q[0]),Y(q[1])));c.stroke()}
 // current footprint
 const f=footOf(S.z),vert=PLAN.vertical,fw=vert?f.w:f.l,fh=vert?f.l:f.w;
 if(S.z>1){c.strokeStyle="rgba(255,255,255,0.85)";c.lineWidth=1.2;c.strokeRect(X(S.x-fw/2),Y(S.y-fh/2),fw*SC,fh*SC)}
 // drone
 const dx=X(S.x),dy=Y(S.y);c.save();c.translate(dx,dy);c.rotate(S.yaw);const a=9,r=4.5;c.strokeStyle="#cfd8de";c.lineWidth=2;c.beginPath();c.moveTo(-a,-a);c.lineTo(a,a);c.moveTo(a,-a);c.lineTo(-a,a);c.stroke();
 [[-a,-a],[a,-a],[a,a],[-a,a]].forEach(q=>{c.fillStyle="#26323a";c.strokeStyle="#cfd8de";c.beginPath();c.arc(q[0],q[1],r,0,6.2832);c.fill();c.stroke()});c.fillStyle="#f26a2e";c.beginPath();c.moveTo(0,-8);c.lineTo(4,0);c.lineTo(-4,0);c.fill();c.restore();
 if(S.z>1){c.fillStyle="rgba(8,12,14,.8)";c.font="11px "+getComputedStyle(document.body).getPropertyValue("--mono");const t=S.z.toFixed(0)+" m";c.fillRect(dx+12,dy-18,c.measureText(t).width+8,15);c.fillStyle="#dce4e9";c.fillText(t,dx+16,dy-7)}
 // wind arrow
 const th=(C.wdir+180)*D2R,wx=Math.sin(th),wy=-Math.cos(th),bx=cw-44,by=36;c.strokeStyle="#6aa8f0";c.fillStyle="#6aa8f0";c.lineWidth=2;c.beginPath();c.moveTo(bx-wx*16,by-wy*16);c.lineTo(bx+wx*16,by+wy*16);c.stroke();c.beginPath();c.moveTo(bx+wx*16,by+wy*16);c.lineTo(bx+wx*8-wy*6,by+wy*8+wx*6);c.lineTo(bx+wx*8+wy*6,by+wy*8-wx*6);c.fill();
 c.fillStyle="#8a99a4";c.font="11px "+getComputedStyle(document.body).getPropertyValue("--mono");c.textAlign="center";c.fillText("wind "+C.wind.toFixed(1)+" m/s",bx,by+30);c.textAlign="left";
 if(S.phase==="idle"){c.fillStyle="rgba(8,12,14,.85)";c.fillRect(10,10,260,22);c.fillStyle="#dce4e9";c.fillText("Start simulation to fly the plan",16,25)}
}
const PH={idle:"Ready on the ground",fly:"Survey",rth:"Returning home",landing:"Landing",landed:"Landed",done:"Mission complete"};
function cards(){const soc=S.E/C.energy*100,V=C.vnom*(.842+.263*Math.pow(Math.max(0,soc/100),0.8)),cov=covPct(),rms=S.ctn?Math.sqrt(S.ct2/S.ctn):0;
 const rows=[["State",PH[S.phase]+(S.phase==="fly"&&S.route[S.wp]?" · "+({takeoff:"climb",transit:"to first lane",lane0:"to lane start",lane:"on lane"}[S.route[S.wp].type]||""):""),""],["Altitude",S.z.toFixed(1),"m"],["Ground speed",S.gs.toFixed(1),"m/s"],["Battery",soc.toFixed(1),"% · "+V.toFixed(1)+" V"],["Power",S.P.toFixed(0),"W"],["Captures",CAPS.length,"coverage "+cov.toFixed(0)+" %"],["Track error",rms.toFixed(2),"m RMS on lanes"],["Flight time",fmtT(S.t),"of ~"+fmtT(PLAN.T)+" planned"]];
 $("cards").innerHTML=rows.map(r=>`<div class="card"><div class="eyebrow">${r[0]}</div><div class="v"${r[0]==="State"?' style="font-size:16px;white-space:normal"':""}>${r[1]}${r[0]!=="State"&&r[2]&&r[0]!=="Battery"&&r[0]!=="Captures"&&r[0]!=="Track error"&&r[0]!=="Flight time"?`<small>${r[2]}</small>`:""}</div>${["Battery","Captures","Track error","Flight time"].includes(r[0])?`<div class="s">${r[2]}</div>`:""}</div>`).join("");
 chart()}
function chart(){const c=chx,w=chc.clientWidth,h=200;c.clearRect(0,0,w,h);const L=46,R=40,T=8,B=22,pw=w-L-R,ph=h-T-B;c.fillStyle="#0d1215";c.fillRect(L,T,pw,ph);
 const t1=S.t,t0=Math.max(0,t1-180);c.font="11px "+getComputedStyle(document.body).getPropertyValue("--mono");c.fillStyle="#5a6872";c.strokeStyle="#212c33";
 for(let i=0;i<=4;i++){const y=T+ph*i/4;c.beginPath();c.moveTo(L,y);c.lineTo(L+pw,y);c.stroke();c.textAlign="right";c.fillText(Math.round(400*(1-i/4))+" W",L-5,y+4);c.textAlign="left";c.fillText(Math.round(100*(1-i/4))+"%",L+pw+5,y+4)}
 const pts=HIST.filter(q=>q[0]>=t0);const xs=t=>L+pw*(t-t0)/Math.max(30,t1-t0);
 const line=(k,col,mx2)=>{if(pts.length<2)return;c.strokeStyle=col;c.lineWidth=1.8;c.beginPath();pts.forEach((q,i)=>{const x=xs(q[0]),y=T+ph*(1-clamp(q[k]/mx2,0,1));i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()};
 line(1,"#f26a2e",400);line(2,"#3cc06a",100);c.fillStyle="#5a6872";c.textAlign="center";c.fillText("time (s) — right edge is now",L+pw/2,h-4)}
function renderTable(){$("bMission").disabled=!S.t;if(renderedTableCount===CAPS.length)return;renderedTableCount=CAPS.length;const th=`<tr><th>#</th><th>t (s)</th><th>x (m)</th><th>y (m)</th><th>alt (m)</th><th>speed</th><th>batt %</th><th>footprint (m)</th><th>data in footprint</th><th>${MAP.sourceFile?"preview luminance":MAP===MAPS.cherry?"mean NDVI":MAP===MAPS.field?"canopy cover":"frame NDVI"}</th></tr>`;$("tbl").tHead.innerHTML=th;
 const rows=CAPS.slice(-14).reverse().map(r=>`<tr><td>${r.id}</td><td>${r.t}</td><td>${r.x}</td><td>${r.y}</td><td>${r.alt}</td><td>${r.spd}</td><td>${r.bat}</td><td>${r.fw}×${r.fh}</td><td>${(r.valid*100).toFixed(0)} %${r.frame?" · "+r.frame:""}</td><td>${r.mval===""?"–":r.mval}</td></tr>`).join("");
 $("tbl").tBodies[0].innerHTML=rows||'<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:26px">No captures yet. Start the simulation.</td></tr>';$("dSub").textContent=CAPS.length+" captures"+(CAPS.length>14?" · last 14 shown":"");
 ["bCsv","bGeo","bCopy"].forEach(i=>$(i).disabled=!CAPS.length)}
const legacyCsvText=()=>{const h=["id","t_s","x_m","y_m","alt_m","yaw_deg","gnss_x_m","gnss_y_m","ground_speed_ms","battery_pct","footprint_w_m","footprint_l_m","gsd_cm","data_fraction","metric","value","frame"];return[h.join(","),...CAPS.map(r=>[r.id,r.t,r.x,r.y,r.alt,r.yaw,r.gx,r.gy,r.spd,r.bat,r.fw,r.fh,r.gsd,r.valid,r.mname,r.mval,r.frame].join(","))].join("\n")};
const legacyGeoText=()=>JSON.stringify({type:"FeatureCollection",name:"drone_scout_captures",crs_note:"local map metres: x right, y down, origin at the map's top-left corner; not a geographic CRS",features:CAPS.map(r=>({type:"Feature",properties:{id:r.id,t_s:r.t,alt_m:r.alt,yaw_deg:r.yaw,ground_speed_ms:r.spd,battery_pct:r.bat,gsd_cm:r.gsd,data_fraction:r.valid,metric:r.mname,value:r.mval===""?null:r.mval,frame:r.frame||null,map:MAP.name,source:"simulated aircraft over real imagery"},geometry:{type:"Polygon",coordinates:[[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1],[r.x0,r.y0]].map(q=>q.map(v=>+v.toFixed(2)))]}}))},null,1);
function dl(name,text,type){try{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){}$("txtWrap").style.display="block";$("txt").value=text.length>200000?text.slice(0,200000):text}
$("bCsv").onclick=()=>dl("captures.csv",csvText(),"text/csv");$("bGeo").onclick=()=>dl("footprints-local.json",geoText(),"application/json");$("bCopy").onclick=()=>{$("txtWrap").style.display="block";$("txt").value=csvText();$("txt").select()};
function updateButtons(){$("bRth").disabled=S.phase!=="fly";$("bMission").disabled=!S.t;$("bStart").disabled=S.phase!=="idle";$("bPause").disabled=!["fly","rth","landing"].includes(S.phase);$("bPause").textContent=paused?"Resume":"Pause";$("bSwap").disabled=!(S.phase==="landed"&&S.resume)}
let paused=false,warp=1,last=0,acc=0,domT=0;
$("bStart").onclick=()=>{startMission();paused=false;updateButtons()};$("bPause").onclick=()=>{paused=!paused;updateButtons()};$("bReset").onclick=()=>{paused=false;resetMission()};$("bSwap").onclick=()=>{swapBattery();paused=false};$("bDef").onclick=()=>{Object.assign(C,DEF);derive();resetMission()};
$("warp").onclick=e=>{const b=e.target.closest("button");if(!b)return;warp=+b.dataset.w;[...$("warp").children].forEach(x=>x.setAttribute("aria-pressed",String(x===b)))};
$("maps").onclick=e=>{const b=e.target.closest("button");if(!b||!MAPS[b.dataset.m])return;setMap(b.dataset.m)};
function setMap(k){MAP=MAPS[k];AOI=null;REV=null;[...$("maps").children].forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.m===k)));$("summary").innerHTML=["What this map is","What is real","What to know"].map((h,i)=>`<div><h3>${h}</h3><p>${MAP.sum[i]}</p></div>`).join("");$("mapSub").textContent=MAP.sub;
 $("legend").innerHTML=(k==="library"?'<span>Historical preview · assumed scale · luminance metric</span>':k==="cherry"?'<span><i style="background:#3cc06a"></i>NDVI ≥ 0.80</span><span><i style="background:#e8bf3a"></i>0.70–0.80</span><span><i style="background:#d92b45"></i>&lt; 0.70 or bare ground</span>':k==="field"?'<span><i style="background:#3cc06a"></i>Captured area (real orthophoto)</span>':'<span><i style="border:1px solid #8a99a4"></i>Real frame (assumed 12 × 12 m)</span>')+'<span><i style="border:1px solid #fff"></i>Camera footprint now</span><span><i style="background:#4f93e0"></i>Flown path</span><span><i style="background:#e8bf3a"></i>Home</span><span>Dashed line: planned route. Dim image: not yet captured.</span>';
 paused=false;size();resetMission()}
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;if(!paused&&S&&MAP&&["fly","rth","landing"].includes(S.phase)){acc+=dt*warp;let n=0;while(acc>=DT&&n<800){step(DT);acc-=DT;n++}if(acc>DT*800)acc=0}
 if(MAP&&S){draw();drawAircraft();drawSurvey();domT+=dt;if(domT>0.25){domT=0;cards();renderTable();if(["landed","done"].includes(S.phase))updateButtons()}}requestAnimationFrame(frame)}
addEventListener("resize",()=>{size();draw()});
let TELEMETRY=[],runStarted=null,areaMode=false,drag=null,renderedTableCount=-1;
const notice=text=>$("notice").textContent=text;
function inSurvey(x,y){return !AOI||(x>=AOI.x&&x<=AOI.x+AOI.W&&y>=AOI.y&&y<=AOI.y+AOI.H)}
function normalizeConfig(){C.vtr=Math.min(C.vtr,C.vmax);C.crit=Math.min(C.crit,C.rthres-1);C.start=Math.max(C.start,C.rthres+5)}
function recordTelemetry(){TELEMETRY.push({t_s:+S.t.toFixed(2),x_m:+S.x.toFixed(3),y_m:+S.y.toFixed(3),alt_m:+S.z.toFixed(3),ground_speed_ms:+S.gs.toFixed(3),air_speed_ms:+S.vair.toFixed(3),vertical_speed_ms:+S.vz.toFixed(3),yaw_deg:+((S.yaw/D2R+360)%360).toFixed(2),roll_deg:+((S.roll||0)/D2R).toFixed(2),pitch_deg:+((S.pitch||0)/D2R).toFixed(2),battery_pct:+(S.E/C.energy*100).toFixed(3),power_w:+S.P.toFixed(3),phase:S.phase,waypoint:S.wp,captures:CAPS.length})}
function configObject(){return{schema:"drone-scout-config-v1",profile:"P4 Multispectral reference / custom simulation",source:"https://ag.dji.com/p4-multispectral/specs",values:{...C}}}
function missionObject(){return{schema:"drone-scout-mission-v1",mode:"simulation",started_at:runStarted,exported_at:new Date().toISOString(),map:{name:MAP.name,source_file:MAP.sourceFile||null,scale_assumed:!!MAP.assumedScale,width_m:MAP.W,height_m:MAP.H,provenance:MAP.sum,coordinate_system:"local metric image coordinates; x right, y down; geographic location and orientation not established",survey_area:AOI||{x:0,y:0,W:MAP.W,H:MAP.H}},config:configObject(),model:{integrator_dt_s:DT,description:"Point-mass quadrotor with velocity response, acceleration limits, wind, GNSS noise and empirical energy model",limitations:["Not a validated autopilot or six-degree-of-freedom aerodynamic model","Captures sample historical imagery; no new physical observations","Rectangular footprint aligned to planned survey lanes; terrain, lens distortion and tilt not modelled","Coverage is a 0.5 m grid estimate; aircraft view is illustrative"]},planned_waypoints:PLAN.wps,summary:{state:S.phase,duration_s:S.t,captures:CAPS.length,coverage_pct:covPct(),battery_remaining_pct:S.E/C.energy*100},telemetry:TELEMETRY,captures:CAPS.map(r=>({...r,source:"simulated capture over supplied imagery"})),data_use:{historical_imagery:"map pixels and the metric value (canopy cover, NDVI or relative NDVI) sampled at each capture from the supplied processed derivative of "+MAP.name,simulated:"all telemetry, camera trigger times, footprint size and battery; no physical-drone data",not_used:"CoFly, Embrapa apples, CADI cashew, cherry ground photos, TreeMapping.xlsx, blueberry archive"}}}
const csvText=()=>{const base=legacyCsvText().split("\n");return base.map((line,i)=>i?`${line},simulation,${JSON.stringify(MAP.name)},simulated,historical imagery sample`:line+",mode,map,telemetry_source,metric_source").join("\n")};
const geoText=()=>JSON.stringify({schema:"drone-scout-local-footprints-v1",mode:"simulation",coordinate_system:"Local map metres; not WGS84 or geographic GeoJSON",map:MAP.name,footprints:CAPS.map(r=>({id:r.id,t_s:r.t,metric:r.mname,value:r.mval===""?null:r.mval,data_fraction:r.valid,ring_m:[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1],[r.x0,r.y0]]}))},null,2);
$("bConfig").onclick=()=>dl("drone-configuration.json",JSON.stringify(configObject(),null,2),"application/json");
$("bMission").onclick=()=>dl("drone-mission.json",JSON.stringify(missionObject(),null,2),"application/json");
$("importConfig").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{
 if(f.size>100000)throw Error("Configuration file is too large");
 const data=JSON.parse(await f.text());if(data.schema!=="drone-scout-config-v1")throw Error("Choose a Drone Scout configuration file");
 const values=data.values;if(!values||typeof values!=="object")throw Error("Missing configuration values");
 const next={...DEF};for(const p of GROUPS.flatMap(g=>g.p)){const [k,,,,,o]=p;if(o.ro)continue;
 const v=values[k];if(typeof v!=="number"||!Number.isFinite(v))throw Error("Invalid value for "+k);
 if(o.sel?!o.sel.some(q=>+q[0]===v):v<o.min||v>o.max)throw Error("Out-of-range value for "+k);next[k]=v}
 Object.assign(C,next);normalizeConfig();resetMission();notice("Configuration loaded. Simulation reset.");
 }catch(err){notice(err.message)}e.target.value=""};
$("bRth").onclick=()=>{if(S.phase!=="fly")return;paused=false;S.route0=S.route;startRTH("Operator requested return home");updateButtons()};
$("bArea").onclick=()=>{if(!MAP)return;areaMode=!areaMode;$("bArea").classList.toggle("active",areaMode);mc.style.cursor=areaMode?"crosshair":"default";notice(areaMode?"Drag a rectangle inside the map. Selecting an area resets the current run.":"Area selection cancelled.")};
$("bFull").onclick=()=>{if(!MAP)return;AOI=null;resetMission();notice("Full map selected. Simulation reset.")};
function mapPoint(e){const r=mc.getBoundingClientRect(),ox=(cw-(MAP.W+2*VIEWM)*SC)/2;return{x:clamp((e.clientX-r.left-ox)/SC-VIEWM,0,MAP.W),y:clamp((e.clientY-r.top)/SC-VIEWM,0,MAP.H)}}
mc.addEventListener("pointerdown",e=>{if(!areaMode||!MAP)return;paused=true;updateButtons();drag={start:mapPoint(e),end:mapPoint(e)};mc.setPointerCapture(e.pointerId)});
mc.addEventListener("pointermove",e=>{if(drag)drag.end=mapPoint(e)});
mc.addEventListener("pointerup",e=>{if(!drag)return;const a=drag.start,b=mapPoint(e),W=Math.abs(b.x-a.x),H=Math.abs(b.y-a.y);drag=null;
 if(W<3||H<3){notice("Choose an area at least 3 × 3 m. The current flight is paused.");return}
 AOI={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),W,H};areaMode=false;$("bArea").classList.remove("active");mc.style.cursor="default";resetMission();notice(`Survey area created: ${W.toFixed(1)} × ${H.toFixed(1)} m. Ready to fly.`)});
mc.addEventListener("pointercancel",()=>{drag=null});
function drawSurvey(){const a=drag?{x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),W:Math.abs(drag.start.x-drag.end.x),H:Math.abs(drag.start.y-drag.end.y)}:AOI;
 const area=AOI||{W:MAP.W,H:MAP.H};$("areaLabel").textContent=`${area.W.toFixed(1)} × ${area.H.toFixed(1)} m · ${(area.W*area.H/10000).toFixed(3)} ha · local map`;
 if(!a)return;const ox=(cw-(MAP.W+2*VIEWM)*SC)/2;mx.save();mx.strokeStyle="#f7ac63";mx.lineWidth=2;mx.setLineDash([7,4]);mx.strokeRect(ox+(a.x+VIEWM)*SC,(a.y+VIEWM)*SC,a.W*SC,a.H*SC);mx.restore()}
// Canvas projection of an illustrative quadcopter. Dimensions follow the 350 mm diagonal reference;
// rendering is deliberately enlarged. Modelled acceleration determines attitude, never sensor claims.
function drawAircraft(){
 const canvas=$("aircraft"),w=canvas.clientWidth,h=260,ratio=Math.min(2,devicePixelRatio||1);
 if(canvas.width!==Math.round(w*ratio)){canvas.width=Math.round(w*ratio);canvas.height=h*ratio}
 const c=canvas.getContext("2d");c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,w,h);
 const airborne=S.z>.1,roll=S.roll||0,pitch=S.pitch||0,yaw=S.yaw-.5,scale=Math.min(w*.65,240);
 function project(x,y,z=0,att=true){if(att){let xx=x*Math.cos(roll)+z*Math.sin(roll),zz=-x*Math.sin(roll)+z*Math.cos(roll);x=xx;z=zz;let yy=y*Math.cos(pitch)-z*Math.sin(pitch);z=y*Math.sin(pitch)+z*Math.cos(pitch);y=yy;xx=x*Math.cos(yaw)-y*Math.sin(yaw);y=x*Math.sin(yaw)+y*Math.cos(yaw);x=xx}return[w/2+(x-y*.55)*scale,h*.5+(y*.48+x*.2-z)*scale]}
 function path(points,color,width=1,fill=false){c.beginPath();points.forEach((q,i)=>{const p=project(...q);i?c.lineTo(...p):c.moveTo(...p)});c.strokeStyle=color;c.lineWidth=width;c.lineJoin="round";if(fill){c.closePath();c.fillStyle=color;c.fill()}else c.stroke()}
 // Ground reference grid and altitude tether.
 c.strokeStyle="#263846";c.lineWidth=.7;for(let i=-3;i<=3;i++){const x=w/2+i*48;c.beginPath();c.moveTo(x-85,214);c.lineTo(x+80,168);c.stroke();c.beginPath();c.moveTo(x-80,168);c.lineTo(x+85,214);c.stroke()}
 c.fillStyle="#0005";c.beginPath();c.ellipse(w/2,192,70,14,0,0,Math.PI*2);c.fill();
 const arms=[[-.25,-.25],[.25,-.25],[.25,.25],[-.25,.25]];
 // Landing gear.
 for(const x of [-.10,.10])path([[x,-.11,-.04],[x,-.11,-.19],[x,.15,-.19],[x,.15,-.04]],"#9cabb6",5);
 arms.forEach(([x,y])=>{path([[0,0,0],[x,y,.025]],"#9eafb9",14);path([[0,0,.01],[x,y,.04]],"#e3ebee",7)});
 path([[-.10,-.15,.025],[.10,-.15,.025],[.11,.11,.025],[-.11,.11,.025]],"#9cabb8",1,true);
 path([[-.09,-.14,.065],[.09,-.14,.065],[.10,.10,.065],[-.10,.10,.065]],"#edf2f2",1,true);
 path([[-.06,-.135,.07],[.06,-.135,.07]],"#ee8047",5);
 const top=project(0,.015,.095);c.fillStyle="#f4f7f8";c.beginPath();c.ellipse(top[0],top[1],11,5,0,0,Math.PI*2);c.fill();
 arms.forEach(([x,y],i)=>{const p=project(x,y,.05);c.fillStyle="#263e4c";c.beginPath();c.ellipse(p[0],p[1],8,5,0,0,Math.PI*2);c.fill();
 const spin=airborne&&!paused?S.t*28*(i%2?1:-1):i*.8,r=.145;
 const ring=[];for(let a=0;a<=Math.PI*2+.1;a+=.15)ring.push([x+Math.cos(a)*r,y+Math.sin(a)*r,.075]);path(ring,airborne?"#9fd0e039":"#a4b4bd59",1.3);
 path([[x+Math.cos(spin)*r,y+Math.sin(spin)*r,.075],[x-Math.cos(spin)*r,y-Math.sin(spin)*r,.075]],"#dce8ee",3);
 c.fillStyle=i<2?"#f59266":"#6de6b0";c.beginPath();c.arc(p[0],p[1]+5,2,0,Math.PI*2);c.fill()});
 // Six sensor lenses under the fuselage.
 const camera=project(0,-.06,-.12);c.fillStyle="#465663";c.fillRect(camera[0]-17,camera[1]-9,34,20);
 for(let i=0;i<6;i++){c.fillStyle=["#aac7d1","#4f99e8","#68bf77","#ee786f","#c780dc","#a18ade"][i];c.beginPath();c.arc(camera[0]-10+(i%3)*10,camera[1]-4+Math.floor(i/3)*9,3,0,Math.PI*2);c.fill()}
 c.font="10px ui-monospace,monospace";c.fillStyle="#88a0af";c.fillText("350 mm reference diagonal",14,22);c.fillStyle=airborne?"#78d9b0":"#b5c7d0";c.fillText(paused?"SIM PAUSED":airborne?"SIM AIRBORNE":"SIM GROUNDED",14,h-18);
 c.textAlign="right";c.fillStyle="#9bafbd";c.fillText(`${S.z.toFixed(1)} m AGL`,w-14,h-18);c.textAlign="left";
 $("attitude").textContent=`ROLL ${(roll/D2R).toFixed(1)}°   PITCH ${(pitch/D2R).toFixed(1)}°   YAW ${((S.yaw/D2R+360)%360).toFixed(0)}°`;
}
// Pause when backgrounded instead of presenting skipped wall time as live flight.
document.addEventListener("visibilitychange",()=>{if(document.hidden&&S&&["fly","rth","landing"].includes(S.phase)){paused=true;updateButtons();notice("Simulation paused while the tab is hidden. Resume to continue.")}});

/* DATA_LIBRARY_SURVEY_BRIDGE */
window.DroneLibraryPause=()=>{if(S&&['fly','rth','landing'].includes(S.phase)){paused=true;updateButtons();notice('Simulation paused while browsing the library. Resume when ready.')}};

window.DroneLibraryFly=async({item,image,width})=>{
 if(!MAP)throw Error('The flight maps are still loading. Try again after they are ready.');
 const aspect=image.height/image.width,can=document.createElement('canvas');can.width=image.width;can.height=image.height;
 const ctx=can.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,can.width,can.height).data;
 const W=width,H=width*aspect;
 const mean=(x0,y0,x1,y1)=>{const a=Math.max(0,Math.floor(x0/W*can.width)),b=Math.min(can.width,Math.ceil(x1/W*can.width)),c=Math.max(0,Math.floor(y0/H*can.height)),d=Math.min(can.height,Math.ceil(y1/H*can.height));let sum=0,n=0;for(let y=c;y<d;y++)for(let x=a;x<b;x++){const k=(y*can.width+x)*4;sum+=(.2126*pixels[k]+.7152*pixels[k+1]+.0722*pixels[k+2])/255;n++}const inside=Math.max(0,Math.min(x1,W)-Math.max(0,x0))*Math.max(0,Math.min(y1,H)-Math.max(0,y0));return{valid:inside/((x1-x0)*(y1-y0)),name:'preview_luminance_0_1',value:n?sum/n:null}};
 MAPS.library={name:'Library: '+item.path,W,H,base:image,layer:image,sourceFile:item.path,assumedScale:true,real:'Historical image preview with assumed ground dimensions',valid:()=>1,sample:mean,sub:item.name+' · assumed '+W.toFixed(1)+' × '+H.toFixed(1)+' m · preview luminance',sum:['Historical image preview: '+item.path,'Ground width entered by the operator. Local image coordinates only; no verified geographic placement.','Capture values are mean display-preview luminance (0–1), not calibrated spectral values. Source dimensions: '+item.width+' × '+item.height+'.']};
 let b=document.querySelector('[data-m="library"]');if(!b){b=document.createElement('button');b.type='button';b.dataset.m='library';$('maps').appendChild(b)}b.textContent='Selected library image';setMap('library');notice('Library image selected with an assumed scale. Start the simulation to sample preview brightness.');
};

(async()=>{try{buildCfg();await buildMaps();MAP=MAPS.field;REV=null;size();setMap("field");notice("Ready. Choose a map, draw a survey area, then start the simulation.");requestAnimationFrame(frame)}catch(e){notice("Map loading failed: "+e.message);console.error(e)}})();
