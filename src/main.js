import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const gameEl = document.querySelector('#game');
const boot = document.querySelector('#boot');
const startBtn = document.querySelector('#startBtn');
const loadLine = document.querySelector('#loadLine');
const loadBar = document.querySelector('#loadBar');
const hud = document.querySelector('#hud');
const mobileControls = document.querySelector('#mobileControls');
const camModeEl = document.querySelector('#camMode');
const biomassEl = document.querySelector('#biomass');
const crewCountEl = document.querySelector('#crewCount');
const statusEl = document.querySelector('#status');
const messageEl = document.querySelector('#message');
const fatal = document.querySelector('#fatal');
const fatalText = document.querySelector('#fatalText');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1015);
// Keep the horror mood without crushing the interior into black on mobile displays.
scene.fog = new THREE.FogExp2(0x10161c, 0.018);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 160);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.45 : 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.38;
gameEl.append(renderer.domElement);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const up = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpBox = new THREE.Box3();

const world = {
  mixers: [],
  colliders: [],
  occluders: [],
  npcs: [],
  biomass: 0,
  alertTimer: 0,
  started: false,
  cameraMode: 'third',
};

const input = {
  f: 0, r: 0,
  forward: false, back: false, left: false, right: false,
  sprint: false, crouch: false,
  yaw: Math.PI,
  pitch: -0.08,
  attackQueued: false,
};

const player = {
  root: new THREE.Group(),
  model: null,
  mixer: null,
  radius: 0.42,
  height: 1.35,
  eye: 1.05,
  speed: 3.15,
  sprintSpeed: 5.8,
  crouchSpeed: 1.75,
};
player.root.position.set(0, 0, 13.5);
scene.add(player.root);

const mat = {
  floor: new THREE.MeshStandardMaterial({ color: 0x171c21, roughness: 0.78, metalness: 0.48 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x242a2e, roughness: 0.7, metalness: 0.58 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c1013, roughness: 0.8, metalness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0x541b18, emissive: 0x2a0503, emissiveIntensity: 1.0, roughness: 0.55, metalness: 0.45 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x17262b, emissive: 0x092027, emissiveIntensity: 0.5, roughness: 0.14, metalness: 0.2, transparent: true, opacity: 0.48 }),
};

let specimenLight = null;

function addAmbientLighting() {
  // Cheap global fill is intentional: iPhone/Safari was rendering the original
  // horror lighting almost completely black. Local red lights still preserve mood.
  scene.add(new THREE.AmbientLight(0x8fa8b8, 0.72));
  scene.add(new THREE.HemisphereLight(0xa8c4d1, 0x2c1712, 1.05));

  const key = new THREE.DirectionalLight(0xd9eef4, 1.65);
  key.position.set(8, 13, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -24; key.shadow.camera.right = 24;
  key.shadow.camera.top = 24; key.shadow.camera.bottom = -24;
  scene.add(key);

  // Readable work lights in each wing. These do not cast shadows, keeping the
  // extra lighting inexpensive for the browser prototype.
  for (const [x,z] of [[0,0],[-12,0],[12,0],[0,-12.5],[0,12.5]]) {
    const work = new THREE.PointLight(0xb9dce6, 2.15, 11, 1.55);
    work.position.set(x, 2.55, z);
    scene.add(work);
  }

  // Red emergency accents remain visible without being the only illumination.
  for (const [x,z] of [[-5.2,0],[5.2,0],[0,-7],[0,7]]) {
    const p = new THREE.PointLight(0xff493d, 1.75, 8, 2.0);
    p.position.set(x, 2.45, z);
    scene.add(p);
  }

  // A subtle specimen/head light keeps nearby geometry readable in both FP/TP.
  specimenLight = new THREE.PointLight(0xcdefff, 1.6, 6.5, 1.7);
  specimenLight.position.set(0, 1.0, 0);
  player.root.add(specimenLight);
}

function box(size, pos, material, collidable = false, name = '') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  scene.add(mesh);
  if (collidable) addCollider(mesh);
  return mesh;
}

