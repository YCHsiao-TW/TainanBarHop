import {fetchPublicBars, geocodePlace} from './poi.js?v=7.1.4';
import {installLanguage, getLanguage, tr} from './i18n.js?v=7.1.4';
import {CanvasBarMap} from './map.js?v=7.1.4';
import {INN,CURATED} from './data.js?v=7.1.4';
import {sortRoute} from './route.js?v=7.1.4';
import {loadDoorplateIndex,evaluateVenue,matchPublicToCurated,summarizeAudit,meters} from './audit.js?v=7.1.4';

const VERSION='JS v7.1.4';
const STORE='tainan-bar-hop-js-v6';
const GEO_STORE='tainan-bar-hop-verified-coordinates-v61';
const POI_STORE='tainan-bar-hop-public-snapshot-v61';
const STORE_MAX=14*86400000;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s\-_・‧（）()·.,，。:：]/g,'');
const idOf=v=>normal(v.name);
const label={cocktail:'🍸 調酒',beer:'🍺 啤酒',bistro:'🍽️ 餐酒'};
const hasCoords=v=>Number.isFinite(v?.lat)&&Number.isFinite(v?.lng);
const searchString=v=>normal([v.name,v.address,v.desc,v.category,label[v.category],v.source==='osm'?'公開酒吧':'精選酒吧'].join(' '));
const kmBetween=(a,b)=>{if(!hasCoords(a)||!hasCoords(b))return null;const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r,x=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(x)))};
const kmText=d=>d===null?'距離未確認':d<1?`${Math.round(d*1000)} m`:`${d.toFixed(1)} km`;
const coordsStr=p=>`${p.lat},${p.lng}`;
const copyVenue=v=>({id:v.id,name:v.name,address:v.address,category:v.category,lat:v.lat,lng:v.lng,source:v.source,coordAudit:v.coordAudit});
const getLocal=(k,def)=>{try{return JSON.parse(localStorage.getItem(k))??def}catch{return def}};
const persisted=getLocal(STORE,{});
const old=getLocal('tainan-bar-hop-js-v5',{});
const cachedPoi=getLocal(POI_STORE,null);
function validTainan(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)&&p.lat>=22.75&&p.lat<=23.55&&p.lng>=119.95&&p.lng<=120.85}
function restoredCurated(){const currentGeo=getLocal(GEO_STORE,{});return CURATED.map(v=>{const g=currentGeo[v.id];if(validTainan(g)&&g.source==='manual')return {...v,lat:g.lat,lng:g.lng,coordsSource:'user-manual',coordQuality:'使用者手動確認'};return validTainan(v)?{...v}:validTainan(g)?{...v,lat:g.lat,lng:g.lng,coordsSource:g.source||'user-confirmed'}:{...v}})}
const curatedBaseline=restoredCurated().map(v=>evaluateVenue({...v,officialPosition:validTainan(CURATED.find(c=>c.id===v.id))?{lat:CURATED.find(c=>c.id===v.id).lat,lng:CURATED.find(c=>c.id===v.id).lng}:null},null));
const curatedById=new Map(curatedBaseline.map(v=>[v.id,v]));
const state={
  origin:{...INN,type:'inn'},
  venues:curatedBaseline,
  osm:[], route:(persisted.route||old.route||[]).map(x=>{
    const current=curatedById.get(x.id);
    return validTainan(current)?{...x,lat:current.lat,lng:current.lng}:{...x};
  }),
  fav:new Set(persisted.fav||old.favorite||[]),
  visited:new Set(persisted.visited||old.visited||[]),
  view:'discover', filter:'all', search:'', radius:'2', show:12,
  sorting:'recommended', nearby:false, selected:null,
  sheet:'peek', loading:false, loaded:false, loadMessage:'', geoBusy:false, pinTarget:null, provider:'',
  pickMode:false, random:null,randomScope:'near',randomCategory:'all',randomExcludeVisited:true,randomExcludeRoute:true,nightMode:false,nightIndex:0,doorplateIndex:null, auditStatus:'官方門牌比對準備中', auditExpanded:false, auditLoading:false, auditQueued:false
};
function save(){try{localStorage.setItem(STORE,JSON.stringify({route:state.route,fav:[...state.fav],visited:[...state.visited]}))}catch{}}
function googlePlace(v){return 'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:`${v.name} ${v.address||'臺南市'}`})}
function googleSearch(query){return 'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:query||'臺南 酒吧'})}
function dest(v){const q=v.coordAudit?.category;return hasCoords(v)&&q!=='conflict'&&q!=='review'?coordsStr(v):`${v.name} ${v.address||'臺南市'}`}
// For a planned trip, start at the chosen origin; when proceeding to the next stop,
// omit origin so Google Maps uses the visitor's current position.
function navUrl(arr,{fromCurrent=false}={}){
 if(!arr.length)return '#';
 const params=new URLSearchParams({api:'1',destination:dest(arr[arr.length-1]),travelmode:'walking'});
 if(!fromCurrent&&state.origin.type!=='gps')params.set('origin',hasCoords(state.origin)?coordsStr(state.origin):state.origin.address);
 if(arr.length>1)params.set('waypoints',arr.slice(0,-1).map(dest).join('|'));
 return 'https://www.google.com/maps/dir/?'+params;
}
function toast(txt){const el=$('toast');el.textContent=txt;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200)}
function routeHas(v){return state.route.some(p=>idOf(p)===idOf(v))}
function distance(v){return kmBetween(state.origin,v)}
function updateDistanceLabel(){const origin=state.origin;$('startTitle').textContent=origin.name;$('startAddr').textContent=origin.address||'地圖所選座標';$('mapOrigin').textContent=origin.name;$('startShortcut').textContent=origin.type==='inn'?'民宿起點':origin.name;}
function setStart(p){state.origin={...p};updateDistanceLabel();map.setOrigin(p);if(hasCoords(p)){if(p.lat>22.75&&p.lat<23.3&&p.lng>120.0&&p.lng<120.55)map.setCenter(p)}renderResults()}
function updateMap(){const pts=state.venues.filter(hasCoords);map.setPoints(pts);updateRouteMap();$('pinCount').textContent=`${pts.length} 個酒吧圖釘 · ${CURATED.length} 精選`}
function updateRouteMap(){map.setRoute(state.route.map((v,i)=>({...v,routeIndex:i+1})).filter(hasCoords));}
function add(v){if(routeHas(v)){toast('這間已經在續攤清單了');return}state.route.push(copyVenue(v));save();renderRoute();renderResults();renderRandom();updateRouteMap();toast('已加入續攤：'+v.name)}
function remove(i){state.route.splice(i,1);save();renderRoute();renderResults();updateRouteMap()}
function move(i,d){let j=i+d;if(j<0||j>=state.route.length)return;[state.route[i],state.route[j]]=[state.route[j],state.route[i]];save();renderRoute();updateRouteMap()}
function routeOptimize(){
 if(!hasCoords(state.origin)){toast('起點尚無座標，請先以定位或地圖選點設定起點，再自動排序');return}
 const {route,unlocated}=sortRoute(state.origin,state.route);
 state.route=[...route,...unlocated];save();renderRoute();updateRouteMap();
 toast(unlocated.length?`已依直線距離排序；${unlocated.length} 間尚未定位，排在最後`:'已依直線距離安排；實際步行請以導航為準');
}
function distanceFrom(a,b){return kmBetween(a,b)}
function toggleFavorite(v){const key=idOf(v);state.fav.has(key)?state.fav.delete(key):state.fav.add(key);save();renderResults();renderRandom();renderRoute()}
function findVenue(id){return state.venues.find(x=>x.id===id)||state.route.find(x=>x.id===id)}
function focus(v){if(!hasCoords(v)){toast('這間店尚未核對座標，可點「Google 地圖查店家」');return}map.setCenter(v);map.setZoom(16);map.setHighlight(v.id);state.selected=v;$('mapVenue').hidden=false;$('mapVenue').innerHTML=`<strong data-no-translate>${esc(v.name)}</strong><p data-no-translate>${esc(v.address||'依 OSM 地圖點位')}</p><div class="actions"><button class="btn btn-brand" id="pinAdd">＋ 加入續攤</button><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(navUrl([v]))}">步行導航 ↗</a><button class="btn" id="pinInfo">店家資訊</button><button class="btn btn-ghost" id="pinClose">×</button></div>`;$('pinAdd').onclick=()=>add(v);$('pinInfo').onclick=()=>showDetail(v);$('pinClose').onclick=()=>{$('mapVenue').hidden=true;map.setHighlight(null)}}

// Details are based on the site's own curated descriptions/OSM metadata; no unverified ratings or opening hours.
function showDetail(v){
 const modal=$('venueModal');if(!modal)return;
 const d=distance(v),q=v.coordAudit?.quality||'座標尚未確認';
 $('detailContent').innerHTML=`<div class="detail-kicker">BAR DETAILS · 店家資訊</div>
 <h2 id="detailTitle" data-no-translate>${esc(v.name)}</h2>
 <div class="detail-tags"><span>${esc(label[v.category]||'🍸 酒吧')}</span><span>${v.source==='curated'?'本站精選':'OSM 公開點位'}</span></div>
 <p class="detail-address" data-no-translate>📍 ${esc(v.address||'臺南市・地址待確認')}</p>
 <div class="detail-grid"><div><small>離起點直線距離</small><b>${kmText(d)}</b></div><div><small>定位資料</small><b>${esc(q)}</b></div></div>
 <section class="detail-blurb"><b>特色與介紹</b><p>${esc(v.desc||'暫無已核對的特色描述，可以開啟 Google Maps 查看店家最新資訊。')}</p></section>
 <p class="detail-warning">營業時間、低消、價格、訂位及是否仍營業尚未即時驗證，出發前請向店家確認。座標是參考位置，不一定是店門口。</p>
 <div class="detail-actions"><button class="btn btn-brand" id="detailAdd">${routeHas(v)?'✓ 已加入續攤':'＋ 加入續攤'}</button><a class="btn" href="${esc(navUrl([v]))}" target="_blank" rel="noopener noreferrer">🚶 步行導航 ↗</a><a class="btn" href="${esc(googlePlace(v))}" target="_blank" rel="noopener noreferrer">Google Maps 查店 ↗</a></div>`;
 $('detailAdd').onclick=()=>{add(v);$('detailAdd').textContent='✓ 已加入續攤'};
 modal.hidden=false;document.body.classList.add('modal-open');$('detailClose').focus();
}
function closeDetail(){const modal=$('venueModal');if(!modal)return;modal.hidden=true;document.body.classList.remove('modal-open')}

// A share link carries the selected stops only, never the user's current GPS location.
function encodeShareTrip(stops){
 const payload={v:1,stops:stops.slice(0,20).map(v=>({id:String(v.id||'').slice(0,110),name:String(v.name||'').slice(0,120),address:String(v.address||'').slice(0,240),category:v.category||'cocktail',source:v.source||'curated',lat:hasCoords(v)?v.lat:null,lng:hasCoords(v)?v.lng:null}))};
 const bytes=new TextEncoder().encode(JSON.stringify(payload));let str='';for(const b of bytes)str+=String.fromCharCode(b);
 return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function buildTripLink(){const url=new URL(location.href);url.hash='trip='+encodeShareTrip(state.route);return url.href}
function readIncomingTrip(){
 try{const match=location.hash.match(/^#trip=([A-Za-z0-9_-]{1,10000})$/);if(!match)return null;
 const encoded=match[1].replace(/-/g,'+').replace(/_/g,'/');const bin=atob(encoded);const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));
 if(data.v!==1||!Array.isArray(data.stops)||!data.stops.length||data.stops.length>20)return null;
 const items=data.stops.map((v,i)=>{
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>120||typeof v.id!=='string'||v.id.length>110)return null;
  if(typeof v.address!=='string'||v.address.length>240)return null;
  const lat=Number(v.lat),lng=Number(v.lng);const p={id:v.id||'shared-'+i,name:v.name,address:v.address,category:['cocktail','beer','bistro'].includes(v.category)?v.category:'cocktail',source:v.source==='osm'?'osm':'curated',lat:null,lng:null};
  // A shared link is not proof of position; only known coordinates in the Tainan bounds are accepted.
  if(v.lat!==null&&v.lng!==null&&validTainan({lat,lng})){p.lat=lat;p.lng=lng}
  return p;
 });
 if(items.some(v=>!v))return null;return items;
 }catch{return null}
}
function dismissIncoming(){state.incomingTrip=null;$('tripOffer').hidden=true;try{history.replaceState(null,'',location.href.split('#')[0])}catch{}}
function loadIncoming(){
 const items=state.incomingTrip;if(!items?.length)return;
 if(state.route.length&&!window.confirm(getLanguage()==='en'?'Loading this shared itinerary will replace your saved route on this device. Continue?':'載入朋友分享的續攤路線，會取代目前這台裝置的續攤清單。確定嗎？'))return;
 state.route=items.map(v=>{const local=state.venues.find(x=>x.id===v.id);return local?{...v,lat:local.lat,lng:local.lng,address:local.address,coordAudit:local.coordAudit}:v});
 save();dismissIncoming();renderRoute();renderResults();updateRouteMap();showView('route');toast('已載入朋友分享的 '+items.length+' 間酒吧');
}
async function shareTrip(){
 if(!state.route.length)return toast('請先加入酒吧');
 const link=buildTripLink();const msg='🍸 府城微醺地圖｜今晚續攤';
 if(navigator.share){try{await navigator.share({title:msg,text:'朋友點開即可還原今晚路線（不包含你的定位）',url:link});return}catch(e){if(e.name==='AbortError')return}}
 try{await navigator.clipboard.writeText(link);toast('已複製可還原續攤的網址，傳給朋友就行')}catch{
  const input=document.createElement('textarea');input.value=link;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();const copied=document.execCommand('copy');input.remove();toast(copied?'已複製分享網址':'複製失敗，請改用瀏覽器分享功能')
 }
}

