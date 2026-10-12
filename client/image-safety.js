const MAX_BYTES=5*1024*1024;
export function detectImageMime(bytes){
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
export function imageDimensions(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000)throw Error('4천만 화소 이하의 사진을 선택하세요.');
 const ratio=Math.min(1,2048/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};
}
async function decode(file){
 if(typeof createImageBitmap==='function')return createImageBitmap(file);
 const url=URL.createObjectURL(file),img=new Image();
 try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('이미지를 읽을 수 없습니다.'));img.src=url});return {width:img.naturalWidth,height:img.naturalHeight,image:img,close(){}}}finally{URL.revokeObjectURL(url)}
}
// Re-encode pixels, so the original file and its EXIF/GPS metadata are not uploaded.
// This client check is not a substitute for bucket/RLS restrictions or server validation.
export async function preparePhoto(file,environment={decode,canvas:()=>document.createElement('canvas')}){
 if(!file||file.size<1||file.size>MAX_BYTES)throw Error('5MB 이하의 사진을 선택하세요.');
 const actual=detectImageMime(new Uint8Array(await file.slice(0,12).arrayBuffer()));
 if(!actual||actual!==file.type)throw Error('파일 내용과 이미지 형식이 일치하지 않습니다. JPG·PNG·WebP를 선택하세요.');
 let bitmap;
 try{
  bitmap=await environment.decode(file);const size=imageDimensions(bitmap.width,bitmap.height),canvas=environment.canvas();
  canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('사진 변환을 지원하지 않는 브라우저입니다.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size.width,size.height);ctx.drawImage(bitmap.image||bitmap,0,0,size.width,size.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('사진 변환에 실패했습니다.')),'image/jpeg',0.86));
  if(blob.type!=='image/jpeg'||blob.size<1||blob.size>MAX_BYTES)throw Error('사진 변환 결과가 업로드 제한을 초과했습니다.');
  return blob;
 }finally{bitmap?.close?.()}
}
