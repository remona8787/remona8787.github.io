const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {buildSync}=require('esbuild');
const ctx=vm.createContext({module:{exports:{}}});
// commons.ts imports the shared live-media module, so bundle it rather than transform a single file.
vm.runInContext(buildSync({entryPoints:['edge-functions/_shared/commons.ts'],bundle:true,format:'cjs',write:false,platform:'neutral'}).outputFiles[0].text,ctx);
const decide=ctx.module.exports.rightsDecision;
for(const license of ['CC BY 4.0','CC BY-SA 4.0','CC0 1.0','Public domain'])test('known reusable license: '+license,()=>assert.equal(decide(license).commercialAllowed,true));
for(const license of ['Unknown','CC BY-NC 4.0','CC BY-ND 4.0','not CC BY 4.0','CC BY 4.0 or restricted'])test('ambiguous/restricted license rejected: '+license,()=>assert.equal(decide(license).commercialAllowed,false));
const warning=ctx.module.exports.hasRightsWarning;
test('foreign no-FoP template blocks automated clearance',()=>assert.equal(warning([],{},['Template:NoFoP-France']),true));
test('South Korean FoP tag follows the display policy',()=>{assert.equal(warning([],{},['Template:NoFoP-South Korea']),false);assert.equal(warning([],{},['Template:NoFoP-South Korea'],{krFopDisplay:false,maxImagesPerPlace:3}),true)});
test('Commons deletion tag blocks automated clearance',()=>{assert.equal(warning([],{},['Template:Delete']),true);assert.equal(warning(['Category:Deletion requests October 2026'],{}),true)});
test('non-Korean NoFoP category blocks automated clearance',()=>assert.equal(warning(['Category:NoFoP-France'],{}),true));
test('Commons metadata restriction blocks automated clearance',()=>assert.equal(warning([],{Restrictions:{value:'Permission required'}}),true));
test('ordinary category does not imply a rights restriction',()=>assert.equal(warning(['Category:Seoul Station'],{}),false));
