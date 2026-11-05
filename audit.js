/** TainanBarHop coordinate evidence: preserve both independent coordinates.
 * City doorplate data gives a reference address, NOT a surveyed bar entrance.
 * An OSM POI is another evidence point, NOT automatically ground truth.
 */
const DISTRICTS=['中西區','北區','東區','南區','安平區','安南區','永康區'];
const area=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=22.75&&p.lat<=23.55&&p.lng>=119.95&&p.lng<=120.85;
export function normalizeName(x){return String(x||'').normalize('NFKC').toLowerCase().replace(/臺/g,'台').replace(/赤崁/g,'赤嵌').replace(/[\s.,，。・()（）_\-‧·:：]/g,'').replace(/^(bar|the)/,'')}
export function normalizeAddress(a){
 let s=String(a||'').normalize('NFKC').replace(/臺/g,'台').replace(/赤崁/g,'赤嵌').replace(/[‐‑–—－]/g,'-').replace(/\s/g,'');
 const chinese={'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10'};
 s=s.replace(/([一二三四五六七八九十])(?=段)/g,m=>chinese[m]);
 s=s.replace(/(\d+)號之(\d+)/g,'$1-$2號').replace(/(\d+)之(\d+)號/g,'$1-$2號');
 s=s.replace(/^(?:台南市)+/g,'');
 s=s.replace(/(\d+(?:-\d+)?號)(?:\d+樓.*|地下.*|[\(（].*)$/,'$1');
 return s;
}
export function meters(a,b){if(!area(a)||!area(b))return null;const R=6371000,r=Math.PI/180,da=(b.lat-a.lat)*r,db=(b.lng-a.lng)*r;const v=Math.sin(da/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(db/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(v)))}
let sharedWorker=null;
let requestSeq=0;
const pendingRequests=new Map();
function worker(){
 if(sharedWorker)return sharedWorker;
 if(typeof Worker==='undefined')throw Error('此瀏覽器不支援背景比對，但原有精選門牌仍可使用');
 const w=new Worker(new URL('./audit-worker.js?v=7.1.3',import.meta.url),{type:'module'});
 w.onmessage=ev=>{const x=ev.data||{},p=pendingRequests.get(x.id);if(!p)return;clearTimeout(p.t);pendingRequests.delete(x.id);if(x.error)p.reject(new Error(x.error));else p.resolve(x.matches||{})};
 w.onerror=e=>{for(const p of pendingRequests.values()){clearTimeout(p.t);p.reject(new Error('門牌比對背景程式無法啟動'))}pendingRequests.clear();sharedWorker=null;w.terminate()};
 sharedWorker=w;return w;
}
export function loadDoorplateIndex(venues=[]){
 const id=++requestSeq,w=worker();
 const list=venues.map(v=>({id:v.id,name:v.name,address:v.address,lat:v.lat,lng:v.lng,source:v.source,osmPosition:v.osmPosition||{lat:v.lat,lng:v.lng}}));
 return new Promise((resolve,reject)=>{
  const t=setTimeout(()=>{pendingRequests.delete(id);reject(new Error('門牌資料讀取逾時'))},55000);
  pendingRequests.set(id,{resolve,reject,t});w.postMessage({id,list});
 });
}
export function officialReference(venue,index){
 if(index?.lookup){const hit=index.lookup[venue.id];if(hit)return hit;}
 if(venue.source==='curated'&&venue.officialPosition&&area(venue.officialPosition))return {...venue.officialPosition,match:'exact',evidence:'內建精選門牌'};
 const addr=normalizeAddress(venue.address);
 if(!index?.entries||!addr.includes('號')||!/(?:路|街|大道)/.test(addr))return null;
 const district=DISTRICTS.find(d=>addr.startsWith(d));
 const candidates=district?[district+addr.slice(district.length)]:DISTRICTS.map(d=>d+addr);
 const hits=[];
 for(const k of candidates){const p=index.entries[k];if(p&&p[3]<=30)hits.push({lat:p[0],lng:p[1],match:district?'exact':'district-inferred',evidence:'114年臺南市門牌坐標',spread:p[3],key:k});}
 if(hits.length!==1)return null;
 const candidate=hits[0];
 if(candidate.match==='district-inferred'){
  const gap=meters(candidate,venue.osmPosition||venue);
  if(gap===null||gap>150)return null;
 }
 return candidate;
}
export function evaluateVenue(venue,index){
 const official=officialReference(venue,index);
 const osm=area(venue.osmPosition)?{lat:venue.osmPosition.lat,lng:venue.osmPosition.lng}:venue.source==='osm'&&area(venue)?{lat:venue.lat,lng:venue.lng}:null;
 const manual=venue.coordsSource==='user-manual'&&area(venue)?{lat:venue.lat,lng:venue.lng}:null;
 const delta=official&&osm?meters(official,osm):null;
 let category,chosen,reason,quality,choice;
 if(manual){category='manual';chosen=manual;quality='自行確認';choice='manual';reason='使用者先前手動設定位置；保留兩套公開來源供比對';}
 else if(official&&osm&&delta<=30){category='aligned';chosen=osm;quality='雙來源相近';choice='osm';reason=`OSM 店家圖釘與門牌參考點相差 ${Math.round(delta)} 公尺；採用 OSM 圖釘（可能更接近店面，但未證實是入口）`;}
 else if(official&&osm){category=delta>100?'conflict':'review';chosen=official;quality='位置待複核';choice='doorplate';reason=`兩來源相差 ${Math.round(delta)} 公尺，先採用門牌參考點；可能是入口偏移、錯誤標記或店家搬遷，請核對店家`;}
 else if(official){category='doorplate-only';chosen=official;quality=official.match==='exact'?'門牌相符':'門牌候選';choice='doorplate';reason='只有官方門牌參考座標，並非店家入口的定位證明';}
 else if(osm){category='osm-only';chosen=osm;quality='OSM 單一來源';choice='osm';reason='只有 OSM 店家圖釘，缺少可比對的完整門牌';}
 else if(area(venue)){category='uncertain';chosen=venue;quality='尚未驗證';choice='legacy';reason='座標來源未能獨立確認';}
 else{category='missing';chosen=null;quality='待定位';choice='none';reason='沒有可用座標';}
 const result={...venue,officialPosition:official||null,osmPosition:osm||null,coordAudit:{category,quality,choice,reason,deltaM:delta,officialMatch:official?.match||null}};
 if(chosen){result.lat=chosen.lat;result.lng=chosen.lng;result.coordsSource=choice==='doorplate'?'tainan-city-doorplate-114':choice==='osm'?'OSM-public':choice==='manual'?'user-manual':venue.coordsSource;}
 else{result.lat=null;result.lng=null;}
 return result;
}
export function matchPublicToCurated(curated,publicVenues){
 const all=curated.map(v=>({...v,officialPosition:area(v.officialPosition)?{...v.officialPosition}:area(v)&&v.coordsSource==='tainan-city-doorplate-114'?{lat:v.lat,lng:v.lng}:null,osmPosition:null}));
 const extra=[];const used=new Set();
 for(const osm of publicVenues){
  const osmName=normalizeName(osm.name);if(!osmName||!area(osm))continue;
  const candidates=all.filter(x=>{const n=normalizeName(x.name);return n===osmName||(n.length>=4&&osmName.length>=4&&(n.includes(osmName)||osmName.includes(n)))});
  const close=candidates.filter(x=>{
    const d=meters(osm,x.officialPosition?x.officialPosition:x);
    return d!==null&&d<=300;
  });
  // Never automatically merge similarly named POIs if multiple potential matches.
  const eligible=close.length===1?close[0]:null;
  if(eligible&&!used.has(eligible.id)){
   eligible.osmPosition={lat:osm.lat,lng:osm.lng};
   eligible.osmProvider=osm.coordsSource||'OSM';
   used.add(eligible.id);
  }else extra.push({...osm,osmPosition:{lat:osm.lat,lng:osm.lng}});
 }
 return [...all,...extra];
}
export function summarizeAudit(venues){
 const sum={total:venues.length,both:0,aligned:0,review:0,conflict:0,doorplateOnly:0,osmOnly:0,missing:0,manual:0,verifiedDoorplates:0};
 for(const v of venues){const a=v.coordAudit||{};if(a.deltaM!==null&&a.deltaM!==undefined)sum.both++;if(a.category==='aligned')sum.aligned++;if(a.category==='review')sum.review++;if(a.category==='conflict')sum.conflict++;if(a.category==='doorplate-only')sum.doorplateOnly++;if(a.category==='osm-only')sum.osmOnly++;if(a.category==='manual')sum.manual++;if(a.category==='missing'||a.category==='uncertain')sum.missing++;if(v.officialPosition)sum.verifiedDoorplates++;}
 return sum;
}