// Night mode only uses existing itinerary and is independent of map canvas and provider APIs.
function openNight(){if(!state.route.length)return toast('請先選擇要去的酒吧');state.nightMode=true;
 const first=state.route.findIndex(v=>!state.visited.has(idOf(v)));state.nightIndex=first<0?0:first;
 $('nightScreen').hidden=false;document.body.classList.add('night-open');renderNight();$('nightExit').focus();
}
function closeNight(){state.nightMode=false;$('nightScreen').hidden=true;document.body.classList.remove('night-open');setNavActive(state.view==='route'?'route':'discover')}
function renderNight(){
 if(!state.nightMode)return;const r=state.route,i=state.nightIndex;
 $('nightCounter').textContent=i>=r.length?'完成巡禮':`第 ${i+1} / ${r.length} 站`;
 $('nightProgress').innerHTML=r.map((_,j)=>`<span class="${j<=i?'done':''}"></span>`).join('');
 if(i>=r.length){
  $('nightPlace').textContent='今晚行程完成 ✨';$('nightLocation').textContent='可返回起點或結束模式，路線會保存在這台裝置。';
  $('nightNav').hidden=true;$('nightDone').hidden=true;$('nightSkip').hidden=true;$('nightPrev').hidden=false;
  $('nightPrev').disabled=false;$('nightNextLabel').textContent='沒有下一站';return;
 }
 const v=r[i],next=r[i+1];$('nightPlace').textContent=v.name;
 const prev=i===0?state.origin:r[i-1],d=kmBetween(prev,v);
 $('nightLocation').textContent=(v.address||'臺南市')+(d==null?'':' · 距上一站約 '+kmText(d)+'（直線）');
 $('nightNav').hidden=false;$('nightDone').hidden=false;$('nightSkip').hidden=false;$('nightPrev').hidden=i===0;
 $('nightNav').href=navUrl([v],{fromCurrent:true});$('nightNextLabel').textContent=next?'下一站：'+next.name:'這是最後一站';
}
function nightAdvance(markVisited){
 const v=state.route[state.nightIndex];if(v&&markVisited){state.visited.add(idOf(v));save();renderRoute()}
 if(state.nightIndex<state.route.length)state.nightIndex++;
 renderNight();
}
function matches(){const q=normal(state.search);let all=state.venues.filter(v=>(state.filter==='all'||(state.filter==='favorite'?state.fav.has(idOf(v)):state.filter===v.category))&&(!q||searchString(v).includes(q)));
  if(state.nearby){const radius=Number(state.radius)||2;all=all.filter(v=>{const d=distance(v);return d!==null&&d<=radius});}
  if(state.sorting==='nearest'||state.nearby){all.sort((a,b)=>(distance(a)??Infinity)-(distance(b)??Infinity)||a.name.localeCompare(b.name,'zh-Hant'))}
  else if(state.sorting==='alpha')all.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
  else all.sort((a,b)=>(a.source==='curated'?0:1)-(b.source==='curated'?0:1));
  return all;
}
function venueCard(v){const d=distance(v),isPinned=hasCoords(v),fav=state.fav.has(idOf(v)),added=routeHas(v);
  return `<article class="venue" data-venue="${esc(v.id)}">
   <div class="venue-main"><div class="ven-head"><h3 data-no-translate>${esc(v.name)}</h3><span class="source">${v.source==='curated'?'精選':'OSM'}</span></div>
     <p class="ven-address" data-no-translate>📍 ${esc(v.address||'臺南市・位置依 OSM 標記')}</p>
     <div class="tags"><span>${esc(label[v.category]||'🍸 酒吧')}</span><span>${isPinned?`約 ${kmText(d)}・直線距離`:'尚未確認座標'}</span></div>
   </div>
   <div class="venue-actions"><div class="venue-primary"><button class="btn btn-brand" data-action="add" data-id="${esc(v.id)}">${added?'✓ 已加入':'＋ 續攤'}</button><a class="btn" href="${esc(navUrl([v]))}" target="_blank" rel="noopener noreferrer">🚶 導航 ↗</a></div><div class="venue-secondary">${isPinned?`<button class="btn" data-action="focus" data-id="${esc(v.id)}">📍 看圖釘</button>`:`<button class="btn btn-geo" data-action="locate" data-id="${esc(v.id)}">📍 定位這間</button>`}<button class="btn btn-ghost" data-action="detail" data-id="${esc(v.id)}">店家資訊</button><button class="btn btn-icon ${fav?'favorited':''}" aria-label="${fav?'取消收藏':'收藏'}" data-action="fav" data-id="${esc(v.id)}">${fav?'♥':'♡'}</button></div></div></article>`
}
function renderResults(){const found=matches();$('resultCount').textContent=`${found.length} 間`;const shown=found.slice(0,state.show);
  $('results').innerHTML=shown.map(venueCard).join('')||`<div class="empty"><strong>${state.nearby?'附近暫時沒有可計算距離的點位':'沒有符合搜尋的酒吧'}</strong><p>${state.nearby?'可以先按「更新公開酒吧」、擴大公里數，或關閉附近篩選，逐間按「定位這間」確認座標。':'可以按「更新公開酒吧」，或用 Google 地圖找更多。'}</p><button class="btn" id="resetNearby" type="button">顯示全部精選</button></div>`;
  const reset=$('resetNearby');if(reset)reset.onclick=()=>{state.nearby=false;state.filter='all';state.search='';renderResults()};
  $('loadMore').hidden=found.length<=state.show;
  $('searchClear').hidden=!state.search;
  $('searchGoogle').href=googleSearch(state.search?state.search+' 臺南':'臺南市 酒吧');
  $('searchGoogle').textContent=state.search?'在 Google 地圖搜尋「'+state.search.slice(0,22)+'」 ↗':'Google 地圖找更多 ↗';
  $('nearState').textContent=state.nearby?`距離起點 ${state.radius} km 內有 ${found.length} 間已定位酒吧（直線距離；未定位店家不計入）`:`精選酒吧 ${state.venues.filter(v=>v.source==='curated'&&hasCoords(v)).length}/${CURATED.length} 間具參考座標，公開酒吧 ${state.venues.filter(v=>v.source==='osm'&&hasCoords(v)).length} 間有定位；距離為直線估算。`;
  $('nearBtn').classList.toggle('active',state.nearby);
  $('searchInput').value=state.search;
  $('filterAll').classList.toggle('active',state.filter==='all');
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  $('morePublic').textContent=state.loading?'正在讀取公開酒吧…':state.loaded?'↻ 更新公開酒吧':'＋ 更新公開酒吧';
  $('morePublic').disabled=state.loading;
  $('publicInfo').textContent=state.loadMessage||'精選名單可離線搜尋；公開酒吧須連網載入，資料可能不完整。';
  $('btnFav').classList.toggle('active',state.filter==='favorite');
  $('radiusSelect').value=state.radius;
  $('sortSelect').value=state.sorting;
  $('routeCount').textContent=state.route.length;
}
function renderRoute(){const r=state.route;$('routeBadge').textContent=r.length;$('navRouteBadge').textContent=r.length;$('routeCount').textContent=r.length;
  $('routeList').innerHTML=r.length?r.map((v,i)=>`<div class="stop"><span class="stop-index">${i+1}</span><div class="stop-main"><b data-no-translate>${esc(v.name)}</b><small data-no-translate>${esc(v.address||'臺南市')} ${hasCoords(v)?'・約 '+kmText(distance(v)):''}</small><div class="stop-actions"><a href="${esc(navUrl([v],{fromCurrent:true}))}" target="_blank" rel="noopener noreferrer">從目前位置導航 ↗</a><button data-action="visited" data-id="${esc(v.id)}">${state.visited.has(idOf(v))?'✓ 已到過':'標記已到'}</button></div></div><div class="stop-controls"><button data-move="up" data-i="${i}" aria-label="上移" ${i===0?'disabled':''}>↑</button><button data-move="down" data-i="${i}" aria-label="下移" ${i===r.length-1?'disabled':''}>↓</button><button data-move="delete" data-i="${i}" aria-label="移除">×</button></div></div>`).join(''):'<div class="empty"><strong>還沒選今晚要去的店家</strong><p>在探索頁按「＋ 續攤」，就能建立路線。</p></div>';
  const first=r.slice(0,4),next=r.find(v=>!state.visited.has(idOf(v)))||r[0];$('routeGo').href=r.length?navUrl(first):'#';$('routeGo').classList.toggle('disabled',!r.length);$('routeNext').href=next?navUrl([next],{fromCurrent:true}):'#';$('routeNext').classList.toggle('disabled',!next);$('routeCaveat').textContent=r.length>4?'手機 Google Maps 單次只帶入前四站，其餘可逐站導航。':'地圖上的連線是直線示意，不是實際步行路徑。導航請以 Google Maps 為準。';
  $('stickyRoute').hidden=!r.length||state.view==='route'; $('stickyCount').textContent=`${r.length} 間酒吧`;$('startNight').disabled=!r.length;}
