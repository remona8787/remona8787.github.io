// Fills operator/contact fields on static legal pages from config.js. Empty values stay visibly unresolved.
(()=>{const c=window.AOL_CONFIG||{};const vals={OPERATOR_NAME:c.OPERATOR_NAME,SUPPORT_EMAIL:c.SUPPORT_EMAIL,PRIVACY_OFFICER:c.PRIVACY_OFFICER||c.OPERATOR_NAME};let missing=false;
for(const el of document.querySelectorAll('[data-config]')){const v=String(vals[el.dataset.config]||'').trim();if(!v){missing=true;el.textContent='(운영자 등록 전)';el.classList.add('unresolved');continue}
 if(el.dataset.config==='SUPPORT_EMAIL'&&/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)){const a=document.createElement('a');a.href='mailto:'+v;a.textContent=v;el.replaceChildren(a)}else el.textContent=v}
const note=document.getElementById('legal-unresolved');if(note)note.hidden=!missing})();
