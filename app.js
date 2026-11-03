import {INN,CURATED} from './data.js?v=6.0.0';
import {CanvasBarMap} from './map.js?v=6.0.0';

const VERSION='JS v6.0';
const STORE='tainan-bar-hop-js-v6';
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
const copyVenue=v=>({id:v.id,name:v.name,address:v.address,category:v.category,lat:v.lat,lng:v.lng,source:v.source});
const getLocal=(k,def)=>{try{return JSON.parse(localStorage.getItem(k))??def}catch{return def}};
const persisted=getLocal(STORE,{});
const old=getLocal('tainan-bar-hop-js-v5',{});
const state={
  origin:{...INN,type:'inn'},
  venues:CURATED.map(v=>({...v})),
  osm:[], route:(persisted.route||old.route||[]).map(x=>({...x})),
  fav:new Set(persisted.fav||old.favorite||[]),
  visited:new Set(persisted.visited||old.visited||[]),
  view:'discover', filter:'all', search:'', radius:'2', show:12,
  sorting:'recommended', nearby:false, selected:null,
  sheet:'peek', loading:false, loaded:false, loadMessage:'',
  pickMode:false, random:null
};
function save(){try{localStorage.setItem(STORE,JSON.stringify({route:state.route,fav:[...state.fav],visited:[...state.visited]}))}catch{}}
function googlePlace(v){return 'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:`${v.name} ${v.address||'臺南市'}`})}
function googleSearch(query){return 'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:query||'臺南 酒吧'})}
function dest(v){return hasCoords(v)?coordsStr(v):`${v.name} ${v.address||'臺南市'}`}
function navUrl(arr){if(!arr.length)return '#';const params=new URLSearchParams({api:'1',destination:dest(arr[arr.length-1]),travelmode:'walking'});if(state.origin.type!=='gps')params.set('origin',hasCoords(state.origin)?coordsStr(state.origin):state.origin.address);if(arr.length>1)params.set('waypoints',arr.slice(0,-1).map(dest).join('|'));return 'https://www.google.com/maps/dir/?'+params}
function toast(txt){const el=$('toast');el.textContent=txt;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200)}
function routeHas(v){return state.route.some(p=>idOf(p)===idOf(v))}
function distance(v){return kmBetween(state.origin,v)}
function updateDistanceLabel(){const origin=state.origin;$('startTitle').textContent=origin.name;$('startAddr').textContent=origin.address||'地圖所選座標';$('mapOrigin').textContent=origin.name;$('startShortcut').textContent=origin.type==='inn'?'民宿起點':origin.name;}
function setStart(p){state.origin={...p};updateDistanceLabel();map.setOrigin(p);if(hasCoords(p)){if(p.lat>22.75&&p.lat<23.3&&p.lng>120.0&&p.lng<120.55)map.setCenter(p)}renderResults()}
function updateMap(){const pts=state.venues.filter(hasCoords);map.setPoints(pts);map.setRoute(state.route.filter(hasCoords).map((v,i)=>({...v,routeIndex:state.route.indexOf(v)+1||i+1})));$('pinCount').textContent=`${pts.length} 個已定位點位`}
function updateRouteMap(){map.setRoute(state.route.filter(hasCoords).map(v=>({...v,routeIndex:state.route.indexOf(v)+1})));}
function add(v){if(routeHas(v)){toast('這間已經在續攤清單了');return}state.route.push(copyVenue(v));save();renderRoute();renderResults();renderRandom();updateRouteMap();toast('已加入續攤：'+v.name)}
function remove(i){state.route.splice(i,1);save();renderRoute();renderResults();updateRouteMap()}
function move(i,d){let j=i+d;if(j<0||j>=state.route.length)return;[state.route[i],state.route[j]]=[state.route[j],state.route[i]];save();renderRoute();updateRouteMap()}
function routeOptimize(){const items=state.route.slice(), ordered=[];let here=state.origin;while(items.length){let index=-1,best=Infinity;items.forEach((p,i)=>{const d=distanceFrom(here,p);if(d!=null&&d<best){best=d;index=i}});if(index===-1)index=0;const [v]=items.splice(index,1);ordered.push(v);if(hasCoords(v))here=v}state.route=ordered;save();renderRoute();updateRouteMap();toast('已依直線距離安排；實際步行請以導航為準')}
function distanceFrom(a,b){return kmBetween(a,b)}
function toggleFavorite(v){const key=idOf(v);state.fav.has(key)?state.fav.delete(key):state.fav.add(key);save();renderResults();renderRandom();renderRoute()}
function findVenue(id){return state.venues.find(x=>x.id===id)||state.route.find(x=>x.id===id)}
function focus(v){if(!hasCoords(v)){toast('這間店尚未核對座標，可點「Google 地圖查店家」');return}map.setCenter(v);map.setZoom(16);map.setHighlight(v.id);state.selected=v;$('mapVenue').hidden=false;$('mapVenue').innerHTML=`<strong>${esc(v.name)}</strong><p>${esc(v.address||'依 OSM 地圖點位')}</p><div class="actions"><button class="btn btn-brand" id="pinAdd">＋ 加入續攤</button><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(navUrl([v]))}">步行導航 ↗</a><button class="btn btn-ghost" id="pinClose">×</button></div>`;$('pinAdd').onclick=()=>add(v);$('pinClose').onclick=()=>{$('mapVenue').hidden=true;map.setHighlight(null)}}
function matches(){const q=normal(state.search);let all=state.venues.filter(v=>(state.filter==='all'||(state.filter==='favorite'?state.fav.has(idOf(v)):state.filter===v.category))&&(!q||searchString(v).includes(q)));
  if(state.nearby){const radius=Number(state.radius)||2;all=all.filter(v=>{const d=distance(v);return d!==null&&d<=radius});}
  if(state.sorting==='nearest'||state.nearby){all.sort((a,b)=>(distance(a)??Infinity)-(distance(b)??Infinity)||a.name.localeCompare(b.name,'zh-Hant'))}
  else if(state.sorting==='alpha')all.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
  else all.sort((a,b)=>(a.source==='curated'?0:1)-(b.source==='curated'?0:1));
  return all;
}
function venueCard(v){const d=distance(v),isPinned=hasCoords(v),fav=state.fav.has(idOf(v)),added=routeHas(v);
  return `<article class="venue" data-venue="${esc(v.id)}">
   <div class="venue-main"><div class="ven-head"><h3>${esc(v.name)}</h3><span class="source">${v.source==='curated'?'精選':'OSM'}</span></div>
     <p class="ven-address">📍 ${esc(v.address||'臺南市・位置依 OSM 標記')}</p>
     <div class="tags"><span>${esc(label[v.category]||'🍸 酒吧')}</span><span>${isPinned?`約 ${kmText(d)}・直線距離`:'尚未確認座標'}</span></div>
   </div>
   <div class="venue-actions"><button class="btn btn-brand" data-action="add" data-id="${esc(v.id)}">${added?'✓ 已加入':'＋ 續攤'}</button>
   ${isPinned?`<button class="btn" data-action="focus" data-id="${esc(v.id)}">地圖定位</button>`:''}
   <a class="btn" href="${esc(googlePlace(v))}" target="_blank" rel="noopener noreferrer">Google 查店家 ↗</a>
   <button class="btn btn-icon ${fav?'favorited':''}" aria-label="${fav?'取消收藏':'收藏'}" data-action="fav" data-id="${esc(v.id)}">${fav?'♥':'♡'}</button></div></article>`
}
function renderResults(){const found=matches();$('resultCount').textContent=`${found.length} 間`;const shown=found.slice(0,state.show);
  $('results').innerHTML=shown.map(venueCard).join('')||`<div class="empty"><strong>${state.nearby?'附近目前沒有已確認座標的店家':'沒有符合搜尋的酒吧'}</strong><p>${state.nearby?'可擴大範圍或載入更多公開點位；尚未定位的精選店家不會被錯當成附近店家。':'試試換個關鍵字，或搜尋 Google Maps 的其他酒吧。'}</p></div>`;
  $('loadMore').hidden=found.length<=state.show;
  $('searchClear').hidden=!state.search;
  $('searchGoogle').href=googleSearch(state.search?state.search+' 臺南':'臺南市 酒吧');
  $('searchGoogle').textContent=state.search?'在 Google 地圖搜尋「'+state.search.slice(0,22)+'」 ↗':'Google 地圖找更多 ↗';
  $('nearState').textContent=state.nearby?`已確認 ${found.length} 間在 ${state.radius} km 內；僅包含有座標的點位`:'清單會隨關鍵字與分類即時篩選';
  $('nearBtn').classList.toggle('active',state.nearby);
  $('searchInput').value=state.search;
  $('filterAll').classList.toggle('active',state.filter==='all');
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  $('morePublic').textContent=state.loading?'正在載入公開酒吧…':state.loaded?'↻ 更新 OSM 酒吧點位':'＋ 搜尋更多公開酒吧';
  $('morePublic').disabled=state.loading;
  $('publicInfo').textContent=state.loadMessage||'精選名單可離線搜尋；公開酒吧須連網載入，資料可能不完整。';
  $('btnFav').classList.toggle('active',state.filter==='favorite');
  $('radiusSelect').value=state.radius;
  $('sortSelect').value=state.sorting;
  $('routeCount').textContent=state.route.length;
}
function renderRoute(){const r=state.route;$('routeBadge').textContent=r.length;$('routeCount').textContent=r.length;
  $('routeList').innerHTML=r.length?r.map((v,i)=>`<div class="stop"><span class="stop-index">${i+1}</span><div class="stop-main"><b>${esc(v.name)}</b><small>${esc(v.address||'臺南市')} ${hasCoords(v)?'・約 '+kmText(distance(v)):''}</small><div class="stop-actions"><a href="${esc(navUrl([v]))}" target="_blank" rel="noopener noreferrer">導航這站 ↗</a><button data-action="visited" data-id="${esc(v.id)}">${state.visited.has(idOf(v))?'✓ 已到過':'標記已到'}</button></div></div><div class="stop-controls"><button data-move="up" data-i="${i}" aria-label="上移" ${i===0?'disabled':''}>↑</button><button data-move="down" data-i="${i}" aria-label="下移" ${i===r.length-1?'disabled':''}>↓</button><button data-move="delete" data-i="${i}" aria-label="移除">×</button></div></div>`).join(''):'<div class="empty"><strong>還沒選今晚要去的店家</strong><p>在探索頁按「＋ 續攤」，就能建立路線。</p></div>';
  const first=r.slice(0,4),next=r.find(v=>!state.visited.has(idOf(v)))||r[0];$('routeGo').href=r.length?navUrl(first):'#';$('routeGo').classList.toggle('disabled',!r.length);$('routeNext').href=next?navUrl([next]):'#';$('routeNext').classList.toggle('disabled',!next);$('routeCaveat').textContent=r.length>4?'手機 Google Maps 單次只帶入前四站，其餘可逐站導航。':'地圖上的連線是直線示意，不是實際步行路徑。導航請以 Google Maps 為準。';
  $('stickyRoute').hidden=!r.length; $('stickyCount').textContent=`${r.length} 間酒吧`;}
function renderRandom(){const root=$('randomResult');if(!state.random){root.hidden=true;return}const v=state.random;root.hidden=false;root.innerHTML=`<div class="lucky-result"><span class="small">✨ 今晚喝這間</span><h3>${esc(v.name)}</h3><p>${esc(v.address||'臺南市')}</p><div class="actions"><button class="btn btn-brand" id="randomAdd">＋ 加入續攤</button><a href="${esc(navUrl([v]))}" class="btn" target="_blank" rel="noopener noreferrer">步行導航 ↗</a><button class="btn" id="randomAgain">再抽一次</button></div></div>`;$('randomAdd').onclick=()=>add(v);$('randomAgain').onclick=randomPick;}
function randomPick(){const arr=state.venues.filter(v=>!state.visited.has(idOf(v))&&(state.filter==='all'||(state.filter==='favorite'&&state.fav.has(idOf(v)))||v.category===state.filter));const near=arr.filter(v=>distance(v)!=null&&distance(v)<=Number(state.radius));const pool=state.nearby&&near.length?near:(arr.length?arr:state.venues);
  state.random=pool[Math.floor(Math.random()*pool.length)];renderRandom();if(state.nearby&&!near.length)toast('附近定位點位不足，本次從清單隨機挑選');}
function showView(view){state.view=view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-selected',String(b.dataset.view===view))});$('discoverPanel').hidden=view!=='discover';$('routePanel').hidden=view!=='route';if(view==='discover')renderResults();else renderRoute();if(window.innerWidth<800){$('sheet').classList.remove('collapsed');state.sheet='full'} }
function setSearch(s){state.search=s;state.show=12;if(state.filter==='favorite'&&s)state.filter='all';if(state.nearby&&s)state.nearby=false;renderResults();}
function setFilter(f){state.filter=f;state.show=12;renderResults()}
function showNear(){state.nearby=!state.nearby;state.sorting='nearest';state.filter='all';state.search='';state.show=16;showView('discover');renderResults();if(state.nearby&&state.osm.length===0)loadOsm();}
function updateOsm(venues){state.osm=venues;const all=CURATED.map(v=>({...v}));const loose=n=>normal(n).replace(/^(bar|the)/,'');for(const o of venues){let match=all.find(c=>{const a=loose(c.name),b=loose(o.name);return a===b||(b.length>=5&&a.includes(b))||(a.length>=5&&b.includes(a))});if(match&&!hasCoords(match)){match.lat=o.lat;match.lng=o.lng;match.coordsSource='osm'}else if(!match)all.push(o)}state.venues=all;updateMap();renderResults();renderRoute()}
function parseOsm(elements){const seen=new Set(),out=[];for(const e of elements){const t=e.tags||{};const name=t['name:zh']||t.name||t['name:en'];const lat=Number(e.lat??e.center?.lat),lng=Number(e.lon??e.center?.lon);if(!name||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<22.8||lat>23.55||lng<119.95||lng>120.85)continue;const n=normal(name);if(seen.has(n))continue;seen.add(n);const address=['臺南市',t['addr:district'],t['addr:street'],t['addr:housenumber']].filter(Boolean).join('')||'臺南市';const category=/beer|brew|bier|啤酒|精釀/i.test(name+' '+(t.description||''))||t.amenity==='biergarten'?'beer':/餐酒|bistro/i.test(name)?'bistro':'cocktail';out.push({id:`osm-${e.type}-${e.id}`,name,lat,lng,address,category,desc:'OpenStreetMap 公開標記，營業資訊需確認',source:'osm'})}return out.slice(0,450)}
const OSM_QUERY='[out:json][timeout:20];(nwr["amenity"~"^(bar|pub|biergarten)$"](22.90,120.11,23.12,120.37););out center tags;';
async function loadOsm(force=false){if(state.loading)return;state.loading=true;state.loadMessage='正在查詢 OSM 公開酒吧點位（需要網路）…';renderResults();if(!force){const cached=getLocal('tainan-bar-hop-osm-v6',null);if(cached&&Date.now()-cached.at<12*3600000&&Array.isArray(cached.elements)){updateOsm(parseOsm(cached.elements));state.loading=false;state.loaded=true;state.loadMessage=`已載入 ${state.osm.length} 個公開點位（暫存）`;renderResults();return}}
  const endpoints=['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];let error='';for(const url of endpoints){const c=new AbortController(),time=setTimeout(()=>c.abort(),12000);try{const res=await fetch(url,{method:'POST',body:new URLSearchParams({data:OSM_QUERY}),signal:c.signal});if(!res.ok)throw Error('HTTP '+res.status);const json=await res.json();if(!Array.isArray(json.elements))throw Error('無效資料');try{localStorage.setItem('tainan-bar-hop-osm-v6',JSON.stringify({at:Date.now(),elements:json.elements}))}catch{}updateOsm(parseOsm(json.elements));state.loaded=true;state.loadMessage=`已載入 ${state.osm.length} 個公開點位（部分店家可能已歇業）`;state.loading=false;renderResults();toast(`載入 ${state.osm.length} 個公開酒吧點位`);return}catch(e){error=String(e.message||e)}finally{clearTimeout(time)}}state.loading=false;state.loadMessage='公開點位服務暫時無法連線；精選酒吧搜尋仍可用，或改用 Google Maps。';renderResults();toast('OSM 連線失敗：請稍後重試')}
async function fromAddress(){const text=$('addressInput').value.trim();if(!text){toast('請輸入地址、地名或經緯度');return}const m=text.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)$/)||text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);if(m){const lat=+m[1],lng=+m[2];if(Math.abs(lat)>90||Math.abs(lng)>180)return toast('座標超出範圍');setStart({name:'自訂起點',address:`${lat}, ${lng}`,lat,lng,type:'custom'});$('startOptions').hidden=true;return}if(/maps\.app\.goo\.gl/i.test(text)){toast('Google 短網址無法直接解析，請輸入地址或座標');return}const btn=$('setAddress');btn.disabled=true;btn.textContent='查詢中…';let p={name:text,address:text,type:'custom'};const c=new AbortController(),t=setTimeout(()=>c.abort(),7500);try{const q=/(台南|臺南)/.test(text)?text:`${text} 臺南市`;const res=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'json',limit:3,'accept-language':'zh-TW'}),{signal:c.signal});if(!res.ok)throw Error('no');const arr=await res.json();if(arr.length){p.lat=Number(arr[0].lat);p.lng=Number(arr[0].lon)}else toast('地址已用於導航，但地圖找不到精確位置')}catch{toast('地址已用於導航，地圖未確認座標')}finally{clearTimeout(t);btn.disabled=false;btn.textContent='設為起點'}setStart(p);$('startOptions').hidden=true;}
function shareRoute(){if(!state.route.length)return toast('請先加入酒吧');const txt='🍸 府城微醺地圖｜今晚續攤\n起點：'+(state.origin.address||state.origin.name)+'\n'+state.route.map((v,i)=>`${i+1}. ${v.name}｜${v.address}`).join('\n')+'\n'+navUrl(state.route.slice(0,4));if(navigator.share){navigator.share({title:'府城微醺地圖',text:txt}).catch(()=>{});return}if(navigator.clipboard){navigator.clipboard.writeText(txt).then(()=>toast('已複製續攤清單')).catch(()=>toast('無法複製'))}else toast('此瀏覽器不支援分享')}
function build(){ $('app').innerHTML=`
<header class="topbar"><div><div class="eyebrow">● TAINAN AFTER DARK <span class="version">${VERSION}</span></div><h1>府城<span>微醺</span>地圖 <i>🍸</i></h1><p>選一間好酒吧，讓夜晚自然開始。</p></div><button class="start-chip" id="startShortcut">民宿起點</button></header>
<div class="layout">
<main class="maparea" id="mapArea"><canvas id="mapCanvas" aria-label="臺南互動地圖，拖曳瀏覽、點圖釘選酒吧" ></canvas><div class="map-status"><strong>📍 <span id="mapOrigin">${esc(INN.name)}</span></strong><small id="pinCount">0 個已定位點位</small></div><div class="map-controls"><button id="homeMap" aria-label="返回起點">⌂</button><button id="zoomIn" aria-label="放大">＋</button><button id="zoomOut" aria-label="縮小">－</button></div><div class="map-venue" id="mapVenue" hidden></div><div class="attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></div></main>
<section class="sheet" id="sheet"><button class="sheet-grip" id="sheetToggle" aria-label="展開或收合酒吧清單"><span></span></button><nav class="tabs"><button class="tab active" data-view="discover" aria-selected="true">🗺️ 探索酒吧</button><button class="tab" data-view="route" aria-selected="false">🥂 我的續攤 <b id="routeBadge">0</b></button></nav>
<div class="sheet-content"><section id="discoverPanel">
<div class="start-box"><div><small>今晚從哪裡出發？</small><strong id="startTitle">${esc(INN.name)}</strong><span id="startAddr">${esc(INN.address)}</span></div><button class="btn" id="changeStart">更換起點</button></div>
<div class="start-options" id="startOptions" hidden><div class="actions"><button class="btn" id="startInn">⌂ 民宿</button><button class="btn" id="startGps">◎ 目前位置</button><button class="btn" id="startPick">⌖ 地圖點選</button></div><div class="input-group"><input id="addressInput" placeholder="輸入地址、地名或座標…" aria-label="新的出發地"><button class="btn btn-brand" id="setAddress">設為起點</button></div></div>
<div class="hero-actions"><button class="hero-btn hero-near" id="nearBtn"><b>🚶 附近開喝</b><span>找附近有座標的酒吧</span></button><button class="hero-btn hero-random" id="randomBtn"><b>🎲 幫我選一間</b><span>不用猶豫，今晚開喝</span></button></div>
<div id="randomResult" hidden></div>
<div class="search-group"><label for="searchInput">搜尋酒吧</label><div class="search-bar"><span>⌕</span><input id="searchInput" autocomplete="off" placeholder="搜尋店名、街道、酒種…" aria-label="搜尋酒吧"><button id="searchClear" aria-label="清除搜尋" hidden>×</button></div></div>
<div class="filterrow"><button class="chip active" data-filter="all" id="filterAll">全部</button><button class="chip" data-filter="cocktail">🍸 調酒</button><button class="chip" data-filter="beer">🍺 啤酒</button><button class="chip" data-filter="bistro">🍽️ 餐酒</button><button class="chip" data-filter="favorite" id="btnFav">♡ 收藏</button></div>
<div class="sortrow"><label>範圍 <select id="radiusSelect"><option value="1">1 公里</option><option value="2">2 公里</option><option value="5">5 公里</option><option value="10">10 公里</option></select></label><label>排序 <select id="sortSelect"><option value="recommended">精選優先</option><option value="nearest">距離最近</option><option value="alpha">名稱排序</option></select></label></div>
<div class="section-title"><strong>值得去的酒吧</strong><span id="resultCount">— 間</span></div><p class="muted" id="nearState">清單會隨關鍵字與分類即時篩選</p>
<div id="results"></div><button class="btn load-more" id="loadMore" hidden>顯示更多</button>
<div class="more-source"><strong>還想探索其他酒吧？</strong><p id="publicInfo">精選名單可離線搜尋；公開酒吧須連網載入。</p><button class="btn btn-brand" id="morePublic">＋ 搜尋更多公開酒吧</button><a id="searchGoogle" href="https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8D%97%E5%B8%82%20%E9%85%92%E5%90%A7" target="_blank" rel="noopener noreferrer">Google 地圖找更多 ↗</a><small>公開資料來自 OSM／Overpass，並非臺南所有營業酒吧；店家資訊請到 Google Maps 或官方網站核實。</small></div>
</section><section id="routePanel" hidden><div class="section-title"><strong>🥂 今晚的續攤路線</strong><span id="routeCount">0</span></div><p class="muted">按上／下調整順序，或依直線距離快速排序。</p><div class="route-actions"><a class="btn btn-brand" id="routeGo" target="_blank" rel="noopener noreferrer">🚶 Google Maps 步行導航</a><a class="btn" id="routeNext" target="_blank" rel="noopener noreferrer">導航下一站 ↗</a></div><div id="routeList"></div><div class="route-actions"><button class="btn" id="optimizeRoute">✨ 自動排序</button><button class="btn" id="shareRoute">分享清單</button><button class="btn btn-ghost" id="clearRoute">清空</button></div><p class="muted" id="routeCaveat"></p></section></div>
</section></div>
<div class="sticky-route" id="stickyRoute" hidden><span>🥂 <b id="stickyCount">0 間酒吧</b> 已加入續攤</span><button id="goRoute">查看路線 ↗</button></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`}
build();
const map=new CanvasBarMap($('mapCanvas'),{center:INN,onSelect:data=>{
 if(data.type==='origin'){state.pickMode=false;setStart({name:'地圖指定起點',address:`${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`,lat:data.lat,lng:data.lng,type:'map'});toast('已設定地圖起點');return}
 focus(data.venue);
},onStatus:msg=>{if(!state.loadMessage)$('publicInfo').textContent=msg}});
map.setOrigin(INN); updateDistanceLabel(); updateMap(); renderResults();renderRoute();renderRandom();

