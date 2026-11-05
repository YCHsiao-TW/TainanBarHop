/** Load and parse the ~3.5MB compressed city reference in a background thread.
 * The main UI receives only matched doorplates, never the 470k-record index.
 */
import {officialReference} from './audit.js?v=7.1.5';
let promise;
async function getIndex(){
 if(!promise)promise=(async()=>{
  if(typeof DecompressionStream==='undefined')throw Error('此裝置不支援壓縮資料解碼');
  const response=await fetch('./doorplate-index.json.gz?v=7.1.5',{cache:'force-cache'});
  if(!response.ok)throw Error('官方門牌索引載入失敗：HTTP '+response.status);
  const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  if(!data.entries||!data.version)throw Error('官方門牌資料格式不正確');
  return data;
 })().catch(e=>{promise=null;throw e});
 return promise;
}
self.onmessage=async ev=>{
 const {id,list=[]}=ev.data||{};
 try{
  const index=await getIndex();const matches={};
  for(const v of list){if(!v.id)continue;const ref=officialReference(v,index);if(ref)matches[v.id]=ref;}
  self.postMessage({id,matches});
 }catch(e){self.postMessage({id,error:String(e?.message||e)})}
};
