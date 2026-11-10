(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else{root.AOLArtPhotoPolicy=value;root.AOLArtPhotos=value}})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const REPRESENTATIVE_KINDS=new Set(['project_media','project_installation']);
 const AUXILIARY_KINDS=new Set(['architecture_context','technical_documentation','event_documentation','artist_portrait','unverified']);
 const NC=/(?:^|[^a-z])(?:cc\s*)?by[- ]?nc|non[- ]?commercial|비영리/i;
 const VISUAL_REASON=/(?:own_category_of_light_work|night_category|depicts|editorial_review|dark_frame|saturated_light|projection|media|installation|light_show|scene_terms)/i;
 const str=v=>typeof v==='string'?v.trim():'';
 const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 function kindOf(image){
  const kind=str(image?.kind||image?.role_v2);
  if(REPRESENTATIVE_KINDS.has(kind)||AUXILIARY_KINDS.has(kind))return kind;
  const role=str(image?.role).toLowerCase();
  if(role==='portrait'||role==='artist_portrait')return'artist_portrait';
  if(role==='context'||image?.context===true||image?.match_kind==='host'||number(image?.raw_tier)===5)return'architecture_context';
  return'unverified';
 }
 function rightsEvidence(image){
  const license=str(image?.license||image?.license_code),author=str(image?.author||image?.creator||image?.rights_holder||image?.attribution);
  const source=str(image?.page||image?.page_url||image?.source_url),url=str(image?.src||image?.thumb||image?.display_url||image?.full_url);
  const commercial=image?.commercial_use;
  const ok=!!license&&!!author&&!!source&&!!url&&commercial!==false&&!NC.test(license);
  return{ok,license,author,source,url,commercial_use:commercial??null};
 }
 function qualityEvidence(image){
  const width=number(image?.width??image?.maxw),sharpness=number(image?.quality?.sharpness),blockiness=number(image?.quality?.blockiness);
  const measured=sharpness!==null||blockiness!==null;
  const ok=width!==null&&width>=900&&(!measured||(sharpness!==null&&sharpness>=25&&blockiness!==null&&blockiness<=30));
  return{ok,width,sharpness,blockiness,measured};
 }
 function identityEvidence(image){
  const explicit=image?.identity?.ok===true||image?.identity_verified===true;
  const linked=!!str(image?.project||image?.place_code)&&!!str(image?.page||image?.page_url||image?.source_url);
  const score=number(image?.media_active&&typeof image.media_active==='object'?image.media_active.score:image?.media_active);
  const evidence=image?.media_active?.reasons||image?.media_evidence;const reasons=Array.isArray(evidence)?evidence.map(str).filter(Boolean):[];
  const reviewed=image?.approved===true||image?.visual_verified===true;
  const ok=explicit||(linked&&reviewed)||(linked&&score!==null&&score>=40&&reasons.some(x=>VISUAL_REASON.test(x)));
  return{ok,explicit,linked,reviewed,score,reasons};
 }
 function visualEvidence(image){
  const kind=kindOf(image),identity=identityEvidence(image),score=identity.score;
  const visualVerified=image?.visual_verified===true||image?.approved===true;
  const ok=REPRESENTATIVE_KINDS.has(kind)&&identity.ok&&(visualVerified||(score!==null&&score>=40));
  return{ok,kind,visual_verified:visualVerified,score,reasons:identity.reasons};
 }
 function classify(image){
  if(!image||typeof image!=='object')return{representative:false,reason:'missing'};
  if(image.approved===false||image.review_required===true||(image.clearance_status&&image.clearance_status!=='cleared'))return{representative:false,reason:'not_cleared'};
  if(image.art_representative===false)return{representative:false,reason:'source_rejected'};
  if(image.art_representative===true&&!AUXILIARY_KINDS.has(kindOf(image)))return{representative:true,reason:null,carried:true};
  const rights=rightsEvidence(image),quality=qualityEvidence(image),identity=identityEvidence(image),visual=visualEvidence(image);
  const institutional=kindOf(image)==='project_media'&&identity.reasons.some(r=>r.startsWith('institution_file:'))&&image.approved!==true;
  if(institutional&&!(identity.reasons.includes('dark_frame')&&identity.reasons.includes('saturated_light')))return{representative:false,reason:'institution_context',rights,quality,identity,visual};
  const representative=rights.ok&&quality.ok&&identity.ok&&visual.ok;
  const reason=!rights.ok?'rights':!quality.ok?'quality':!identity.ok?'identity':!visual.ok?'visual':null;
  return{representative,reason,rights,quality,identity,visual};
 }
 const isRepresentative=image=>classify(image).representative;
 const isAuxiliary=image=>AUXILIARY_KINDS.has(kindOf(image))||!isRepresentative(image);
 function representativeOf(record){
  const usable=(Array.isArray(record?.images)?record.images:[]).filter(isRepresentative);
  return usable.find(i=>str(i.role)==='card')||usable.find(i=>str(i.role)==='featured')||usable.find(i=>str(i.role)==='hero')||usable[0]||null;
 }
 const isArtwork=isRepresentative;const representative=images=>representativeOf({images});
 return{classify,isRepresentative,isArtwork,representative,isAuxiliary,kindOf,rightsEvidence,qualityEvidence,identityEvidence,visualEvidence,representativeOf};
});