document.addEventListener('click',e=>{
 const m=e.target.closest('[data-move]');if(m){const i=Number(m.dataset.i);if(m.dataset.move==='delete')remove(i);else move(i,m.dataset.move==='up'?-1:1);return}
 const a=e.target.closest('[data-action]');if(a){const v=findVenue(a.dataset.id);if(!v)return;if(a.dataset.action==='add')add(v);if(a.dataset.action==='focus')focus(v);if(a.dataset.action==='fav')toggleFavorite(v);if(a.dataset.action==='visited'){const key=idOf(v);state.visited.has(key)?state.visited.delete(key):state.visited.add(key);save();renderRoute()}return}
 const b=e.target.closest('[data-filter]');if(b){setFilter(b.dataset.filter)}
 const tab=e.target.closest('[data-view]');if(tab)showView(tab.dataset.view);
});
$('searchInput').addEventListener('input',e=>setSearch(e.target.value));
$('searchClear').onclick=()=>{state.search='';renderResults();$('searchInput').focus()};
$('radiusSelect').onchange=e=>{state.radius=e.target.value;renderResults()};
$('sortSelect').onchange=e=>{state.sorting=e.target.value;renderResults()};
$('nearBtn').onclick=showNear;$('randomBtn').onclick=randomPick;
$('morePublic').onclick=()=>loadOsm(true);
$('loadMore').onclick=()=>{state.show+=12;renderResults()};
$('changeStart').onclick=()=>{$('startOptions').hidden=!$('startOptions').hidden};
$('startShortcut').onclick=()=>{$('startOptions').hidden=false;showView('discover');$('startOptions').scrollIntoView({block:'nearest',behavior:'smooth'})};
$('startInn').onclick=()=>{setStart({...INN,type:'inn'});$('startOptions').hidden=true;toast('已切回民宿起點')};
$('startGps').onclick=()=>{if(!navigator.geolocation)return toast('瀏覽器不支援定位');toast('正在取得目前位置…');navigator.geolocation.getCurrentPosition(p=>{setStart({name:'我的目前位置',lat:p.coords.latitude,lng:p.coords.longitude,address:`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`,type:'gps'});$('startOptions').hidden=true;toast('已設定目前位置')},()=>toast('定位失敗，請檢查位置權限'),{enableHighAccuracy:false,timeout:11000,maximumAge:60000})};
$('startPick').onclick=()=>{state.pickMode=true;map.setPickMode(true);toast('請在地圖上點一下設定起點');if(window.innerWidth<800)window.scrollTo({top:0,behavior:'smooth'})};
$('setAddress').onclick=fromAddress;$('addressInput').onkeydown=e=>{if(e.key==='Enter')fromAddress()};
$('homeMap').onclick=()=>{map.setCenter(hasCoords(state.origin)?state.origin:INN);map.setZoom(15)};
$('zoomIn').onclick=()=>map.setZoom(map.zoom+1);$('zoomOut').onclick=()=>map.setZoom(map.zoom-1);
$('optimizeRoute').onclick=routeOptimize;$('shareRoute').onclick=shareRoute;
$('clearRoute').onclick=()=>{if(state.route.length&&confirm('要清空今晚的續攤路線嗎？')){state.route=[];save();renderRoute();renderResults();updateRouteMap()}};
$('goRoute').onclick=()=>showView('route');
$('sheetToggle').onclick=()=>{const collapsed=$('sheet').classList.toggle('collapsed');state.sheet=collapsed?'peek':'full'};
// Verify cached data if available, without silently hitting Overpass on startup.
const cached=getLocal('tainan-bar-hop-osm-v6',null);
if(cached&&Date.now()-cached.at<12*3600000&&Array.isArray(cached.elements)){
  updateOsm(parseOsm(cached.elements));state.loaded=true;state.loadMessage=`已有 ${state.osm.length} 個公開酒吧點位快取，可按更新重新取得`;renderResults();
}
