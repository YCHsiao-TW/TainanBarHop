/** Public OSM-based POI providers. No Google scraping and no API secrets in browser. */
const BBOX={south:22.90,west:120.11,north:23.12,east:120.37};
const inTainan=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>22.75&&lat<23.55&&lng>119.95&&lng<120.85;
const category=(name,amenity)=>/beer|brew|bier|啤酒|精釀/i.test(name)||amenity==='biergarten'?'beer':'cocktail';
const tidy=(s)=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s.,()（）・-]/g,'');
function normalize(items,provider){
 const result=[],seen=new Set();
 for(const item of items){
   const name=(item.name||'').trim(),lat=Number(item.lat),lng=Number(item.lng);
   if(!name||!inTainan(lat,lng))continue;
   const key=tidy(name);if(seen.has(key))continue;seen.add(key);
   const address=item.address&&item.address!=='臺南市'?item.address:'臺南市（依圖釘位置）';
   result.push({id:item.id,name,address,lat,lng,category:category(name,item.amenity),desc:'OSM 公開點位・營業狀態請另確認',source:'osm',coordsSource:provider});
 }
 return result.slice(0,550);
}
async function limitedJson(url,timeout=15000){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
 try{const response=await fetch(url,{signal:c.signal,mode:'cors',headers:{'Accept':'application/json'}});if(!response.ok)throw Error(`HTTP ${response.status}`);
   const json=await response.json();if(json.error)throw Error(json.error?.message||JSON.stringify(json.error));return json;
 }finally{clearTimeout(timer)}
}
async function fromArcgis(){
 const root='https://services-ap1.arcgis.com/iA7fZQOnjY9D67Zx/ArcGIS/rest/services/OSM_AS_Amenities/FeatureServer/0/query';
 const geometry=JSON.stringify({xmin:BBOX.west,ymin:BBOX.south,xmax:BBOX.east,ymax:BBOX.north,spatialReference:{wkid:4326}});
 const params=new URLSearchParams({where:"amenity IN ('bar','pub') AND name IS NOT NULL",geometry,geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'objectid,name,amenity,addr_city,addr_street,addr_housenumber',returnGeometry:'true',resultRecordCount:'1500',f:'json'});
 const json=await limitedJson(root+'?'+params,17000);
 if(!Array.isArray(json.features))throw Error('ArcGIS invalid features');
 const records=json.features.map(f=>{const t=f.attributes||{},g=f.geometry||{};return {id:'arcgis-'+t.objectid,name:t.name,lat:g.y,lng:g.x,amenity:t.amenity,address:['臺南市',t.addr_city&&t.addr_city!=='臺南市'?t.addr_city:'',t.addr_street,t.addr_housenumber].filter(Boolean).join('')}});
 return normalize(records,'ArcGIS OSM');
}
const OSM_QUERY='[out:json][timeout:18];(nwr["amenity"~"^(bar|pub|biergarten)$"](22.90,120.11,23.12,120.37););out center tags;';
async function fromOverpass(url){
 const json=await limitedJson(url+'?'+new URLSearchParams({data:OSM_QUERY}),16000);
 if(!Array.isArray(json.elements))throw Error('Overpass invalid elements');
 const records=json.elements.map(e=>{const t=e.tags||{};return {id:`osm-${e.type}-${e.id}`,name:t['name:zh']||t.name||t['name:en'],lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon,amenity:t.amenity,address:['臺南市',t['addr:district'],t['addr:street'],t['addr:housenumber']].filter(Boolean).join('')}});
 return normalize(records,'Overpass OSM');
}
export async function fetchPublicBars(){
 const providers=[['ArcGIS OSM',fromArcgis],['Overpass DE',()=>fromOverpass('https://overpass-api.de/api/interpreter')],['Overpass Kumi',()=>fromOverpass('https://overpass.kumi.systems/api/interpreter')],['Overpass Coffee',()=>fromOverpass('https://overpass.private.coffee/api/interpreter')]];
 const problems=[];
 for(const [name,load] of providers){
  try{const venues=await load();if(venues.length)return {venues,provider:name};problems.push(`${name}: 0 筆`)}catch(e){problems.push(`${name}: ${e?.name==='AbortError'?'逾時':String(e?.message||e)}`)}
 }
 throw Error(problems.join('；').slice(0,200));
}
/** Explicit single-place Photon lookup only. Never autocomplete or bulk-geocode. */
export async function geocodePlace(place){
 const address=String(place?.address||'').trim();if(!address)return null;
 const url='https://photon.komoot.io/api/?'+new URLSearchParams({q:address,limit:'5',lat:'22.999',lon:'120.202'});
 const json=await limitedJson(url,11000);if(!Array.isArray(json.features))return null;
 for(const feature of json.features){
  const p=feature.properties||{},g=feature.geometry||{},lng=Number(g.coordinates?.[0]),lat=Number(g.coordinates?.[1]);
  if(!inTainan(lat,lng))continue;
  // Reject city, county or vague region centroids. Ask user to confirm every candidate.
  const t=String(p.type||'').toLowerCase();
  if(/city|district|county|state|country|municipality|locality/.test(t))continue;
  if(Array.isArray(p.extent)&&p.extent.length===4){const a=p.extent.map(Number);if(Math.abs(a[2]-a[0])>.01||Math.abs(a[3]-a[1])>.01)continue}
  return {lat,lng};
 }
 return null;
}