function renderRandom(){const root=$('randomResult');if(!state.random){root.hidden=true;return}const v=state.random;root.hidden=false;root.innerHTML=`<div class="lucky-result"><span class="small">✨ 今晚喝這間</span><h3 data-no-translate>${esc(v.name)}</h3><p data-no-translate>${esc(v.address||'臺南市')}</p><div class="actions"><button class="btn btn-brand" id="randomAdd">＋ 加入續攤</button><a href="${esc(navUrl([v]))}" class="btn" target="_blank" rel="noopener noreferrer">步行導航 ↗</a><button class="btn" id="randomAgain">再抽一次</button></div></div>`;$('randomAdd').onclick=()=>add(v);$('randomAgain').onclick=randomPick;}
function randomPick(){
 const radius=Number(state.radius)||2;
 const eligible=state.venues.filter(v=>{
  if(state.randomCategory!=='all'&&v.category!==state.randomCategory)return false;
  if(state.randomExcludeVisited&&state.visited.has(idOf(v)))return false;
  if(state.randomExcludeRoute&&routeHas(v))return false;
  if(state.randomScope==='near'&&(distance(v)==null||distance(v)>radius))return false;
  return true;
 });
 if(!eligible.length){state.random=null;renderRandom();toast('沒有符合抽選條件的酒吧，請調整範圍或排除條件');return}
 state.random=eligible[Math.floor(Math.random()*eligible.length)];renderRandom();
}

