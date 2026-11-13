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
 // Quality grades (v2.0 image brief, docs/IMAGE_GRADES.md). Rights and identity are the same for every grade; only
 // size and measured quality differ by use:
 //   A premium: the home banner, the large home feature, featured picks, a full-width detail lead;
 //   B general: cards, search and region lists, the detail page (a smaller original is shown at its own size, matted)
 //     and the work's gallery. The blockiness bar is wider than A's because the 8x8 metric reads dark noise, film
 //     grain, smooth skies and overlay text as blocking (calibrated on viewed samples: 34-54 showed no visible
 //     blocking at card size or 1:1; blur is caught by sharpness, which keeps A's bar);
 //   C context: a building, place or event photo, or a work photo below B; shown apart, never counted as the work's
 //     photo.
 // An editor who viewed the photo at its display sizes may grade it (editor_grade, from an approve_image decision):
 // the grade replaces the measured bars but never the width floor, and C keeps the photo out of the work's photos.
 const BARS={A:{width:1600,sharpness:25,blockiness:30},B:{width:640,sharpness:25,blockiness:60}};
 function qualityEvidence(image){
  const width=number(image?.width??image?.maxw),sharpness=number(image?.quality?.sharpness),blockiness=number(image?.quality?.blockiness);
  const measured=sharpness!==null||blockiness!==null;
  const passes=bar=>width!==null&&width>=bar.width&&(!measured||(sharpness!==null&&sharpness>=bar.sharpness&&blockiness!==null&&blockiness<=bar.blockiness));
  const editor=['A','B','C'].includes(image?.editor_grade)?image.editor_grade:null;
  const floor=bar=>width!==null&&width>=bar.width;
  let grade=passes(BARS.A)?'A':passes(BARS.B)?'B':null;
  if(editor==='A'||editor==='B')grade=editor==='A'&&floor(BARS.A)?'A':floor(BARS.B)?'B':null;
  if(editor==='C')grade=null;
  return{ok:grade==='A'||grade==='B',grade,width,sharpness,blockiness,measured,editor};
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
 // v0.26.2: a photo whose identity the collector proved (it comes from the work's own record: its P18, article lead
 // image, Commons category, part category or depicts statement, never an institution's file) and that the collector
 // classed as the work (tier 1-3: the work with its light or media named or measured; tier 4: the installation in
 // its own category) is the work's photo even when its frame scores below 40 (a lit work by day, a dim interior).
 function visualEvidence(image){
  const kind=kindOf(image),identity=identityEvidence(image),score=identity.score,tier=number(image?.tier);
  const visualVerified=image?.visual_verified===true||image?.approved===true;
  const collector=identity.explicit&&tier!==null&&tier>=1&&tier<=(kind==='project_installation'?4:3);
  const ok=REPRESENTATIVE_KINDS.has(kind)&&identity.ok&&(visualVerified||(score!==null&&score>=40)||collector);
  return{ok,kind,visual_verified:visualVerified,collector_verified:collector,score,reasons:identity.reasons};
 }
 function classify(image){
  if(!image||typeof image!=='object')return{representative:false,reason:'missing',grade:null};
  if(image.approved===false||image.review_required===true||(image.clearance_status&&image.clearance_status!=='cleared'))return{representative:false,reason:'not_cleared',grade:null};
  if(image.art_representative===false)return{representative:false,reason:'source_rejected',grade:['C'].includes(image.art_grade)?'C':null};
  if(image.art_representative===true&&!AUXILIARY_KINDS.has(kindOf(image)))return{representative:true,reason:null,carried:true,grade:image.art_grade==='A'?'A':'B'};
  const rights=rightsEvidence(image),quality=qualityEvidence(image),identity=identityEvidence(image),visual=visualEvidence(image);
  const context=rights.ok?'C':null;
  if(quality.editor==='C')return{representative:false,reason:'editor_context',grade:context,rights,quality,identity,visual};
  const institutional=kindOf(image)==='project_media'&&identity.reasons.some(r=>r.startsWith('institution_file:'))&&image.approved!==true;
  if(institutional&&!(identity.reasons.includes('dark_frame')&&identity.reasons.includes('saturated_light')))return{representative:false,reason:'institution_context',grade:context,rights,quality,identity,visual};
  const representative=rights.ok&&quality.ok&&identity.ok&&visual.ok;
  const reason=!rights.ok?'rights':!quality.ok?'quality':!identity.ok?'identity':!visual.ok?'visual':null;
  return{representative,reason,grade:representative?quality.grade:context,rights,quality,identity,visual};
 }
 const isRepresentative=image=>classify(image).representative;
 const gradeOf=image=>classify(image).grade;
 // A premium photo: the home banner and large home feature take only these.
 const isPremium=image=>gradeOf(image)==='A';
 const isAuxiliary=image=>AUXILIARY_KINDS.has(kindOf(image))||!isRepresentative(image);
 function representativeOf(record){
  const usable=(Array.isArray(record?.images)?record.images:[]).filter(isRepresentative);
  return usable.find(i=>str(i.role)==='card')||usable.find(i=>str(i.role)==='featured')||usable.find(i=>str(i.role)==='hero')||usable[0]||null;
 }
 const isArtwork=isRepresentative;const representative=images=>representativeOf({images});
 return{classify,isRepresentative,isArtwork,representative,isAuxiliary,kindOf,rightsEvidence,qualityEvidence,identityEvidence,visualEvidence,representativeOf,gradeOf,isPremium,BARS};
});