/**
 * Place search for a user-initiated change of starting point.
 * Photon (OSM search) is the primary provider; exact-name Overpass is the
 * fallback. Neither is an appointment/reservation service.
 * No search requests run while typing, and no unverified result is silently
 * accepted as the user's new starting point.
 */
const LANDMARKS=[
  // Taiwan Tourism Administration scenic spot information. Public reference
  // coordinate, not a surveyed entrance: 觀夕平台 22.99023,120.14713.
  {name:'觀夕平台',aliases:['觀夕平台','觀夕平臺','sunset platform'],address:'臺南市安平區四草大橋南端',lat:22.99023,lng:120.14713,source:'觀光景點參考座標'}
];
const compactPlace=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s,，。・_\-臺台市縣區]/g,'');
function placeLabel(p){return [p.name,p.street&&p.housenumber?`${p.street} ${p.housenumber}`:p.street,p.district,p.city,p.county].filter(Boolean).join(' · ')}
function validPlace(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=21.5&&lat<=25.6&&lng>=118.0&&lng<=123.0}
function uniquePlaces(items){const seen=new Set(),out=[];for(const v of items){const key=`${Math.round(v.lat*1e5)}/${Math.round(v.lng*1e5)}`;if(seen.has(key))continue;seen.add(key);out.push(v)}return out.slice(0,8)}
async function photonStartingPlaces(q,center){
  const query=new URLSearchParams({q,limit:'10',lat:String(Number.isFinite(center?.lat)?center.lat:22.999),lon:String(Number.isFinite(center?.lng)?center.lng:120.202)});
  // Do NOT set lang=zh: public Photon instances may reject an unavailable language with HTTP 400.
  const json=await limitedJson('https://photon.komoot.io/api/?'+query,9000);
  return (json.features||[]).map(f=>{
   const p=f.properties||{},lng=Number(f.geometry?.coordinates?.[0]),lat=Number(f.geometry?.coordinates?.[1]);
   const name=p.name||p['name:zh']||p.street||p.city||p.district||q;
   return {name,lat,lng,address:placeLabel({...p,name}),type:'place',source:'Photon / OpenStreetMap'};
  }).filter(v=>validPlace(v.lat,v.lng));
}
async function overpassStartingPlaces(q){
  if(q.length<2||q.length>65)return [];
  const safe=q.replace(/[\\"\[\]().*+?^${}|]/g,'\\$&');
  const overpass=`[out:json][timeout:11];(nwr["name"~"^${safe}$",i](22.75,119.9,23.55,120.85););out center 12;`;
  const url='https://overpass-api.de/api/interpreter?'+new URLSearchParams({data:overpass});
  const json=await limitedJson(url,12500);
  return (json.elements||[]).map(e=>{const p=e.tags||{},lat=Number(e.lat??e.center?.lat),lng=Number(e.lon??e.center?.lon);
   return {name:p['name:zh']||p.name||q,lat,lng,address:[p['addr:city']||'臺南市',p['addr:district'],p['addr:street'],p['addr:housenumber']].filter(Boolean).join(' '),type:'place',source:'Overpass / OpenStreetMap'};
  }).filter(v=>validPlace(v.lat,v.lng));
}
export async function searchStartingPlaces(query,{center}={}){
 const q=String(query||'').trim();if(!q)return [];
 const local=LANDMARKS.filter(x=>x.aliases.some(a=>compactPlace(a)===compactPlace(q)));
 if(local.length)return local.map(x=>({name:x.name,address:x.address,lat:x.lat,lng:x.lng,type:'place',source:x.source}));
 let results=[],failure=null;
 try{results=await photonStartingPlaces(q,center)}catch(e){failure=e}
 // A bare landmark name is often better than appending a city name.
 // If Photon has no usable Taiwanese candidates, try a narrowly bounded
 // user-initiated exact-name lookup; no systematic place crawling.
 if(!results.length){try{results=await overpassStartingPlaces(q.replace(/(?:臺南|台南)市?/g,'').trim()||q)}catch(e){failure=failure||e}}
 if(!results.length&&failure)throw failure;
 const needle=compactPlace(q.replace(/(?:臺南|台南)市?/g,''));
 results.sort((a,b)=>{
  const score=v=>{const n=compactPlace(v.name);return (n===needle?100:0)+(n.includes(needle)?25:0)+(v.lat>22.75&&v.lat<23.55&&v.lng>119.9&&v.lng<120.85?20:0)};
  return score(b)-score(a);
 });
 return uniquePlaces(results);
}