function showView(view){
 state.view=view;
 // Internal navigation must also exit full-screen map and synchronize mobile tabs.
 document.body.classList.remove('map-only');
 setNavActive(view==='route'?'route':'discover');
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-selected',String(b.dataset.view===view))});
 $('discoverPanel').hidden=view!=='discover';$('routePanel').hidden=view!=='route';
 if(view==='discover')renderResults();else renderRoute();
 $('stickyRoute').hidden=!state.route.length||view==='route';
 if(window.innerWidth<800){$('sheet').classList.remove('collapsed');state.sheet='full'}
}
function setSearch(s){state.search=s;state.show=12;if(state.filter==='favorite'&&s)state.filter='all';if(state.nearby&&s)state.nearby=false;renderResults();}
function setFilter(f){state.filter=f;state.show=12;renderResults()}
function showNear(){state.nearby=!state.nearby;state.sorting='nearest';state.filter='all';state.search='';state.show=16;showView('discover');renderResults();if(state.nearby&&state.venues.filter(hasCoords).length===0&&!state.loading)loadOsm();}
function buildAuditedVenues(){
 const baseline=restoredCurated().map(v=>({...v,officialPosition:validTainan(CURATED.find(c=>c.id===v.id))?{lat:CURATED.find(c=>c.id===v.id).lat,lng:CURATED.find(c=>c.id===v.id).lng}:null}));
 return matchPublicToCurated(baseline,state.osm).map(v=>evaluateVenue(v,state.doorplateIndex));
}
function refreshCoordinateComparison(){
 state.venues=buildAuditedVenues();
 // Refresh previously saved itinerary and selected bar locations without losing order/favorites.
 for(const old of state.route){const updated=state.venues.find(v=>v.id===old.id);if(updated){old.lat=updated.lat;old.lng=updated.lng;old.address=updated.address;old.coordAudit=updated.coordAudit;}}
 save();updateMap();renderResults();renderRoute();renderRandom();renderAudit();
}
function updateOsm(venues,provider='OSM'){
 const unique=new Map();for(const v of venues){if(validTainan(v)&&v.name&&v.id)unique.set(v.id,{...v,lat:Number(v.lat),lng:Number(v.lng)})}
 state.osm=[...unique.values()];state.provider=provider;
 refreshCoordinateComparison();
 if(state.osm.length){state.doorplateIndex=null;ensureDoorplates();}
}
async function ensureDoorplates(){
 if(state.auditLoading){state.auditQueued=true;return}if(state.doorplateIndex)return;
 state.auditLoading=true;state.auditStatus='正在背景比對市府門牌參考座標…';renderAudit();
 try{state.doorplateIndex={lookup:await loadDoorplateIndex(state.osm)};state.auditStatus='已自動比對官方門牌索引（114 年臺南市門牌坐標）';refreshCoordinateComparison()}
 catch(e){state.auditStatus='離線索引暫無法載入；已使用 35 間內建門牌座標，其餘保留 OSM 原始點位：'+String(e.message||e).slice(0,65);renderAudit()}
 finally{state.auditLoading=false;if(state.auditQueued){state.auditQueued=false;state.doorplateIndex=null;ensureDoorplates()}}
}
function renderAudit(){
 const pane=$('auditSummary');if(!pane)return;
 const k=summarizeAudit(state.venues),publicCount=state.osm.length;
 pane.innerHTML=`<div class="audit-kpis"><div><b>${k.total}</b><span>目前酒吧</span></div><div><b>${k.verifiedDoorplates}</b><span>門牌來源</span></div><div><b>${k.both}</b><span>雙源可比</span></div><div><b>${k.conflict+k.review}</b><span>需複核</span></div></div><p class="muted">${esc(state.auditStatus)}。已載入 ${publicCount} 間 OSM 店家；若舊版快照已保存在本瀏覽器，會自動納入比較。</p>`;
 const details=$('auditDetails');if(!details)return;
 details.hidden=!state.auditExpanded;
 if(state.auditExpanded){
  const sorted=[...state.venues].sort((a,b)=>{
   const rank=x=>x.coordAudit?.category==='conflict'?0:x.coordAudit?.category==='review'?1:x.coordAudit?.category==='aligned'?2:3;
   return rank(a)-rank(b)||((b.coordAudit?.deltaM||0)-(a.coordAudit?.deltaM||0));
  });
  details.innerHTML=sorted.map(v=>{const a=v.coordAudit||{},fmt=p=>p?`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`:'—';return `<article class="audit-entry"><div class="audit-head"><b>${esc(v.name)}</b><span>${esc(a.quality||'待核對')}</span></div><p>${esc(v.address||'地址未完整')}</p><small>原始 OSM：${esc(fmt(v.osmPosition))}　｜　官方門牌：${esc(fmt(v.officialPosition))}</small><small>差距：${a.deltaM===null||a.deltaM===undefined?'無法雙源比對':Math.round(a.deltaM)+' 公尺'}　·　採用：${a.choice==='osm'?'OSM 圖釘':a.choice==='doorplate'?'市府門牌':a.choice==='manual'?'手動位置':'其他'}</small><p>${esc(a.reason||'')}</p></article>`}).join('');
 }
 $('auditToggle').textContent=state.auditExpanded?'收起全部座標比較':'查看全部 '+k.total+' 間的比較結果';
}
function exportAuditCsv(){
 const titles=['酒吧','地址','原始OSM緯度','原始OSM經度','市府門牌緯度','市府門牌經度','兩者相差公尺','採用來源','品質分類','判斷依據'];
 const quote=v=>'"'+String(v??'').replace(/^([=+@-])/,'\'$1').replace(/"/g,'""')+'"';
 const rows=state.venues.map(v=>{const a=v.coordAudit||{};return [v.name,v.address,v.osmPosition?.lat??'',v.osmPosition?.lng??'',v.officialPosition?.lat??'',v.officialPosition?.lng??'',a.deltaM==null?'':a.deltaM.toFixed(1),a.choice||'',a.quality||'',a.reason||'']});
 const csv='\uFEFF'+[titles,...rows].map(arr=>arr.map(quote).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),el=document.createElement('a');el.href=url;el.download='TainanBarHop_v713_coordinate_audit.csv';document.body.appendChild(el);el.click();setTimeout(()=>{URL.revokeObjectURL(url);el.remove()},1000)
}
function showProviderMessage(text){state.loadMessage=text;renderResults()}
async function loadOsm(force=false){
 if(state.loading)return;
 if(!force&&cachedPoi?.venues?.length){updateOsm(cachedPoi.venues,cachedPoi.provider||'公開快取');state.loaded=true;showProviderMessage(`使用先前保存的 ${state.osm.length} 間公開酒吧（${cachedPoi.provider||'公開'}）；可按更新取得最新資料。`);return}
 state.loading=true;showProviderMessage('正在讀取 OSM 公開酒吧（ArcGIS 備援與 Overpass）…');
 try{
  const result=await fetchPublicBars();
  if(!result.venues.length)throw new Error('公開來源回傳 0 間酒吧');
  updateOsm(result.venues,result.provider);state.loaded=true;
  try{localStorage.setItem(POI_STORE,JSON.stringify({at:Date.now(),venues:result.venues,provider:result.provider}))}catch{}
  showProviderMessage(`✅ 已載入 ${state.osm.length} 間公開酒吧，來源：${result.provider}。資料可能有漏標或停業。`);
  if(force)toast(`已載入 ${state.osm.length} 間公開酒吧`);
 }catch(e){
  state.loadMessage=`⚠️ 公開點位來源連線失敗（${String(e.message||e).slice(0,92)}）。可使用精選名單、逐間定位與 Google Maps 導航。`;
  if(force)toast('公開來源暫時無法連線；仍可逐間定位酒吧');
 }finally{state.loading=false;renderResults()}
}
async function locateVenue(v){
 if(state.geoBusy||hasCoords(v))return;if(state.nearby){state.nearby=false;renderResults()}
 state.geoBusy=true;toast(`正在查詢 ${v.name} 的地址…`);
 try{
  const p=await geocodePlace(v);
  if(!p)throw new Error('沒有可靠座標');
  // Require human confirmation for a geocoding candidate; never silently save approximate coordinates.
  map.setCenter(p);map.setZoom(17);
  if(!window.confirm(getLanguage()==='en'?`Possible location for ${v.name}:\n${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}\n\nPlease verify this is the right bar address.`:`查到「${v.name}」的候選座標：\n${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}\n\n請核對地圖位置，這是正確的店家地址嗎？`))throw new Error('已取消確認');
  persistVenueCoord(v.id,p,'geocoded');toast(`已確認 ${v.name} 的位置`);
 }catch(e){
  if(String(e.message||e)!=='已取消確認'){
   if(window.confirm(getLanguage()==='en'?'Address lookup failed. Would you like to mark this bar on the map manually?':'外部地址定位不成功。要改用「點地圖手動標記這間酒吧」嗎？'))startManualPin(v)
   else toast('可使用 Google Maps 查店家，或再點「定位這間」')
  }
 }finally{state.geoBusy=false}
}
function persistVenueCoord(id,p,source){
 if(!validTainan(p)){toast('選擇的位置超出台南範圍');return}
 const dict=getLocal(GEO_STORE,{});dict[id]={lat:p.lat,lng:p.lng,source};try{localStorage.setItem(GEO_STORE,JSON.stringify(dict))}catch{}
 const v=state.venues.find(v=>v.id===id);if(!v)return;v.lat=p.lat;v.lng=p.lng;v.coordsSource=source;
 state.route.filter(v=>v.id===id).forEach(v=>{v.lat=p.lat;v.lng=p.lng});save();refreshCoordinateComparison();
 map.setCenter(p);map.setZoom(16);focus(findVenue(id)||v);
}
function startManualPin(v){state.pinTarget=v.id;map.setPickMode(true);toast(`請在地圖點選「${v.name}」的位置；定位完成前不會當成真實座標。`);if(window.innerWidth<800)window.scrollTo({top:0,behavior:'smooth'})}
async function fromAddress(){const text=$('addressInput').value.trim();if(!text){toast('請輸入地址、地名或經緯度');return}const m=text.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)$/)||text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);if(m){const lat=+m[1],lng=+m[2];if(Math.abs(lat)>90||Math.abs(lng)>180)return toast('座標超出範圍');setStart({name:'自訂起點',address:`${lat}, ${lng}`,lat,lng,type:'custom'});$('startOptions').hidden=true;return}if(/maps\.app\.goo\.gl/i.test(text)){toast('Google 短網址無法直接解析，請輸入地址或座標');return}const btn=$('setAddress');btn.disabled=true;btn.textContent='查詢中…';let p={name:text,address:text,type:'custom'};try{
  const q=/(台南|臺南)/.test(text)?text:`${text} 臺南市`;
  const candidate=await geocodePlace({name:q,address:q});
  if(candidate&&validTainan(candidate)){p.lat=candidate.lat;p.lng=candidate.lng;toast('請確認地圖上的起點是否正確')}
  else toast('地點地址已保留，Google Maps 導航可用；地圖座標尚待確認')
 }catch{toast('地址已保留供導航，地圖座標尚未確認')}finally{btn.disabled=false;btn.textContent='設為起點'}
 setStart(p);$('startOptions').hidden=true;}

