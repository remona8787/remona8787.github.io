import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {Share} from '@capacitor/share';
import {Geolocation} from '@capacitor/geolocation';
import {StatusBar,Style} from '@capacitor/status-bar';
const native=Capacitor.isNativePlatform();
window.AOLNative={native,async share(url,title){if(native)return Share.share({title,url,dialogTitle:'빛의 건축 공유'});if(navigator.share)return navigator.share({title,url});await navigator.clipboard.writeText(url)},async locate(){if(native){const p=await Geolocation.getCurrentPosition({enableHighAccuracy:false,timeout:15000});return p.coords}return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>resolve(p.coords),reject,{timeout:15000}):reject(Error('위치 기능을 지원하지 않습니다.')))}};
if(native){StatusBar.setStyle({style:Style.Light}).catch(()=>{});App.addListener('backButton',({canGoBack})=>{const modal=document.querySelector('dialog[open]');if(modal){modal.close();return}if(location.hash&&location.hash!=='#home'){history.back();return}App.minimizeApp()});App.addListener('appUrlOpen',({url})=>{try{const u=new URL(url);if(u.protocol==='architectureoflight:'&&/^#(?:place|route)\/[\w-]+$/.test(u.hash))location.hash=u.hash}catch{}});document.addEventListener('click',e=>{const a=e.target.closest('a[target="_blank"]');if(a&&/^https?:/.test(a.href)){e.preventDefault();Browser.open({url:a.href})}})}