function addCollider(mesh) {
  mesh.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(mesh);
  world.colliders.push(b);
  world.occluders.push(mesh);
}

function room(cx, cz, w, d, label, openings = {}) {
  const wallH = 3.2, thick = 0.24;
  box([w, 0.18, d], [cx, -0.09, cz], mat.floor, false, `${label}-floor`);
  const edge = {
    n: [cx, wallH/2, cz-d/2], s:[cx,wallH/2,cz+d/2],
    w:[cx-w/2,wallH/2,cz], e:[cx+w/2,wallH/2,cz]
  };
  const makeWall = (side, horizontal) => {
    const opening = openings[side];
    const len = horizontal ? w : d;
    if (!opening) {
      box(horizontal?[len,wallH,thick]:[thick,wallH,len], edge[side], mat.wall, true, `${label}-${side}`);
      return;
    }
    const gap = opening.width || 2.6;
    const part = (len-gap)/2;
    if (part <= 0.05) return;
    if (horizontal) {
      box([part,wallH,thick],[edge[side][0]-(gap+part)/2,wallH/2,edge[side][2]],mat.wall,true);
      box([part,wallH,thick],[edge[side][0]+(gap+part)/2,wallH/2,edge[side][2]],mat.wall,true);
    } else {
      box([thick,wallH,part],[edge[side][0],wallH/2,edge[side][2]-(gap+part)/2],mat.wall,true);
      box([thick,wallH,part],[edge[side][0],wallH/2,edge[side][2]+(gap+part)/2],mat.wall,true);
    }
  };
  makeWall('n',true); makeWall('s',true); makeWall('w',false); makeWall('e',false);
  // ceiling ribs instead of a full ceiling, to keep third-person camera readable
  for (let x=cx-w/2+1; x<cx+w/2; x+=2.4) box([0.08,0.1,d-.5],[x,3.05,cz],mat.dark,false);
}

function buildBase() {
  // Operations hub + four believable wings, intentionally compact for v0.0.1.
  room(0, 0, 12, 11, 'OPS', {n:{width:3},s:{width:3},e:{width:3},w:{width:3}});
  room(0, 12.5, 6, 14, 'CONTAINMENT', {n:{width:2.5},s:{width:3}});
  room(-12.5, 0, 14, 6, 'MEDLAB', {e:{width:3}});
  room(12.5, 0, 14, 6, 'MAINT', {w:{width:3}});
  room(0, -12.5, 6, 14, 'AIRLOCK', {n:{width:3},s:{width:2.5}});

  // corridors
  box([3,0.14,3],[0,-0.07,6.9],mat.floor,false);
  box([3,0.14,3],[0,-0.07,-6.9],mat.floor,false);
  box([3,0.14,3],[-6.9,-0.07,0],mat.floor,false);
  box([3,0.14,3],[6.9,-0.07,0],mat.floor,false);

  // containment glass & lab consoles
  box([5.2,1.6,.08],[0,.82,16.9],mat.glass,false,'containment-glass');
  box([2.6,.85,.8],[-10.2,.42,-1.5],mat.dark,true,'lab-console');
  box([2.2,.85,.8],[10.3,.42,1.5],mat.dark,true,'maintenance-console');
  box([1.2,1.25,1.2],[2.7,.62,12.7],mat.red,true,'containment-generator');

  // signage / emissive strips
  for (const [x,z] of [[-5.2,0],[5.2,0],[0,-5],[0,5],[0,10.4],[0,-10.4]]) {
    const s=box([.6,.05,.1],[x,2.4,z],mat.red,false);
    if (Math.abs(x)>1) s.rotation.z=Math.PI/2;
  }

  // Mars window at airlock end
  const marsMat = new THREE.MeshStandardMaterial({color:0x7a2f1f,emissive:0x3d1008,emissiveIntensity:.8,roughness:1});
  box([5.1,2.25,.06],[0,1.3,-19.45],marsMat,false,'mars-window');
  const dust = new THREE.Mesh(new THREE.PlaneGeometry(24,12), new THREE.MeshBasicMaterial({color:0x32130d}));
  dust.rotation.x=-Math.PI/2; dust.position.set(0,-.16,-25); scene.add(dust);
}