function build(){ $('app').innerHTML=`
<header class="topbar"><div><div class="eyebrow">● TAINAN AFTER DARK <span class="version">${VERSION}</span></div><h1 data-brand-title data-no-translate>府城<span>微醺</span>地圖 <i>🍸</i></h1><p>選一間好酒吧，讓夜晚自然開始。</p></div><div class="site-tools"><a class="help-link" href="./help.html" aria-label="使用說明">ⓘ 使用說明</a><div class="lang-switch" role="group" aria-label="Language / 語言"><button type="button" data-lang-select="zh" aria-pressed="true">中文</button><button type="button" data-lang-select="en" aria-pressed="false">EN</button></div><button class="start-chip" id="startShortcut">民宿起點</button></div></header>
<div class="layout">
<main class="maparea" id="mapArea"><canvas id="mapCanvas" aria-label="臺南互動地圖，拖曳瀏覽、點圖釘選酒吧" ></canvas><div class="map-status"><strong>📍 <span id="mapOrigin">${esc(INN.name)}</span></strong><small id="pinCount">0 個已定位點位</small></div><div class="map-controls"><button id="homeMap" aria-label="返回起點">⌂</button><button id="zoomIn" aria-label="放大">＋</button><button id="zoomOut" aria-label="縮小">－</button></div><div class="map-venue" id="mapVenue" hidden></div><div class="attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></div></main>
<section class="sheet" id="sheet"><button class="sheet-grip" id="sheetToggle" aria-label="展開或收合酒吧清單"><span></span></button><nav class="tabs"><button class="tab active" data-view="discover" aria-selected="true">🗺️ 探索酒吧</button><button class="tab" data-view="route" aria-selected="false">🥂 我的續攤 <b id="routeBadge">0</b></button></nav>
<div class="sheet-content"><div id="tripOffer" class="trip-offer" hidden><strong>朋友分享了一份續攤路線 🥂</strong><p>共有 <span id="tripOfferCount">0</span> 間酒吧。載入後會替換目前這台裝置的續攤清單；起點不會跟著分享。</p><div class="actions"><button class="btn btn-brand" id="tripAccept">載入行程</button><button class="btn" id="tripDismiss">忽略</button></div></div><section id="discoverPanel">
<div class="start-box"><div><small>今晚從哪裡出發？</small><strong id="startTitle">${esc(INN.name)}</strong><span id="startAddr">${esc(INN.address)}</span></div><button class="btn" id="changeStart">更換起點</button></div>
<div class="start-options" id="startOptions" hidden><div class="actions"><button class="btn" id="startInn">⌂ 民宿</button><button class="btn" id="startGps">◎ 目前位置</button><button class="btn" id="startPick">⌖ 地圖點選</button></div><div class="input-group"><input id="addressInput" placeholder="輸入地址、地名或座標…" aria-label="新的出發地"><button class="btn btn-brand" id="setAddress">設為起點</button></div></div>
<div class="hero-actions"><button class="hero-btn hero-near" id="nearBtn"><b>🚶 附近開喝</b><span>找附近有座標的酒吧</span></button><button class="hero-btn hero-random" id="randomBtn"><b>🎲 幫我選一間</b><span>按下就抽符合條件的店</span></button></div>
<div class="random-settings"><div class="random-header"><strong>🎲 抽店偏好</strong><span>抽籤與列表篩選互不影響</span></div><div class="random-controls"><label>範圍 <select id="randomScope"><option value="near">起點附近</option><option value="all">全臺南清單</option></select></label><label>類型 <select id="randomCategory"><option value="all">不限種類</option><option value="cocktail">🍸 調酒</option><option value="beer">🍺 啤酒</option><option value="bistro">🍽️ 餐酒</option></select></label></div><div class="random-checks"><label><input id="randomExcludeVisited" type="checkbox" checked>排除已去過</label><label><input id="randomExcludeRoute" type="checkbox" checked>排除已加入續攤</label></div><small>附近使用上方選擇的公里數，距離是直線估算。</small></div>
<div id="randomResult" hidden></div>
<div class="search-group"><label for="searchInput">搜尋酒吧</label><div class="search-bar"><span>⌕</span><input id="searchInput" autocomplete="off" placeholder="搜尋店名、街道、酒種…" aria-label="搜尋酒吧"><button id="searchClear" aria-label="清除搜尋" hidden>×</button></div></div>
<div class="filterrow"><button class="chip active" data-filter="all" id="filterAll">全部</button><button class="chip" data-filter="cocktail">🍸 調酒</button><button class="chip" data-filter="beer">🍺 啤酒</button><button class="chip" data-filter="bistro">🍽️ 餐酒</button><button class="chip" data-filter="favorite" id="btnFav">♡ 收藏</button></div>
<div class="sortrow"><label>範圍 <select id="radiusSelect"><option value="1">1 公里</option><option value="2">2 公里</option><option value="5">5 公里</option><option value="10">10 公里</option></select></label><label>排序 <select id="sortSelect"><option value="recommended">精選優先</option><option value="nearest">距離最近</option><option value="alpha">名稱排序</option></select></label></div>
<div class="section-title"><strong>值得去的酒吧</strong><span id="resultCount">— 間</span></div><p class="muted" id="nearState">清單會隨關鍵字與分類即時篩選</p>
<div id="results"></div><button class="btn load-more" id="loadMore" hidden>顯示更多</button>
<div class="more-source"><strong>還想探索其他酒吧？</strong><p id="publicInfo">先載入公開酒吧以顯示圖釘；也能對精選店家按「定位這間」儲存座標。</p><button class="btn btn-brand" id="morePublic">↻ 更新公開酒吧</button><a id="searchGoogle" href="https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8D%97%E5%B8%82%20%E9%85%92%E5%90%A7" target="_blank" rel="noopener noreferrer">Google 地圖找更多 ↗</a><small>公開資料來自 OSM／ArcGIS／Overpass，並非臺南所有營業酒吧；店家資訊請到 Google Maps 或官方網站核實。</small></div>
<div class="audit-panel"><div class="audit-title"><strong>🧭 座標品質自動比較</strong><small>OSM 原始點位 × 臺南市政府門牌</small></div><div id="auditSummary" aria-live="polite"></div><div class="actions"><button class="btn" id="auditToggle">查看座標比較</button><button class="btn btn-ghost" id="auditExport">下載比較 CSV</button></div><div id="auditDetails" hidden></div><p class="muted">系統比較的是<strong>資料證據的一致性</strong>，無法單靠兩個座標判定店家真正入口。疑似衝突時以門牌位置作為暫時參考，實際到店請用店名和地址向 Google Maps 核對。</p></div>
</section><section id="routePanel" hidden><div class="section-title"><strong>🥂 今晚的續攤路線</strong><span id="routeCount">0</span></div><p class="muted">按上／下調整順序，或依直線距離快速排序。</p><div class="route-actions"><a class="btn btn-brand" id="routeGo" target="_blank" rel="noopener noreferrer">🚶 Google Maps 步行導航</a><a class="btn" id="routeNext" target="_blank" rel="noopener noreferrer">導航下一站 ↗</a></div><div id="routeList"></div><div class="route-actions"><button class="btn" id="optimizeRoute">✨ 自動排序</button><button class="btn" id="shareRoute">🔗 分享可還原網址</button><button class="btn btn-brand" id="startNight">🍸 今晚開喝模式</button><button class="btn btn-ghost" id="clearRoute">清空</button></div><p class="muted" id="routeCaveat"></p></section></div>
</section></div>
<div class="sticky-route" id="stickyRoute" hidden><span>🥂 <b id="stickyCount">0 間酒吧</b> 已加入續攤</span><button id="goRoute">查看路線 ↗</button></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="modal-backdrop" id="venueModal" hidden role="presentation"><div class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detailTitle" tabindex="-1"><button class="dialog-close" id="detailClose" aria-label="關閉店家資訊">×</button><div id="detailContent"></div></div></div>
<div class="night-screen" id="nightScreen" hidden role="dialog" aria-modal="true" aria-label="今晚開喝模式"><div class="night-wrap"><header class="night-head"><div><small>TONIGHT'S BAR HOP</small><h2>今晚開喝 🍸</h2></div><button id="nightExit" class="night-close">退出模式 ×</button></header><div class="night-count" id="nightCounter">第 1 站</div><div class="night-progress" id="nightProgress"></div><div class="night-card"><span>目前目的地</span><h3 id="nightPlace"></h3><p id="nightLocation"></p><a id="nightNav" class="night-action" target="_blank" rel="noopener noreferrer">🚶 Google Maps 步行導航 ↗</a></div><p class="night-next" id="nightNextLabel"></p><div class="night-buttons"><button class="btn btn-brand" id="nightDone">✓ 完成這站・下一站</button><button class="btn" id="nightSkip">跳過這站</button><button class="btn" id="nightPrev">← 上一站</button></div><div class="night-home"><a id="nightReturn" target="_blank" rel="noopener noreferrer">⌂ 回到民宿步行導航 ↗</a><p>注意交通安全，請勿酒駕；喝酒後也可選擇搭車回程。若不舒服就停止飲酒並休息。</p></div></div></div>`}
build();
const map=new CanvasBarMap($('mapCanvas'),{center:INN,onSelect:data=>{
 if(data.type==='origin'&&state.pinTarget){const id=state.pinTarget;state.pinTarget=null;const v=findVenue(id);if(v&&window.confirm(getLanguage()==='en'?`Assign this map position to ${v.name}?\n(Please verify the actual location first.)`:`你要把此地圖位置指定為「${v.name}」嗎？\n（請先確認店家所在位置）`)){persistVenueCoord(id,data,'manual');toast('已儲存酒吧座標')}return}
 if(data.type==='origin'){state.pickMode=false;setStart({name:'地圖指定起點',address:`${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`,lat:data.lat,lng:data.lng,type:'map'});toast('已設定地圖起點');return}
 focus(data.venue);
},onStatus:msg=>{if(!state.loadMessage)$('publicInfo').textContent=msg}});
map.setOrigin(INN); updateDistanceLabel(); updateMap(); renderResults();renderRoute();renderRandom();renderAudit();

