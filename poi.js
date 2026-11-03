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
 const url='https://photon.komoot.io/api/?'+new URLSearchParams({q:address,limit:'5',lat:'22.999',lon:'120.202',lang:'zh'});
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
