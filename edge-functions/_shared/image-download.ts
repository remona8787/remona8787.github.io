const LIMIT=15*1024*1024;
export function allowedImageURL(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)||u.username||u.password||u.port)throw Error('Untrusted image host');
 return u.href;
}
export async function downloadCommonsImage(url:string,mime:string){
 if(!['image/jpeg','image/png','image/webp'].includes(mime))throw Error('Unsupported raster image type');
 const response=await fetch(allowedImageURL(url),{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Image download HTTP ${response.status}`);
 if((response.headers.get('content-type')||'').split(';')[0]!==mime)throw Error('Image MIME mismatch');
 if(Number(response.headers.get('content-length'))>LIMIT)throw Error('Image too large');
 if(!response.body)throw Error('Empty image');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw Error('Image too large');chunks.push(value)}}finally{await reader.cancel()}
 if(!size)throw Error('Empty image');const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}
 const jpeg=result[0]===255&&result[1]===216&&result[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>result[i]===v);
 const webp=String.fromCharCode(...result.slice(0,4))==='RIFF'&&String.fromCharCode(...result.slice(8,12))==='WEBP';
 if(!(mime==='image/jpeg'?jpeg:mime==='image/png'?png:webp))throw Error('Invalid image signature');
 return result;
}
