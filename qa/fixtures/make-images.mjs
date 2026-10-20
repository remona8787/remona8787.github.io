// Writes synthetic test images to qa/fixtures/images/: procedural drawings of a lit media façade at night, projection
// mapping, LED lines and a daytime building, rendered on a canvas in Chromium. TEST ASSETS for the browser specs (they
// stand in for the Fixture_… Commons files of qa/fixtures/site-data); they are not photographs of any project and are
// never published (qa/ is not part of the build).   node qa/fixtures/make-images.mjs
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const out=path.join(import.meta.dirname,'images');
const browser=await chromium.launch();const page=await browser.newPage();
const KINDS={night:3,art:3,led:2,day:2};
for(const [kind,n] of Object.entries(KINDS))for(let i=0;i<n;i++){
 const data=await page.evaluate(([kind,i])=>{
  const W=1200,H=kind==='day'?800:900,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');let seed=(i+1)*9301+kind.length*49297;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const sky=g.createLinearGradient(0,0,0,H);
  if(kind==='day'){sky.addColorStop(0,'#7FB2E5');sky.addColorStop(1,'#DCEBF7');g.fillStyle=sky;g.fillRect(0,0,W,H);
   for(let b=0;b<6;b++){const x=b*220-40+rnd()*40,w=180+rnd()*80,h=H*(.35+rnd()*.4);g.fillStyle=['#B9B4AA','#9FA4AD','#CFC8BB','#8E949C'][b%4];g.fillRect(x,H-h,w,h);g.fillStyle='#6E7B8A';for(let y=H-h+20;y<H-30;y+=34)for(let xx=x+14;xx<x+w-20;xx+=28)g.fillRect(xx,y,14,20)}
   g.fillStyle='#7C8471';g.fillRect(0,H-40,W,40);return c.toDataURL('image/jpeg',.72)}
  sky.addColorStop(0,'#04050F');sky.addColorStop(.7,'#120F33');sky.addColorStop(1,'#1E1640');g.fillStyle=sky;g.fillRect(0,0,W,H);
  for(let s=0;s<120;s++){g.fillStyle=`rgba(255,255,255,${rnd()*.5})`;g.fillRect(rnd()*W,rnd()*H*.5,1.5,1.5)}
  const ground=H*.82;
  for(let b=0;b<9;b++){const x=b*150-60+rnd()*30,w=120+rnd()*70,h=H*(.2+rnd()*.35);g.fillStyle='#0B0C1E';g.fillRect(x,ground-h,w,h);g.fillStyle='rgba(255,214,140,.55)';for(let y=ground-h+12;y<ground-10;y+=22)for(let xx=x+8;xx<x+w-10;xx+=18)if(rnd()<.25)g.fillRect(xx,y,7,9)}
  const bx=W*(.28+rnd()*.12),bw=W*(.36+rnd()*.08),bh=H*(.55+rnd()*.12),by=ground-bh;
  g.fillStyle='#07081A';
  if(kind==='art'){g.beginPath();g.moveTo(bx-20,by+60);g.lineTo(bx+bw/2,by-30);g.lineTo(bx+bw+20,by+60);g.closePath();g.fill()}
  g.fillRect(bx,by+(kind==='art'?60:0),bw,bh-(kind==='art'?60:0));
  g.save();g.globalCompositeOperation='lighter';
  const hue0=[268,190,320,20,150][(i+kind.length)%5];
  if(kind==='night'){const cell=14;for(let y=by+8;y<ground-8;y+=cell)for(let x=bx+8;x<bx+bw-8;x+=cell){const u=(x-bx)/bw,v=(y-by)/bh,a=Math.sin(u*9+i*2)*Math.cos(v*7-i)+Math.sin((u+v)*6);const l=Math.max(0,a);if(l<.15)continue;g.shadowBlur=12;g.shadowColor=`hsl(${hue0+u*80},100%,60%)`;g.fillStyle=`hsla(${hue0+u*80+v*40},100%,${45+l*25}%,${.5+l*.4})`;g.fillRect(x,y,cell*.6,cell*.6)}}
  if(kind==='art'){for(let k=0;k<14;k++){const y=by+60+k*(bh-60)/14;const grd=g.createLinearGradient(bx,0,bx+bw,0);grd.addColorStop(0,`hsla(${hue0+k*12},100%,55%,.0)`);grd.addColorStop(.5,`hsla(${hue0+k*18},100%,60%,.85)`);grd.addColorStop(1,`hsla(${hue0+k*24+60},100%,55%,.2)`);g.fillStyle=grd;g.shadowBlur=24;g.shadowColor=`hsl(${hue0+k*18},100%,60%)`;g.fillRect(bx,y,bw,(bh-60)/14-4)}for(let col=0;col<6;col++){g.fillStyle='rgba(5,6,20,.55)';g.fillRect(bx+20+col*(bw-40)/5-8,by+70,16,bh-70)}}
  if(kind==='led'){for(let k=0;k<22;k++){const x=bx+10+k*(bw-20)/22,grd=g.createLinearGradient(0,by,0,ground);grd.addColorStop(0,`hsla(${hue0+k*6},100%,70%,.95)`);grd.addColorStop(1,`hsla(${hue0+k*6+40},100%,50%,.3)`);g.fillStyle=grd;g.shadowBlur=18;g.shadowColor=`hsl(${hue0+k*6},100%,60%)`;g.fillRect(x,by+10,4,bh-20)}}
  g.restore();
  // Reflection on water.
  g.save();g.globalAlpha=.35;g.translate(0,ground*2);g.scale(1,-1);g.drawImage(c,0,ground-(H-ground),W,H-ground,0,ground-(H-ground),W,H-ground);g.restore();
  g.fillStyle='rgba(4,5,15,.45)';g.fillRect(0,ground,W,H-ground);
  return c.toDataURL('image/jpeg',.74)},[kind,i]);
 await writeFile(path.join(out,`${kind}-${i+1}.jpg`),Buffer.from(data.split(',')[1],'base64'));
}
await browser.close();console.log('synthetic test images →',path.relative(process.cwd(),out));