document.addEventListener('click',e=>{
 const m=e.target.closest('[data-move]');if(m){const i=Number(m.dataset.i);if(m.dataset.move==='delete')remove(i);else move(i,m.dataset.move==='up'?-1:1);return}
 const a=e.target.closest('[data-action]');if(a){const v=findVenue(a.dataset.id);if(!v)return;if(a.dataset.action==='add')add(v);if(a.dataset.action==='detail')showDetail(v);if(a.dataset.action==='focus')focus(v);if(a.dataset.action==='fav')toggleFavorite(v);if(a.dataset.action==='locate')locateVenue(v);if(a.dataset.action==='visited'){const key=idOf(v);state.visited.has(key)?state.visited.delete(key):state.visited.add(key);save();renderRoute()}return}
 const b=e.target.closest('[data-filter]');if(b){setFilter(b.dataset.filter)}
 const tab=e.target.closest('[data-view]');if(tab)showView(tab.dataset.view);
});
$('searchInput').addEventListener('input',e=>setSearch(e.target.value));
$('searchClear').onclick=()=>{state.search='';renderResults();$('searchInput').focus()};
$('radiusSelect').onchange=e=>{state.radius=e.target.value;renderResults()};
$('sortSelect').onchange=e=>{state.sorting=e.target.value;renderResults()};
$('nearBtn').onclick=showNear;$('randomBtn').onclick=randomPick;
$('randomScope').onchange=e=>{state.randomScope=e.target.value};
$('randomCategory').onchange=e=>{state.randomCategory=e.target.value};
$('randomExcludeVisited').onchange=e=>{state.randomExcludeVisited=e.target.checked};
$('randomExcludeRoute').onchange=e=>{state.randomExcludeRoute=e.target.checked};
$('detailClose').onclick=closeDetail;
$('venueModal').onclick=e=>{if(e.target===$('venueModal'))closeDetail()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('venueModal').hidden)closeDetail();else if(!$('nightScreen').hidden)closeNight()}});
$('startNight').onclick=openNight;
$('nightExit').onclick=closeNight;
$('nightDone').onclick=()=>nightAdvance(true);
$('nightSkip').onclick=()=>nightAdvance(false);
$('nightPrev').onclick=()=>{state.nightIndex=Math.max(0,state.nightIndex-1);renderNight()};
$('nightReturn').href='https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination:`${INN.name} ${INN.address}`,travelmode:'walking'});
$('tripAccept').onclick=loadIncoming;
$('tripDismiss').onclick=dismissIncoming;
state.incomingTrip=readIncomingTrip();if(state.incomingTrip){$('tripOfferCount').textContent=String(state.incomingTrip.length);$('tripOffer').hidden=false;}