function normalizeModel(object, targetHeight, rotation = [0,0,0]) {
  object.rotation.set(...rotation);
  object.updateMatrixWorld(true);
  let b = new THREE.Box3().setFromObject(object);
  const size = b.getSize(new THREE.Vector3());
  const vertical = Math.max(size.y, 0.001);
  const s = targetHeight / vertical;
  object.scale.setScalar(s);
  object.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(object);
  const center = b.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= b.min.y;
  object.updateMatrixWorld(true);
  return object;
}

async function loadGLB(url) {
  return await new Promise((resolve, reject)=>loader.load(url, resolve, undefined, reject));
}

async function loadEnvironment() {
  const gltf = await loadGLB('./assets/models/sci_fi_ship_interior.glb');
  const interior = gltf.scene;
  // Normalize the extremely large authoring units to a ~17m-wide visual centerpiece.
  interior.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(interior);
  const size = b.getSize(new THREE.Vector3());
  const scale = 17 / Math.max(size.x, size.z);
  interior.scale.setScalar(scale);
  interior.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(interior);
  const c = b2.getCenter(new THREE.Vector3());
  interior.position.set(-c.x, -b2.min.y + .02, -c.z);
  interior.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  scene.add(interior);
}

async function loadMonster() {
  const gltf = await loadGLB('./assets/models/insectoid_monster.glb');
  const holder = new THREE.Group();
  holder.add(gltf.scene);
  normalizeModel(gltf.scene, 1.38, [0, Math.PI, 0]);
  gltf.scene.position.y -= .03;
  holder.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  player.root.add(holder);
  player.model = holder;
  player.mixer = new THREE.AnimationMixer(gltf.scene);
  world.mixers.push(player.mixer);
  const clip = gltf.animations.find(a=>a.name.toLowerCase().includes('prowl')) || gltf.animations[0];
  if (clip) player.mixer.clipAction(clip).play();
}

const npcDefs = [
  {id:'sophia', file:'sophia.glb', pos:[-10.8,0,-1.3], height:1.72, rot:[0,0,0], role:'SCIENCE', color:0x78d7df, clip:null, patrol:[[-10.8,-1.3],[-8.4,1.2],[-10.5,1.8]]},
  {id:'female', file:'female_character.glb', pos:[9.8,0,-1.2], height:1.68, rot:[-Math.PI/2,0,0], role:'ENGINEERING', color:0xe1ae62, clip:null, patrol:[[9.8,-1.2],[14.6,-1.4],[14.2,1.4]]},
  {id:'temari', file:'temari_prototype_only.glb', pos:[0,0,-10.7], height:1.70, rot:[0,Math.PI,0], role:'SECURITY', color:0xd16d66, clip:'Walk_Forward', patrol:[[0,-10.7],[0,-16.2],[1.4,-16.8],[-1.4,-16.8]]},
  {id:'worker', file:'female_worker.glb', pos:[12.2,0,1.2], height:1.68, rot:[0,Math.PI,0], role:'WORKER', color:0xe0a447, clip:null, patrol:null},
  {id:'street', file:'street_fighter_cosplay.glb', pos:[-11.1,0,1.45], height:1.15, rot:[0,Math.PI*.15,0], role:'RECOVERING', color:0xa79bdf, clip:null, patrol:null, static:true},
];

async function loadNPC(def) {
  const gltf = await loadGLB(`./assets/models/${def.file}`);
  const root = new THREE.Group();
  root.position.set(...def.pos);
  const model = gltf.scene;
  root.add(model);
  normalizeModel(model, def.height, def.rot);
  model.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(root);
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
  if (mixer) {
    world.mixers.push(mixer);
    const clip = (def.clip && gltf.animations.find(a=>a.name===def.clip)) || gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
  }
  const npc = { ...def, root, model, mixer, alive:true, state:'idle', wp:0, speed:def.id==='temari'?1.25:.82, alert:0, lastSeen:0 };
  world.npcs.push(npc);
  return npc;
}

