/**
 * Tiny canvas raster map. No Leaflet/MapLibre/CDN JS or CSS.
 * Every tile and marker is painted inside ONE clipped canvas: image tiles
 * physically cannot escape their viewport into navigation, cards, or forms.
 * Loads only currently visible OpenStreetMap tiles; no prefetch/bulk download.
 */
const TILE_SIZE = 256;
const MAX_CACHE = 70;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function project(lat, lng, zoom) {
  const s = TILE_SIZE * Math.pow(2, zoom);
  const a = clamp(lat, -85.051128, 85.051128) * Math.PI / 180;
  return {x: (lng + 180) / 360 * s, y: (1 - Math.log(Math.tan(a) + 1 / Math.cos(a)) / Math.PI) / 2 * s};
}
function unproject(x,y,zoom){
  const s = TILE_SIZE * Math.pow(2, zoom);
  const lng=x/s*360-180;
  const n=Math.PI*(1-2*y/s);
  return {lat:180/Math.PI*Math.atan(Math.sinh(n)),lng};
}
export class CanvasBarMap {
  constructor(canvas, {center, onSelect, onStatus}={}){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d',{alpha:false});
    this.center={...center};this.zoom=15;this.minZoom=12;this.maxZoom=17;
    this.onSelect=onSelect;this.onStatus=onStatus;
    this.tiles=new Map();this.points=[];this.route=[];this.highlight=null;this.origin={...center};this.selectOrigin=false;
    this.drag=null;this.activePointers=new Map();this.pinchDist=0;this.moved=false;
    this.width=0;this.height=0;this.pending=false;this.destroyed=false;
    canvas.style.touchAction='none';
    this.resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>this.resize()):null;
    if(this.resizeObserver)this.resizeObserver.observe(canvas);
    window.addEventListener('resize',this._resize=()=>this.resize(),{passive:true});
    canvas.addEventListener('pointerdown',e=>this.pointerDown(e));
    canvas.addEventListener('pointermove',e=>this.pointerMove(e));
    canvas.addEventListener('pointerup',e=>this.pointerUp(e));
    canvas.addEventListener('pointercancel',e=>this.pointerUp(e));
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.setZoom(this.zoom+(e.deltaY<0?1:-1))},{passive:false});
    this.resize();
  }
  resize(){
    if(this.destroyed)return;
    const r=this.canvas.getBoundingClientRect();
    const w=Math.round(r.width),h=Math.round(r.height);
    if(w<1||h<1)return;
    this.width=w;this.height=h;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){
      this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
    }
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.requestDraw();
  }
  setCenter(c){
    if(!Number.isFinite(c?.lat)||!Number.isFinite(c?.lng))return;
    this.center={lat:clamp(c.lat,-85,85),lng:clamp(c.lng,-180,180)};
    this.requestDraw();
  }
  setZoom(z){this.zoom=clamp(Math.round(z),this.minZoom,this.maxZoom);this.requestDraw()}
  zoomHome(){this.zoom=15;this.setCenter(this.origin)}
  setOrigin(p){this.origin=Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)?{...p}:null;this.requestDraw()}
  setPoints(points){this.points=points.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));this.requestDraw()}
  setRoute(points){this.route=points.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));this.requestDraw()}
  setHighlight(id){this.highlight=id;this.requestDraw()}
  setPickMode(value){this.selectOrigin=!!value;this.canvas.style.cursor=value?'crosshair':'grab'}
  requestDraw(){if(this.pending||this.destroyed)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.draw()})}
  pointerDown(e){
    if(e.button!==undefined&&e.button!==0&&e.pointerType!=='touch')return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.activePointers.size===1){this.drag={x:e.clientX,y:e.clientY,center:project(this.center.lat,this.center.lng,this.zoom)};this.moved=false}
    else if(this.activePointers.size===2){this.pinchDist=this.pointerDistance();this.drag=null;this.moved=true}
  }
  pointerDistance(){const p=[...this.activePointers.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}
  pointerMove(e){
    if(!this.activePointers.has(e.pointerId))return;
    this.activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.activePointers.size!==1||!this.drag)return;
    const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
    if(Math.hypot(dx,dy)>4)this.moved=true;
    if(!this.moved)return;
    const p=unproject(this.drag.center.x-dx,this.drag.center.y-dy,this.zoom);
    this.setCenter(p);
  }
  pointerUp(e){
    if(!this.activePointers.has(e.pointerId))return;
    if(this.activePointers.size===2){const d=this.pointerDistance();if(this.pinchDist&&d/this.pinchDist>1.18)this.setZoom(this.zoom+1);else if(this.pinchDist&&d/this.pinchDist<.84)this.setZoom(this.zoom-1)}
    const click=this.activePointers.size===1&&!this.moved;
    this.activePointers.delete(e.pointerId);
    this.drag=null;
    if(click){const rect=this.canvas.getBoundingClientRect();this.handleTap(e.clientX-rect.left,e.clientY-rect.top)}
  }
  handleTap(x,y){
    const origin=project(this.center.lat,this.center.lng,this.zoom);
    const point=unproject(origin.x+x-this.width/2,origin.y+y-this.height/2,this.zoom);
    if(this.selectOrigin){this.setPickMode(false);this.onSelect?.({type:'origin',...point});return}
    let closest=null,closestDist=22;
    for(const p of [...this.points,...this.route]){const q=this.screenPosition(p),d=Math.hypot(q.x-x,q.y-y);if(d<closestDist){closest=p;closestDist=d}}
    if(closest)this.onSelect?.({type:'venue',venue:closest});
  }
  screenPosition(pos){const c=project(this.center.lat,this.center.lng,this.zoom),q=project(pos.lat,pos.lng,this.zoom);return {x:q.x-c.x+this.width/2,y:q.y-c.y+this.height/2}}
  getVisibleBoundingBox(){const c=project(this.center.lat,this.center.lng,this.zoom),pad=30;
    const a=unproject(c.x-this.width/2-pad,c.y+this.height/2+pad,this.zoom);
    const b=unproject(c.x+this.width/2+pad,c.y-this.height/2-pad,this.zoom);
    return {south:a.lat,west:a.lng,north:b.lat,east:b.lng};
  }
  tileKey(z,x,y){return `${z}/${x}/${y}`}
  obtainTile(z,x,y){
    const key=this.tileKey(z,x,y);if(this.tiles.has(key))return this.tiles.get(key);
    const obj={status:'loading',image:new Image(),last:Date.now()};
    this.tiles.set(key,obj);
    obj.image.decoding='async';
    obj.image.onload=()=>{obj.status='ready';this.requestDraw()};
    obj.image.onerror=()=>{obj.status='error';this.onStatus?.('部分地圖底圖未載入，仍可使用酒吧清單與導航');this.requestDraw()};
    obj.image.src=`https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    if(this.tiles.size>MAX_CACHE){
      for(const [k,v] of this.tiles){if(k!==key&&this.tiles.size>MAX_CACHE){this.tiles.delete(k);if(v.status==='loading'){v.image.onload=null;v.image.onerror=null;v.image.src=''}}}
    }
    return obj;
  }
  draw(){
    if(!this.width||!this.height||this.destroyed)return;
    const ctx=this.ctx,w=this.width,h=this.height;
    ctx.fillStyle='#d6e2d8';ctx.fillRect(0,0,w,h);
    ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
    const z=this.zoom,c=project(this.center.lat,this.center.lng,z),n=Math.pow(2,z);
    const firstX=Math.floor((c.x-w/2)/TILE_SIZE),lastX=Math.floor((c.x+w/2)/TILE_SIZE);
    const firstY=Math.floor((c.y-h/2)/TILE_SIZE),lastY=Math.floor((c.y+h/2)/TILE_SIZE);
    let initiated=0;
    for(let ty=firstY;ty<=lastY;ty++)for(let tx=firstX;tx<=lastX;tx++){
      const x=tx*TILE_SIZE-c.x+w/2,y=ty*TILE_SIZE-c.y+h/2;
      ctx.fillStyle=(tx+ty)%2?'#dae2df':'#d1dad7';ctx.fillRect(Math.floor(x),Math.floor(y),257,257);
      if(ty<0||ty>=n)continue;
      const wrapped=((tx%n)+n)%n,key=this.tileKey(z,wrapped,ty);
      let tile=this.tiles.get(key);
      if(!tile&&initiated<12){tile=this.obtainTile(z,wrapped,ty);initiated++}
      if(tile?.status==='ready'){
        try{ctx.drawImage(tile.image,Math.floor(x),Math.floor(y),257,257)}catch{}
      }
    }
    this.drawMarkers(ctx);
    ctx.restore();
  }
  drawMarkers(ctx){
    // Route is a schematic straight-line connector, not a walking path.
    // Do not connect across missing-coordinate stops.
    for(let i=1;i<this.route.length;i++){
      const a=this.route[i-1], b=this.route[i];
      if(a.routeIndex+1!==b.routeIndex)continue;
      const p=this.screenPosition(a),q=this.screenPosition(b);
      ctx.save();ctx.strokeStyle='#276b57';ctx.lineWidth=4;ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
    }
    for(const p of this.points){
      const {x,y}=this.screenPosition(p);
      if(x < -30||y < -30||x>this.width+30||y>this.height+30)continue;
      const selected=p.id===this.highlight;
      ctx.beginPath();ctx.arc(x,y,selected?13:8,0,Math.PI*2);
      ctx.fillStyle=selected?'#f5bba7':'#183f33';ctx.fill();
      ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();
      if(!selected){ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#bce9be';ctx.fill()}
    }
    for(const p of this.route){
      const {x,y}=this.screenPosition(p);
      if(x < -30||y < -30||x>this.width+30||y>this.height+30)continue;
      ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fillStyle='#f7bea8';ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle='#ffffff';ctx.stroke();
      ctx.fillStyle='#39271f';ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.routeIndex),x,y+.5);
    }
    if(this.origin&&Number.isFinite(this.origin.lat)){
      const {x,y}=this.screenPosition(this.origin);
      if(x>=-30&&y>=-30&&x<this.width+30&&y<this.height+30){
        ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fillStyle='rgba(24,58,49,.20)';ctx.fill();
        ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fillStyle='#184e3b';ctx.fill();
        ctx.lineWidth=3;ctx.strokeStyle='white';ctx.stroke();
        ctx.font='14px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText('⌂',x,y+.5);
      }
    }
  }
  destroy(){this.destroyed=true;this.resizeObserver?.disconnect();window.removeEventListener('resize',this._resize)}
}
