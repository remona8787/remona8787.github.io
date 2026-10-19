// UI language of the app (한국어 / English). One dictionary per language, keyed by short ids; {name} placeholders are
// filled from vars. A key missing in English falls back to Korean (tests/i18n.test.cjs keeps both complete for the
// screens listed in docs/ARCHIVE_APP.md). Place names and descriptions are data, not UI: see name() in app.js.
(function(root,factory){const a=factory();if(typeof module==='object'&&module.exports)module.exports=a;else root.AOLi18n=a})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ko={};
const en={};
function t(lang,key,vars){let s=(lang==='en'?en:ko)[key];if(s===undefined)s=ko[key];if(s===undefined)return key;return vars?s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]===undefined||vars[k]===null?'':String(vars[k])):s}
return {LANGS:[['ko','한국어'],['en','English']],ko,en,t};
});