function showMsg(text, ms=1500) {
  messageEl.textContent = text;
  messageEl.classList.add('show');
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(()=>messageEl.classList.remove('show'), ms);
}

function isBlocked(next) {
  const y = 0.8;
  const probe = tmpBox.setFromCenterAndSize(new THREE.Vector3(next.x,y,next.z), new THREE.Vector3(player.radius*1.7,1.5,player.radius*1.7));
  return world.colliders.some(b=>probe.intersectsBox(b));
}

function updatePlayer(dt) {
  const forward = (input.forward?1:0) - (input.back?1:0) + input.f;
  const right = (input.right?1:0) - (input.left?1:0) + input.r;
  const mag = Math.hypot(forward,right);
  if (mag > .02) {
    const f = Math.min(1,mag), a = Math.atan2(right, forward) + input.yaw;
    const dir = new THREE.Vector3(Math.sin(a),0,Math.cos(a));
    const speed = input.crouch ? player.crouchSpeed : input.sprint ? player.sprintSpeed : player.speed;
    const step = dir.multiplyScalar(speed*dt*f);
    const cur = player.root.position;
    const both = cur.clone().add(step);
    if (!isBlocked(both)) cur.copy(both);
    else {
      const xOnly = cur.clone().add(new THREE.Vector3(step.x,0,0)); if(!isBlocked(xOnly)) cur.copy(xOnly);
      const zOnly = cur.clone().add(new THREE.Vector3(0,0,step.z)); if(!isBlocked(zOnly)) cur.copy(zOnly);
    }
    player.root.rotation.y = input.yaw + Math.PI;
  }
  player.root.position.x = THREE.MathUtils.clamp(player.root.position.x,-20,20);
  player.root.position.z = THREE.MathUtils.clamp(player.root.position.z,-20,20);
}

function lineOfSight(a,b) {
  const dir = b.clone().sub(a); const dist=dir.length(); dir.normalize();
  raycaster.set(a,dir); raycaster.far=dist-.2;
  const hits=raycaster.intersectObjects(world.occluders,false);
  return hits.length===0;
}

function updateNPCs(dt, time) {
  let anyoneAlert=false;
  const p = player.root.position;
  for (const n of world.npcs) {
    if (!n.alive) continue;
    const np=n.root.position;
    const dist=np.distanceTo(p);
    const eye=np.clone().add(new THREE.Vector3(0,1.25,0));
    const pEye=p.clone().add(new THREE.Vector3(0,.8,0));
    let sees=false;
    if (dist<8.5 && lineOfSight(eye,pEye)) {
      const toP=p.clone().sub(np).setY(0).normalize();
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(n.root.quaternion).setY(0).normalize();
      const fov=n.id==='temari'?-.35:.05;
      sees=facing.dot(toP)>fov || dist<2.4;
    }
    if (sees) { n.alert=4; n.lastSeen=time; world.alertTimer=3.5; }
    n.alert=Math.max(0,n.alert-dt);
    if(n.alert>0){
      anyoneAlert=true; n.state='flee';
      if(!n.static){
        const away=np.clone().sub(p).setY(0);
        if(away.lengthSq()<.01) away.set(1,0,0);
        away.normalize();
        const target=np.clone().addScaledVector(away, n.id==='temari'?2.1:1.5*dt);
        const nx=np.x+away.x*(n.id==='temari'?2.4:1.8)*dt;
        const nz=np.z+away.z*(n.id==='temari'?2.4:1.8)*dt;
        n.root.position.x=THREE.MathUtils.clamp(nx,-18,18); n.root.position.z=THREE.MathUtils.clamp(nz,-18,18);
        n.root.rotation.y=Math.atan2(away.x,away.z);
      }
    } else if(n.patrol && !n.static){
      n.state='patrol';
      const [tx,tz]=n.patrol[n.wp];
      const d=tmpV.set(tx-np.x,0,tz-np.z);
      if(d.length()<.45) n.wp=(n.wp+1)%n.patrol.length;
      else { d.normalize(); n.root.position.addScaledVector(d,n.speed*dt); n.root.rotation.y=Math.atan2(d.x,d.z); }
    } else n.state='idle';
  }
  statusEl.textContent = anyoneAlert || world.alertTimer>0 ? 'DETECTED' : 'HIDDEN';
  statusEl.classList.toggle('alert', anyoneAlert || world.alertTimer>0);
  world.alertTimer=Math.max(0,world.alertTimer-dt);
}