$('morePublic').onclick=()=>loadOsm(true);
$('auditToggle').onclick=()=>{state.auditExpanded=!state.auditExpanded;renderAudit()};
$('auditExport').onclick=exportAuditCsv;
$('loadMore').onclick=()=>{state.show+=12;renderResults()};
$('changeStart').onclick=()=>{$('startOptions').hidden=!$('startOptions').hidden};
$('startShortcut').onclick=()=>{showView('discover');$('startOptions').hidden=false;$('startOptions').scrollIntoView({block:'nearest',behavior:'smooth'})};
$('startInn').onclick=()=>{setStart({...INN,type:'inn'});$('startOptions').hidden=true;toast('已切回民宿起點')};
$('startGps').onclick=()=>{if(!navigator.geolocation)return toast('瀏覽器不支援定位');toast('正在取得目前位置…');navigator.geolocation.getCurrentPosition(p=>{setStart({name:'我的目前位置',lat:p.coords.latitude,lng:p.coords.longitude,address:`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`,type:'gps'});$('startOptions').hidden=true;toast('已設定目前位置')},()=>toast('定位失敗，請檢查位置權限'),{enableHighAccuracy:false,timeout:11000,maximumAge:60000})};
$('startPick').onclick=()=>{state.pinTarget=null;state.pickMode=true;map.setPickMode(true);toast('請在地圖上點一下設定起點');if(window.innerWidth<800)window.scrollTo({top:0,behavior:'smooth'})};
$('setAddress').onclick=fromAddress;$('addressInput').onkeydown=e=>{if(e.key==='Enter')fromAddress()};
$('homeMap').onclick=()=>{map.setCenter(hasCoords(state.origin)?state.origin:INN);map.setZoom(15)};
$('zoomIn').onclick=()=>map.setZoom(map.zoom+1);$('zoomOut').onclick=()=>map.setZoom(map.zoom-1);
$('optimizeRoute').onclick=routeOptimize;$('shareRoute').onclick=shareTrip;
$('clearRoute').onclick=()=>{if(state.route.length&&confirm(getLanguage()==='en'?'Clear tonight’s entire route?':'要清空今晚的續攤路線嗎？')){state.route=[];save();renderRoute();renderResults();updateRouteMap()}};
$('goRoute').onclick=()=>{showView('route');if(window.innerWidth<800)$('sheet').scrollIntoView({behavior:'smooth',block:'start'})};
$('sheetToggle').onclick=()=>{const collapsed=$('sheet').classList.toggle('collapsed');state.sheet=collapsed?'peek':'full'};
// Cached public coordinates render immediately. If no snapshot exists, load real OSM-based source once.
loadOsm(false);

