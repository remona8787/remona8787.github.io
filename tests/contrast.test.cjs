const {test}=require('node:test'),assert=require('node:assert/strict');
const lum=s=>{const c=s.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const pairs=[['light body','#151A38','#F8F7FC'],['light metadata','#626078','#FFFFFF'],['light muted panel','#626078','#F0EDF8'],['button','#FFFFFF','#6B57C8'],['dark body','#F3F0FC','#12162D'],['dark metadata','#BDB8D2','#1C2140'],['dark button','#151A38','#B6A7F4'],['hero text','#E4DFF3','#62529C']];
for(const [name,fg,bg] of pairs)test('text token contrast '+name,()=>{const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=4.5,`${name} ${ratio}`)});