function attack() {
  let best=null,bestD=Infinity;
  for(const n of world.npcs){ if(!n.alive)continue; const d=n.root.position.distanceTo(player.root.position); if(d<bestD){best=n;bestD=d;} }
  if(best && bestD<1.65){
    best.alive=false; best.state='down';
    best.root.traverse(o=>{if(o.isMesh&&o.material){ if(Array.isArray(o.material)) o.material.forEach(m=>m.transparent=true); else o.material.transparent=true; }});
    best.root.rotation.z = -Math.PI/2.25;
    best.root.position.y=.12;
    world.biomass++;
    biomassEl.textContent=world.biomass;
    crewCountEl.textContent=world.npcs.filter(n=>n.alive).length;
    world.alertTimer=5;
    for(const n of world.npcs) if(n.alive && n.root.position.distanceTo(best.root.position)<7) n.alert=4;
    showMsg(`BIOMASS ACQUIRED // ${best.role}`);
  } else showMsg('NO TARGET IN STRIKE RANGE', 700);
}

function updateCamera(dt) {
  const p=player.root.position;
  const crouchOffset=input.crouch?-.28:0;
  if(world.cameraMode==='first'){
    const eye=new THREE.Vector3(p.x,p.y+player.eye+crouchOffset,p.z);
    camera.position.lerp(eye,1-Math.exp(-18*dt));
    camera.rotation.order='YXZ';
    // Three.js cameras look down local -Z, while our movement heading uses +Z.
    // Add PI so first-person sight and forward movement point the same way.
    camera.rotation.y=input.yaw + Math.PI; camera.rotation.x=input.pitch; camera.rotation.z=0;
    if(player.model) player.model.visible=false;
  } else {
    if(player.model) player.model.visible=true;
    const target=new THREE.Vector3(p.x,p.y+.75+crouchOffset,p.z);
    const back=new THREE.Vector3(-Math.sin(input.yaw)*4.25,2.0-input.pitch*1.5,-Math.cos(input.yaw)*4.25);
    const desired=target.clone().add(back);
    camera.position.lerp(desired,1-Math.exp(-9*dt));
    camera.lookAt(target);
  }
}

function toggleCamera(){ world.cameraMode=world.cameraMode==='first'?'third':'first'; camModeEl.textContent=world.cameraMode==='first'?'FIRST PERSON':'THIRD PERSON'; }

function setupDesktopInput(){
  const setKey=(e,v)=>{
    const k=e.code;
    if(k==='KeyW')input.forward=v;if(k==='KeyS')input.back=v;if(k==='KeyA')input.left=v;if(k==='KeyD')input.right=v;if(k==='ShiftLeft'||k==='ShiftRight')input.sprint=v;if(k==='KeyC')input.crouch=v;
    if(v&&k==='KeyV')toggleCamera(); if(v&&k==='Space')attack();
  };
  addEventListener('keydown',e=>setKey(e,true));addEventListener('keyup',e=>setKey(e,false));
  renderer.domElement.addEventListener('click',()=>{ if(world.started && !IS_TOUCH) renderer.domElement.requestPointerLock?.(); });
  addEventListener('mousemove',e=>{if(document.pointerLockElement===renderer.domElement){ input.yaw-=e.movementX*.0023; input.pitch=THREE.MathUtils.clamp(input.pitch-e.movementY*.0019,-1.0,.72); }});
  addEventListener('mousedown',e=>{if(world.started&&document.pointerLockElement===renderer.domElement&&e.button===0)attack();});
}