/* v7.0 手機底部導覽：地圖／探索／續攤／今晚 */
const navBtns=[...document.querySelectorAll('.bottomnav [data-tab]')];
function setNavActive(tab){navBtns.forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')})}
function showSheetFull(){if(window.innerWidth<800){$('sheet').classList.remove('collapsed');state.sheet='full';$('sheet').scrollIntoView({behavior:'smooth',block:'start'})}}
navBtns.forEach(btn=>btn.addEventListener('click',()=>{
  const tab=btn.dataset.tab;
  if(tab==='map'){setNavActive('map');document.body.classList.add('map-only');window.scrollTo({top:0,behavior:'smooth'});return}
  if(tab==='night'){if(!state.route.length){toast('請先加入至少一間酒吧到續攤');return}document.body.classList.remove('map-only');setNavActive('night');openNight();return}
  document.body.classList.remove('map-only');setNavActive(tab);showView(tab==='route'?'route':'discover');showSheetFull();
}));
new MutationObserver(()=>{
  if(!document.body.classList.contains('night-open')&&navBtns.some(b=>b.dataset.tab==='night'&&b.classList.contains('active')))setNavActive(state.view==='route'?'route':'discover');
}).observe(document.body,{attributes:true,attributeFilter:['class']});
/* v7.1.3: changing #admin on an already-open page must also work. */
function syncAdminHash(){document.body.classList.toggle('admin',location.hash==='#admin')}
window.addEventListener('hashchange',syncAdminHash);
syncAdminHash();

// Translation observes interface updates, including late OSM and audit results.
installLanguage();
