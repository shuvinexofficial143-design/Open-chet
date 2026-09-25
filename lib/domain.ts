import type { Mode, Role } from './types';
export function messagingOpen(last:string|null,now=Date.now()){return !!last && now-new Date(last).getTime()<86_400_000 && new Date(last).getTime()<=now;}
export function normalizePhone(phone:string){const s=phone.trim().replace(/[\s()-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(s))throw Error('Use an international phone number, e.g. +919876543210.');return s;}
export function canManage(role:Role){return ['owner','admin','manager'].includes(role)}
export function canAdmin(role:Role){return ['owner','admin'].includes(role)}
export function maySendAI(mode:Mode,enabled:boolean,expected:number,actual:number,last:string|null){return mode==='ai'&&enabled&&expected===actual&&messagingOpen(last)}
export function statusAdvance(current:string,next:string){const ranks:Record<string,number>={queued:0,sending:1,sent:2,delivered:3,read:4};if(current==='failed')return current;if(next==='failed')return ['queued','sending','sent'].includes(current)?next:current;return (ranks[next]??-1)>(ranks[current]??-1)?next:current;}
export function templateText(body:string,variables:string[]){return body.replace(/\{\{(\d+)\}\}/g,(_,i)=>variables[Number(i)-1]??`{{${i}}}`)}
export function templateVariables(body:string){return [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b)}
export function validMediaUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'}catch{return false}}