function setupMobileInput(){
  if(!IS_TOUCH)return;
  mobileControls.classList.remove('hidden');
  const zone=document.querySelector('#joyZone'), knob=document.querySelector('#joyKnob');
  let joyId=null, center={x:0,y:0};
  zone.addEventListener('pointerdown',e=>{joyId=e.pointerId;zone.setPointerCapture(joyId);const r=zone.getBoundingClientRect();center={x:r.left+r.width/2,y:r.top+r.height/2};});
  zone.addEventListener('pointermove',e=>{if(e.pointerId!==joyId)return;let dx=e.clientX-center.x,dy=e.clientY-center.y;const max=39,l=Math.hypot(dx,dy)||1,s=Math.min(1,max/l);dx*=s;dy*=s;knob.style.transform=`translate(${dx}px,${dy}px)`;input.r=dx/max;input.f=-dy/max;});
  const endJoy=e=>{if(e.pointerId!==joyId)return;joyId=null;input.r=input.f=0;knob.style.transform='translate(0,0)';}; zone.addEventListener('pointerup',endJoy);zone.addEventListener('pointercancel',endJoy);
  const look=document.querySelector('#lookZone');let lookId=null,lx=0,ly=0;
  look.addEventListener('pointerdown',e=>{lookId=e.pointerId;lx=e.clientX;ly=e.clientY;look.setPointerCapture(lookId);});
  look.addEventListener('pointermove',e=>{if(e.pointerId!==lookId)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;input.yaw-=dx*.006;input.pitch=THREE.MathUtils.clamp(input.pitch-dy*.0048,-1.0,.72);});
  const endLook=e=>{if(e.pointerId===lookId)lookId=null};look.addEventListener('pointerup',endLook);look.addEventListener('pointercancel',endLook);
  const run=document.querySelector('#runBtn');run.addEventListener('pointerdown',()=>input.sprint=true);['pointerup','pointercancel','pointerleave'].forEach(t=>run.addEventListener(t,()=>input.sprint=false));
  document.querySelector('#attackBtn').addEventListener('pointerdown',attack);document.querySelector('#camBtn').addEventListener('pointerdown',toggleCamera);document.querySelector('#crouchBtn').addEventListener('pointerdown',()=>{input.crouch=!input.crouch});
}

function onResize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,IS_TOUCH?1.45:1.8));}
addEventListener('resize',onResize);

async function init(){
  try{
    addAmbientLighting(); buildBase();
    const jobs=[
      ['Loading operations interior…',loadEnvironment],['Awakening specimen…',loadMonster],
      ...npcDefs.map((d,i)=>[`Registering crew ${i+1}/${npcDefs.length}…`,()=>loadNPC(d)])
    ];
    for(let i=0;i<jobs.length;i++){
      loadLine.textContent=jobs[i][0]; loadBar.style.width=`${Math.round((i/jobs.length)*100)}%`;
      await jobs[i][1]();
    }
    loadBar.style.width='100%'; loadLine.textContent='Containment systems online.'; startBtn.disabled=false;
    setupDesktopInput(); setupMobileInput();
  }catch(err){ console.error(err); fatalText.textContent=String(err?.message||err); fatal.classList.add('show'); }
}

startBtn.addEventListener('click',()=>{
  boot.classList.remove('show'); hud.classList.remove('hidden'); if(IS_TOUCH)mobileControls.classList.remove('hidden'); world.started=true;
  showMsg('SPECIMEN CONTROL RESTORED',1300);
});

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.033);
  if(world.started){ updatePlayer(dt); updateNPCs(dt,clock.elapsedTime); if(input.attackQueued){attack();input.attackQueued=false;} }
  for(const m of world.mixers)m.update(dt);
  updateCamera(dt);
  renderer.render(scene,camera);
}

init(); animate();
