const fs=require('fs'),path=require('path');
const sharp=require('C:/Users/anon3/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root=__dirname;
const palette={teal:'#0B7F75',blue:'#0284C7',ink:'#0F172A',mint:'#CCFBF1',paper:'#F8FAFC',slate:'#475569'};
const esc=s=>s.replaceAll('&','&amp;');
const svg=(w,h,b)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${b}</svg>`;
const glyph=(color='white')=>`<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="28" height="28" rx="8" stroke-width="2.5"/><path d="M9 13h11m0 0-3.5-3.5M20 13l-3.5 3.5M23 19H12m0 0 3.5-3.5M12 19l3.5 3.5" stroke-width="2.2"/></g>`;
const mark=(x,y,size,c)=>`<g transform="translate(${x} ${y}) scale(${size/32})">${glyph(c)}</g>`;
const txt=(x,y,size,c,s,weight=600)=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${c}">${esc(s)}</text>`;
const jobs=[];
function asset(name,data){const f=path.join(root,name+'.svg');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);jobs.push(sharp(Buffer.from(data)).png().toFile(path.join(root,name+'.png')));}
async function main(){
for(const [name,c] of Object.entries({teal:palette.teal,blue:palette.blue,ink:palette.ink,white:'#FFFFFF'})){
 asset('logos/mark-'+name,svg(512,512,mark(0,0,512,c)));
 asset('logos/wordmark-'+name,svg(1000,180,mark(12,24,128,c)+txt(170,119,112,c,'BaraBridge')));
}
for(const theme of ['teal','blue','dark']){const bg=theme==='dark'?palette.ink:palette[theme];const s=svg(1024,1024,`<rect width="1024" height="1024" rx="224" fill="${bg}"/>`+mark(208,208,608,'white'));asset('icons/app-'+theme,s);for(const size of [16,32,48,64,128,180,192,256,512]){jobs.push(sharp(Buffer.from(s)).resize(size,size).png().toFile(path.join(root,`icons/app-${theme}-${size}.png`)));}}
asset('icons/maskable',svg(512,512,`<rect width="512" height="512" fill="${palette.teal}"/>`+mark(118,118,276,'white')));
const shapes={referral:'<path d="M4 12h16m-5-5 5 5-5 5"/>',consult:'<path d="M4 4h16v12H10l-6 4z"/><path d="M8 8h8M8 12h5"/>',transfer:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',roster:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2"/>',team:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 5"/>',location:'<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0z"/><circle cx="12" cy="9" r="2"/>',notification:'<path d="M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4"/>',followup:'<path d="M4 5v6h6M4 11a8 8 0 1 1 1 7"/>'};
for(const [n,p] of Object.entries(shapes))asset('icons/workflow-'+n,svg(96,96,`<g transform="scale(4)" fill="none" stroke="${palette.teal}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</g>`));
for(const [name,label,sub,color] of [['meu','MEU','Medical Emergency Unit',palette.teal],['teu','TEU','Trauma Emergency Unit',palette.blue],['seu','SEU','Surgical Emergency Unit',palette.ink]]) asset('badges/unit-'+name,svg(640,176,`<rect x="1" y="1" width="638" height="174" rx="26" fill="${palette.paper}" stroke="#CBD5E1"/>`+mark(25,39,96,color)+txt(148,65,32,color,'BaraBridge')+txt(148,112,36,palette.ink,label)+txt(148,146,20,palette.slate,sub,400)));
for(const [name,label] of [['referrer','Referring clinician'],['receiving','Receiving team'],['admin','Administrator']])asset('badges/role-'+name,svg(480,96,`<rect width="480" height="96" rx="48" fill="${palette.teal}"/>`+mark(22,20,56,'white')+txt(98,59,26,'white',label)));
asset('social/github-banner',svg(1280,640,`<defs><linearGradient id="b"><stop stop-color="#0F172A"/><stop offset="1" stop-color="#0B514E"/></linearGradient></defs><rect width="1280" height="640" fill="url(#b)"/><path d="M-50 560Q640 150 1340 560M-50 610Q640 200 1340 610" fill="none" stroke="#2DD4BF" stroke-width="2" opacity=".3"/>`+mark(80,154,144,'#99F6E4')+txt(254,257,100,'white','BaraBridge')+txt(86,352,31,'#CCFBF1','Referrals. Consults. Transfers.',400)));
asset('patterns/transfer-pattern',svg(512,512,`<rect width="512" height="512" fill="${palette.paper}"/>`+Array.from({length:16},(_,i)=>mark((i%4)*128+40,Math.floor(i/4)*128+40,48,'#99D4D0')).join('')));
await Promise.all(jobs);
// Multi-resolution Windows ICO with PNG-compressed entries.
const sizes=[16,32,48,64,128,256];const bufs=sizes.map(s=>fs.readFileSync(path.join(root,`icons/app-teal-${s}.png`)));let offset=6+16*sizes.length;const header=Buffer.alloc(offset);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);sizes.forEach((s,i)=>{let p=6+i*16;header[p]=s===256?0:s;header[p+1]=s===256?0:s;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(bufs[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=bufs[i].length;});fs.writeFileSync(path.join(root,'icons/favicon.ico'),Buffer.concat([header,...bufs]));
fs.writeFileSync(path.join(root,'brand-tokens.json'),JSON.stringify(palette,null,2));
console.log('Vector and PNG exports generated');
}
main().catch(e=>{console.error(e);process.exit(1)});
