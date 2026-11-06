/* Developer mode untuk portofolio. Dimuat hanya saat menu "Developer" dibuka.
   Cara kerja: login -> sunting teks/foto -> "Terbitkan" menyimpan perubahan langsung ke repository GitHub
   lewat GitHub API (satu commit), lalu GitHub Pages memperbaruinya sendiri. */
(function(){
"use strict";
if(window.DEV)return;
var CRED={salt:"jikckoA4sDl6ExgCeCnw2g==",iter:250000,hash:"rs/8e5+4XvW+2szZqnFaz1h0MIfjgdM2Kd9COLTNFTU="};
var enc=new TextEncoder(),dec=new TextDecoder();
var S={email:"",pw:"",token:"",cfg:{owner:"",repo:"",branch:""},authed:false,tab:"photos",pending:{},dirty:false,busy:false,fails:0,lock:0,sec:{},itm:{}};
var root=null,view=null,bar=null,uidn=0;

/* ---------- helpers ---------- */
function el(t,a,k){var e=document.createElement(t);if(a)for(var x in a){var v=a[x];if(v==null)continue;if(x==="class")e.className=v;else if(x==="text")e.textContent=v;else if(x.slice(0,2)==="on")e.addEventListener(x.slice(2),v);else e.setAttribute(x,v)}(k||[]).forEach(function(c){if(c==null)return;e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function b64(buf){var a=new Uint8Array(buf),s="";for(var i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function kb(n){return n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"}
function uid(){return Math.random().toString(36).slice(2,7)}
function trim(x){return String(x).trim()}
function D(){return window.SITE.get()}
function touch(){S.dirty=true;updateBar();clearTimeout(S.rt);S.rt=setTimeout(function(){window.SITE.render()},400)}
function pendingCount(){return Object.keys(S.pending).length}

/* ---------- crypto: login check + encrypted token vault ---------- */
function pbBits(secret,salt,iter){return crypto.subtle.importKey("raw",enc.encode(secret),"PBKDF2",false,["deriveBits"]).then(function(k){return crypto.subtle.deriveBits({name:"PBKDF2",salt:salt,iterations:iter,hash:"SHA-256"},k,256)})}
function pbKey(secret,salt){return crypto.subtle.importKey("raw",enc.encode(secret),"PBKDF2",false,["deriveKey"]).then(function(k){return crypto.subtle.deriveKey({name:"PBKDF2",salt:salt,iterations:250000,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])})}
function checkLogin(email,pw){return pbBits(email.toLowerCase().trim()+"\n"+pw,unb64(CRED.salt),CRED.iter).then(function(bits){return b64(bits)===CRED.hash})}
function vaultSecret(){return S.pw+"|"+S.email.toLowerCase().trim()}
function saveVault(){var salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
return pbKey(vaultSecret(),salt).then(function(k){return crypto.subtle.encrypt({name:"AES-GCM",iv:iv},k,enc.encode(JSON.stringify({t:S.token,o:S.cfg.owner,r:S.cfg.repo,b:S.cfg.branch})))}).then(function(ct){try{localStorage.setItem("dev.vault",JSON.stringify({s:b64(salt),i:b64(iv),c:b64(ct)}))}catch(e){throw new Error("Browser tidak mengizinkan penyimpanan lokal (mode private?). Token tidak bisa disimpan.")}})}
function loadVault(){var raw=null;try{raw=localStorage.getItem("dev.vault")}catch(e){}if(!raw)return Promise.resolve(null);
try{var v=JSON.parse(raw)}catch(e){return Promise.resolve(null)}
return pbKey(vaultSecret(),unb64(v.s)).then(function(k){return crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(v.i)},k,unb64(v.c))}).then(function(pt){return JSON.parse(dec.decode(pt))}).catch(function(){return null})}

/* ---------- GitHub API ---------- */
function gh(method,path,body){var h={"Authorization":"Bearer "+S.token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};if(body)h["Content-Type"]="application/json";
return fetch("https://api.github.com"+path,{method:method,headers:h,body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error(j.message||("HTTP "+r.status));e.status=r.status;throw e}return j})},function(){throw new Error("Tidak bisa terhubung ke GitHub. Periksa koneksi internet.")})}
function friendly(e){if(e.status===401)return"GitHub menolak token (salah atau sudah kedaluwarsa). Buka tab Pengaturan lalu tempel token baru.";
if(e.status===403||e.status===404)return"GitHub tidak memberi akses. Pastikan nama repository benar dan token punya izin Contents: Read and write untuk repository ini.";
if(e.status===409||e.status===422)return"Isi repository berubah saat proses berjalan. Tekan Terbitkan sekali lagi. ("+e.message+")";
return e.message||"Terjadi kesalahan."}
function guessRepo(){var h=location.hostname,p=location.pathname.split("/").filter(Boolean),m=h.match(/^([^.]+)\.github\.io$/i);if(!m)return{owner:"",repo:""};var o=m[1],f=p[0];
var repo=(f&&!/\.\w+$/.test(f))?f:o+".github.io";return{owner:o,repo:repo}}

/* ---------- image / file preparation ---------- */
function viaImg(file){return new Promise(function(res,rej){var u=URL.createObjectURL(file),i=new Image();i.onload=function(){URL.revokeObjectURL(u);res(i)};i.onerror=function(){rej(new Error("Gambar tidak bisa dibaca. Coba format JPG atau PNG."))};i.src=u})}
function loadBmp(file){if(window.createImageBitmap)return createImageBitmap(file,{imageOrientation:"from-image"}).catch(function(){return viaImg(file)});return viaImg(file)}
function prep(file,kind){
if(kind==="pdf"){if(file.size>25*1048576)return Promise.reject(new Error("PDF lebih dari 25 MB. Kecilkan dulu (misalnya di ilovepdf.com)."));
if(file.type&&file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name))return Promise.reject(new Error("Pilih file PDF."));
return file.arrayBuffer().then(function(ab){return{b64:b64(ab),blob:new Blob([ab],{type:"application/pdf"}),size:file.size}})}
var logo=kind==="logo",max=kind==="cert"?1800:(logo?900:1600),q=kind==="banner"?.8:(kind==="cert"?.85:.82);
return loadBmp(file).then(function(im){var w=im.width||im.naturalWidth,h=im.height||im.naturalHeight,r=Math.min(1,max/Math.max(w,h)),cw=Math.round(w*r),ch=Math.round(h*r),c=document.createElement("canvas");c.width=cw;c.height=ch;var x=c.getContext("2d");
if(!logo){x.fillStyle="#fff";x.fillRect(0,0,cw,ch)}x.drawImage(im,0,0,cw,ch);
return new Promise(function(res,rej){c.toBlob(function(b){b?res(b):rej(new Error("Gagal memproses gambar."))},logo?"image/png":"image/jpeg",logo?undefined:q)})})
.then(function(blob){return blob.arrayBuffer().then(function(ab){return{b64:b64(ab),blob:blob,size:blob.size}})})}

/* ---------- slots (every place a file can go) ---------- */
function slots(){var d=D(),out=[],seen={};
function add(g,l,b,k,fixed){var path=k==="pdf"?b:(fixed||b+(k==="logo"?".png":".jpg"));if(!b||seen[path])return;seen[path]=1;out.push({g:g,l:l,b:b,k:k,path:path,fixed:!!fixed})}
add("Seluruh website","Foto profil (bagian paling atas)","foto-profil","photo","foto-profil.jpg");
add("Seluruh website","Foto di bagian About","foto-about","photo");
add("Seluruh website","Logo UNAIR (About)","logo-unair","logo");
add("Seluruh website","Logo FTMM (About)","logo-ftmm","logo");
add("Seluruh website","Gambar latar banner About",d.ABOUT.hb,"banner");
add("Seluruh website","File CV (PDF)","CV_Wafiy_Almas_Tsamar.pdf","pdf");
[["Work",d.WORK],["Organisasi",d.ORGS]].forEach(function(g){g[1].forEach(function(e){var n=g[0]+": "+(e.n||e.t);
add(n,"Logo",e.logo,"logo");add(n,"Gambar latar banner",e.hb,"banner");add(n,"Foto 1",e.ph+"-1","photo");add(n,"Foto 2",e.ph+"-2","photo")})});
d.PROJECTS.forEach(function(p){add("Projects","Foto: "+p.t,p.k,"photo");if(p.pdf)add("Projects","PDF: "+p.t,p.pdf,"pdf")});
d.ACH.forEach(function(a){add("Achievements","Bukti: "+a[0],a[2],"cert")});
d.CERTS.forEach(function(c){add("Sertifikat","Sertifikat: "+c[0],c[1],"cert")});
return out}

/* ---------- UI: styles ---------- */
var CSS=".dv{position:fixed;inset:0;z-index:80;background:var(--bg);color:var(--ink);overflow:auto;font:16px/1.5 var(--body);-webkit-text-size-adjust:100%}.dv[hidden]{display:none}"
+".dv *{box-sizing:border-box}.dv .bar{position:sticky;top:0;z-index:3;background:linear-gradient(100deg,#005350,#007c78);color:#fff;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px}"
+".dv .bar h2{font:800 1.1rem var(--head);margin:0;flex:1 1 auto;color:#fff}.dv .chip2{font-size:.85rem;background:rgba(255,255,255,.18);border-radius:99px;padding:3px 10px}"
+".dv button,.dv .upl{font:600 .95rem var(--body);min-height:44px;padding:0 16px;border-radius:10px;border:1.5px solid var(--a1);background:var(--surface);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}"
+".dv .pri{background:var(--a1);color:var(--on-a1)}.dv .bar button{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.14);color:#fff}.dv .bar .pri{background:#fff;color:#005350;border-color:#fff}.dv button:disabled{opacity:.5;cursor:default}"
+".dv .tabs{display:flex;gap:6px;overflow-x:auto;padding:8px 14px;background:var(--bg);border-bottom:1px solid var(--line)}.dv .tabs button{flex:0 0 auto;border-color:var(--line)}.dv .tabs button[aria-pressed=true]{background:var(--a1);color:var(--on-a1);border-color:var(--a1)}"
+".dv .body{max-width:900px;margin:0 auto;padding:16px 14px 80px}.dv h3{font:700 1.15rem var(--head);margin:22px 0 8px}.dv h4{font:700 .95rem var(--body);color:var(--muted);margin:18px 0 6px}"
+".dv .card2{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}.dv .login{max-width:420px;margin:8vh auto 0}"
+".dv label{display:block;font-weight:600;font-size:.9rem;margin:12px 0 4px}.dv input[type=text],.dv input[type=email],.dv input[type=password],.dv textarea,.dv select{width:100%;font:16px/1.4 var(--body);padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}"
+".dv input[type=color]{width:64px;height:44px;border:1.5px solid var(--line);border-radius:10px;background:var(--bg);padding:2px}.dv textarea{resize:vertical}"
+".dv .hint{color:var(--muted);font-size:.88rem;margin:4px 0}.dv .err{color:#b3261e;font-weight:600;margin:10px 0 0}.dv .ok{color:var(--a1);font-weight:600}"
+".dv .slot{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.dv .th{flex:0 0 64px;height:64px;border-radius:8px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;overflow:hidden;font-size:.75rem;color:#666}.dv .th img{width:100%;height:100%;object-fit:contain}"
+".dv .slot .nm{flex:1;min-width:0}.dv .slot .nm b{display:block;font-weight:600;overflow-wrap:anywhere}.dv .slot .nm small{display:block;color:var(--muted);overflow-wrap:anywhere}.dv .slot .nm .wait{color:var(--a2);font-weight:600}"
+".dv .upl input{display:none}.dv details.sec{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin:0 0 12px}.dv details.sec>summary{cursor:pointer;padding:14px;font-weight:700;min-height:48px}"
+".dv .row{display:flex;gap:8px;align-items:center;padding:8px 14px;border-top:1px solid var(--line)}.dv .row .tt{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}.dv .row button{min-height:40px;padding:0 12px}"
+".dv .form{padding:0 14px 14px;border-top:1px dashed var(--line)}.dv .addrow{padding:12px 14px;border-top:1px solid var(--line)}.dv .log{font:.85rem/1.5 ui-monospace,monospace;background:#0d1b1f;color:#cfe;border-radius:10px;padding:12px;white-space:pre-wrap;margin-top:12px}";

/* ---------- UI: shell ---------- */
function ensureRoot(){if(root)return;var st=el("style",{id:"devcss",text:CSS});document.head.appendChild(st);root=el("div",{class:"dv",role:"dialog","aria-label":"Developer mode",hidden:""});document.body.appendChild(root)}
function showRoot(){ensureRoot();root.hidden=false;document.body.style.overflow="hidden"}
function closeDev(){if(!root)return;root.hidden=true;document.body.style.overflow="";if(location.hash==="#dev"){try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}}}
function logout(){S.authed=false;S.pw="";S.token="";S.email="";S.pending={};closeDev()}
function open(){showRoot();if(S.authed)main();else loginView()}

function loginView(){root.innerHTML="";var em=el("input",{type:"email",id:"dvem",autocomplete:"username",inputmode:"email",autocapitalize:"none"}),pw=el("input",{type:"password",id:"dvpw",autocomplete:"current-password"}),msg=el("p",{class:"err","aria-live":"polite"}),go=el("button",{class:"pri",type:"submit",text:"Masuk"}),show=el("button",{type:"button",text:"Lihat",onclick:function(){pw.type=pw.type==="password"?"text":"password";show.textContent=pw.type==="password"?"Lihat":"Sembunyikan"}});
var f=el("form",{class:"card2 login"},[el("h3",{text:"Developer mode",style:"margin-top:0"}),el("p",{class:"hint",text:"Masuk untuk mengubah isi website. Hanya satu akun yang diizinkan."}),el("label",{for:"dvem",text:"Email"}),em,el("label",{for:"dvpw",text:"Password"}),el("div",{style:"display:flex;gap:8px"},[pw,show]),msg,el("div",{style:"display:flex;gap:8px;margin-top:16px"},[go,el("button",{type:"button",text:"Batal",onclick:closeDev})])]);
f.addEventListener("submit",function(ev){ev.preventDefault();var now=Date.now();if(now<S.lock){msg.textContent="Terlalu banyak percobaan. Coba lagi dalam "+Math.ceil((S.lock-now)/1000)+" detik.";return}
go.disabled=true;msg.textContent="";var email=em.value,pass=pw.value;
checkLogin(email,pass).then(function(okk){if(!okk){S.fails++;var wait=Math.min(S.fails*1000,8000);if(S.fails>=5){S.lock=Date.now()+60000;S.fails=0;msg.textContent="Terlalu banyak percobaan salah. Terkunci 60 detik."}else msg.textContent="Email atau password salah.";return new Promise(function(r){setTimeout(r,wait)}).then(function(){go.disabled=false})}
S.fails=0;S.email=email.toLowerCase().trim();S.pw=pass;return loadVault().then(function(v){if(v&&v.t){S.token=v.t;S.cfg={owner:v.o,repo:v.r,branch:v.b};S.authed=true;main()}else connectView("")})})
.catch(function(e){go.disabled=false;msg.textContent=(window.isSecureContext===false)?"Halaman ini harus dibuka lewat https (alamat github.io).":"Gagal: "+e.message})});
root.appendChild(f);setTimeout(function(){em.focus()},50)}

function connectView(note){root.innerHTML="";var g=guessRepo(),c=S.cfg.owner?S.cfg:g;
var tok=el("input",{type:"password",id:"dvtk",autocomplete:"off",placeholder:"github_pat_..."}),ow=el("input",{type:"text",id:"dvow",value:c.owner||""}),rp=el("input",{type:"text",id:"dvrp",value:c.repo||""}),msg=el("p",{class:"err"}),go=el("button",{class:"pri",type:"submit",text:"Hubungkan"});
if(note)msg.textContent=note;
var f=el("form",{class:"card2 login"},[el("h3",{text:"Hubungkan ke GitHub (sekali saja)",style:"margin-top:0"}),
el("p",{class:"hint",text:"Agar perubahan bisa disimpan ke website, dibutuhkan token GitHub. Token disimpan terenkripsi di perangkat ini dan dibuka dengan password kamu."}),
el("label",{for:"dvtk",text:"GitHub token"}),tok,el("p",{class:"hint",text:"Buat di GitHub: Settings > Developer settings > Fine-grained tokens. Pilih hanya repository website ini, izin Contents: Read and write."}),
el("label",{for:"dvow",text:"Username GitHub"}),ow,el("label",{for:"dvrp",text:"Nama repository"}),rp,msg,el("div",{style:"display:flex;gap:8px;margin-top:16px"},[go,el("button",{type:"button",text:"Batal",onclick:logout})])]);
f.addEventListener("submit",function(ev){ev.preventDefault();go.disabled=true;msg.textContent="";S.token=trim(tok.value);S.cfg={owner:trim(ow.value),repo:trim(rp.value),branch:""};
if(!S.token||!S.cfg.owner||!S.cfg.repo){msg.textContent="Isi token, username, dan nama repository.";go.disabled=false;return}
gh("GET","/repos/"+S.cfg.owner+"/"+S.cfg.repo).then(function(r){S.cfg.branch=r.default_branch||"main";return saveVault()}).then(function(){S.authed=true;main()}).catch(function(e){S.token="";go.disabled=false;msg.textContent=friendly(e)})});
root.appendChild(f);setTimeout(function(){tok.focus()},50)}

function main(){root.innerHTML="";
var pub=el("button",{class:"pri",type:"button",text:"Terbitkan",onclick:publishView});
var chip=el("span",{class:"chip2"});
bar=el("div",{class:"bar"},[el("h2",{text:"Developer mode"}),chip,pub,el("button",{type:"button",text:"Tutup",onclick:closeDev})]);bar._pub=pub;bar._chip=chip;
var tabs=el("div",{class:"tabs",role:"tablist"});
[["photos","Foto & file"],["content","Konten"],["text","Teks"],["settings","Pengaturan"]].forEach(function(t){tabs.appendChild(el("button",{type:"button","aria-pressed":S.tab===t[0],text:t[1],onclick:function(){S.tab=t[0];main()}}))});
view=el("div",{class:"body"});root.appendChild(bar);root.appendChild(tabs);root.appendChild(view);updateBar();
({photos:photosTab,content:contentTab,text:textTab,settings:settingsTab})[S.tab]()}
function updateBar(){if(!bar)return;var n=pendingCount(),changed=S.dirty||n>0;bar._pub.disabled=!changed;bar._chip.textContent=changed?(n?n+" file, ":"")+"belum diterbitkan":"Semua sudah terbit"}

/* ---------- tab: photos & files ---------- */
function thumb(s){var box=el("div",{class:"th"});if(s.k==="pdf"){box.textContent="PDF";return box}
var ex=s.fixed?["jpg"]:(s.k==="logo"?["png","jpg","jpeg","webp"]:["jpg","jpeg","png","webp"]),i=0,im=el("img",{alt:""});
im.onerror=function(){if(++i<ex.length)im.src=window.SITE.U(s.b,ex[i]);else{im.remove();box.textContent="Kosong"}};im.src=window.SITE.U(s.b,ex[0]);box.appendChild(im);return box}
function photosTab(){view.appendChild(el("p",{class:"hint",text:"Pilih Upload di baris mana pun untuk mengganti atau menambah file (bisa langsung dari kamera atau galeri HP). Foto dikecilkan otomatis. Setelah selesai, tekan Terbitkan."}));
var last="",list=null;slots().forEach(function(s){if(s.g!==last){last=s.g;view.appendChild(el("h3",{text:s.g}));list=el("div",{class:"card2",style:"padding:0 14px"});view.appendChild(list)}
var pend=S.pending[s.path],acc=s.k==="pdf"?"application/pdf":"image/*";
var inp=el("input",{type:"file",accept:acc,onchange:function(){var f=inp.files&&inp.files[0];inp.value="";if(f)upload(s,f)}});
list.appendChild(el("div",{class:"slot"},[thumb(s),el("div",{class:"nm"},[el("b",{text:s.l}),el("small",{text:s.path}),pend?el("small",{class:"wait",text:"Menunggu diterbitkan ("+kb(pend.size)+")"}):null]),el("label",{class:"upl"},[document.createTextNode(pend?"Ganti lagi":"Upload"),inp])]))})}
function upload(s,file){window.SITE.toast("Memproses "+file.name+"...");prep(file,s.k).then(function(r){S.pending[s.path]={b64:r.b64,size:r.size};window.SITE.IMGOVR[s.k==="pdf"?s.path:s.b]=URL.createObjectURL(r.blob);S.dirty=true;window.SITE.render();main();window.SITE.toast("Siap. Tekan Terbitkan untuk menayangkan.")}).catch(function(e){window.SITE.toast(e.message)})}

/* ---------- tab: content ---------- */
function ids(){var d=D(),o=[["","(tanpa tautan)"]];d.WORK.concat(d.ORGS).forEach(function(e){o.push(["#"+e.id,e.n||e.t])});return o}
var CAT=[["research","Research"],["publication","Publications"],["student","Student projects"]];
function projFields(){return[{k:"t",l:"Judul",t:"text"},{k:"b",l:"Label status / waktu",t:"text"},{k:"c",l:"Kategori (filter)",t:"select",o:CAT},{k:"p",l:"Deskripsi singkat",t:"area"},{k:"l",l:"Rincian (satu per baris, tampil saat Read more)",t:"lines"},{k:"g",l:"Tag (pisahkan dengan koma)",t:"tags"},{k:"k",l:"Nama file foto (tanpa ekstensi)",t:"text",h:"Foto diunggah di tab Foto & file."},{k:"pdf",l:"Nama file PDF (opsional, misalnya thesis.pdf)",t:"text"},{k:"pn",l:"Catatan di atas tombol PDF",t:"text"}]}
function expFields(){return[{k:"t",l:"Jabatan / peran",t:"text"},{k:"o",l:"Instansi / organisasi",t:"text"},{k:"d",l:"Waktu (misalnya Aug 2025 – Jul 2026)",t:"text"},{k:"n",l:"Nama singkat",t:"text"},{k:"desc",l:"Deskripsi lembaga (tampil di banner)",t:"area"},{k:"l",l:"Poin pekerjaan (satu per baris)",t:"lines"},{k:"col",l:"Warna banner",t:"color"},{k:"ic",l:"Ikon banner",t:"select",o:function(){return window.SITE.icons().map(function(x){return[x,x]})}},{k:"logo",l:"Nama file logo (tanpa ekstensi)",t:"text"},{k:"hb",l:"Nama file gambar latar banner",t:"text"},{k:"ph",l:"Awalan nama file foto (menjadi -1 dan -2)",t:"text"}]}
function newExp(p){var u=uid();return{id:p+"-"+u,col:"#007c78",ic:"sci",logo:"logo-"+p+"-"+u,n:"Baru",hb:"header-"+p+"-"+u,ph:"foto-"+p+"-"+u,desc:"",d:"",t:"Pengalaman baru",o:"",l:[]}}
var COLS=[
{key:"WORK",title:"Work experience",lab:function(x){return x.t+" · "+(x.n||"")},fields:expFields,mk:function(){return newExp("job")}},
{key:"ORGS",title:"Organization experience",lab:function(x){return x.t+" · "+(x.n||"")},fields:expFields,mk:function(){return newExp("org")}},
{key:"PROJECTS",title:"Projects and research",lab:function(x){return x.t},fields:projFields,mk:function(){return{c:"research",b:"",t:"Project baru",p:"",l:[],g:[],img:"",k:"project-"+uid()}}},
{key:"ACH",title:"Achievements",lab:function(x){return x[0]},fields:function(){return[{k:0,l:"Nama prestasi",t:"text"},{k:1,l:"Keterangan (finalist / penerima, penyelenggara)",t:"text"},{k:2,l:"Nama file bukti (tanpa ekstensi)",t:"text"}]},mk:function(){return["Prestasi baru","","sertifikat-"+uid()]}},
{key:"CERTS",title:"Certifications and training",lab:function(x){return x[0]},fields:function(){return[{k:0,l:"Nama sertifikat",t:"text"},{k:1,l:"Nama file gambar (tanpa ekstensi)",t:"text"}]},mk:function(){return["Sertifikat baru","sertifikat-"+uid()]}},
{key:"SKILLS",title:"Skills and tools",lab:function(x){return x[0]},fields:function(){return[{k:0,l:"Nama kelompok",t:"text"},{k:1,l:"Isi (pisahkan dengan koma)",t:"tags"}]},mk:function(){return["Kelompok baru",[]]}},
{key:"LEAD",title:"Leadership (daftar di About)",lab:function(x){return x.b},fields:function(){return[{k:"b",l:"Jabatan (tebal, bisa diklik)",t:"text"},{k:"t",l:"Keterangan",t:"area"},{k:"h",l:"Tautan ke bagian",t:"select",o:ids}]},mk:function(){return{h:"",b:"Jabatan baru",t:""}}}];
function field(item,f){var id="dvf"+(++uidn),v=item[f.k],inp;
if(f.t==="area"||f.t==="lines"){inp=el("textarea",{id:id,rows:f.t==="lines"?5:3});inp.value=f.t==="lines"?(v||[]).join("\n"):(v||"")}
else if(f.t==="select"){inp=el("select",{id:id});(typeof f.o==="function"?f.o():f.o).forEach(function(o){inp.appendChild(el("option",{value:o[0],text:o[1]}))});inp.value=v||""}
else if(f.t==="color"){inp=el("input",{id:id,type:"color"});inp.value=v||"#007c78"}
else{inp=el("input",{id:id,type:"text"});inp.value=f.t==="tags"?(v||[]).join(", "):(v==null?"":v)}
function set(){var x=inp.value;if(f.t==="lines")x=x.split("\n").map(trim).filter(Boolean);else if(f.t==="tags")x=x.split(",").map(trim).filter(Boolean);item[f.k]=x;touch()}
inp.addEventListener("input",set);inp.addEventListener("change",set);
return el("div",null,[el("label",{for:id,text:f.l}),inp,f.h?el("p",{class:"hint",text:f.h}):null])}
function contentTab(){view.appendChild(el("p",{class:"hint",text:"Ketuk judul untuk membuka dan mengubah. Perubahan langsung terlihat di website ini, tetapi baru dilihat orang lain setelah kamu menekan Terbitkan."}));
var d=D();
var ab=el("details",{class:"sec"},[el("summary",{text:"Banner About"})]);ab.appendChild(el("div",{class:"form"},[field(d.ABOUT,{k:"lt",l:"Nama di banner",t:"text"}),field(d.ABOUT,{k:"desc",l:"Teks banner",t:"area"}),field(d.ABOUT,{k:"col",l:"Warna banner",t:"color"})]));view.appendChild(ab);
COLS.forEach(function(c){var arr=d[c.key],sec=el("details",{class:"sec"},[el("summary",{text:c.title+" ("+arr.length+")"})]);if(S.sec[c.key])sec.open=true;sec.addEventListener("toggle",function(){S.sec[c.key]=sec.open});
arr.forEach(function(it,i){var k=c.key+":"+i,row=el("div",{class:"row"}),tt=el("div",{class:"tt",text:c.lab(it)||"(tanpa judul)"});
function mv(dir){return function(){var j=i+dir;if(j<0||j>=arr.length)return;var t=arr[i];arr[i]=arr[j];arr[j]=t;S.itm={};touch();main()}}
row.appendChild(tt);row.appendChild(el("button",{type:"button",text:"↑","aria-label":"Naikkan",onclick:mv(-1)}));row.appendChild(el("button",{type:"button",text:"↓","aria-label":"Turunkan",onclick:mv(1)}));
row.appendChild(el("button",{type:"button",text:"Hapus","aria-label":"Hapus",onclick:function(){if(!confirm("Hapus \""+(c.lab(it)||"item ini")+"\" dari website? (File gambar tidak ikut terhapus.)"))return;arr.splice(i,1);S.itm={};touch();S.sec[c.key]=true;main()}}));
var form=el("div",{class:"form"});c.fields().forEach(function(f){form.appendChild(field(it,f))});form.hidden=!S.itm[k];
row.insertBefore(el("button",{type:"button",text:S.itm[k]?"Tutup":"Ubah",onclick:function(ev){S.itm[k]=!S.itm[k];form.hidden=!S.itm[k];ev.target.textContent=S.itm[k]?"Tutup":"Ubah";tt.textContent=c.lab(it)||"(tanpa judul)"}}),row.children[1]);
sec.appendChild(row);sec.appendChild(form)});
sec.appendChild(el("div",{class:"addrow"},[el("button",{type:"button",text:"+ Tambah",onclick:function(){arr.push(c.mk());S.itm[c.key+":"+(arr.length-1)]=true;S.sec[c.key]=true;touch();main()}})]));
view.appendChild(sec)})}

/* ---------- tab: text ---------- */
var TEXTS=[["lead1","Halaman awal: kalimat utama"],["lead2","Halaman awal: posisi yang dicari"],["about1","About: paragraf 1"],["about2","About: paragraf 2"],["about3","About: terbuka untuk posisi"],["projsub","Projects: kalimat pengantar"],["contact","Let's work together: pesan"],["footer","Footer"]];
function textTab(){view.appendChild(el("p",{class:"hint",text:"Ubah tulisan di website. Pakai **tanda bintang dua** untuk huruf tebal."}));var def=window.SITE.defText();
TEXTS.forEach(function(t){var id="dvt"+t[0],ta=el("textarea",{id:id,rows:3});var T=D().TEXT;ta.value=T[t[0]]!==undefined?T[t[0]]:window.SITE.toMd(def[t[0]]||"");
ta.addEventListener("input",function(){D().TEXT[t[0]]=ta.value;touch()});view.appendChild(el("label",{for:id,text:t[1]}));view.appendChild(ta)});
view.appendChild(el("p",{class:"hint",text:"Daftar Leadership, skills, dan semua kartu diubah di tab Konten."}))}

/* ---------- tab: settings ---------- */
function settingsTab(){var c=S.cfg;view.appendChild(el("div",{class:"card2"},[el("h3",{text:"Koneksi GitHub",style:"margin-top:0"}),el("p",{text:"Repository: "+c.owner+"/"+c.repo+" (cabang "+(c.branch||"main")+")"}),el("p",{class:"ok",text:"Token tersimpan terenkripsi di perangkat ini."}),
el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},[el("button",{type:"button",text:"Ganti token / repository",onclick:function(){connectView("")}}),el("button",{type:"button",text:"Hapus token dari perangkat ini",onclick:function(){if(!confirm("Hapus token dari perangkat ini? Kamu perlu menempelkannya lagi saat login berikutnya."))return;try{localStorage.removeItem("dev.vault")}catch(e){}logout()}})])]));
view.appendChild(el("div",{class:"card2"},[el("h3",{text:"Sesi",style:"margin-top:0"}),el("p",{class:"hint",text:"Keluar akan menutup Developer mode dan membuang perubahan yang belum diterbitkan jika halaman dimuat ulang."}),el("button",{type:"button",text:"Keluar (logout)",onclick:logout})]))}

/* ---------- publish ---------- */
function publishView(){if(S.busy)return;view.innerHTML="";var log=el("div",{class:"log"}),done=el("div");
view.appendChild(el("h3",{text:"Menerbitkan perubahan",style:"margin-top:0"}));view.appendChild(log);view.appendChild(done);
function say(m){log.textContent+=m+"\n"}
S.busy=true;var c=S.cfg,base="/repos/"+c.owner+"/"+c.repo,ver=Date.now(),files=[],sha,tree;
Object.keys(S.pending).forEach(function(p){files.push({path:p,content:S.pending[p].b64,encoding:"base64"})});
var data=D();data.ver=ver;files.push({path:"content.json",content:JSON.stringify({ver:ver,PROJECTS:data.PROJECTS,WORK:data.WORK,ORGS:data.ORGS,ACH:data.ACH,CERTS:data.CERTS,SKILLS:data.SKILLS,ABOUT:data.ABOUT,LEAD:data.LEAD,TEXT:data.TEXT},null,1),encoding:"utf-8"});
say("Menghubungi GitHub...");
gh("GET",base+"/git/ref/heads/"+c.branch).then(function(r){sha=r.object.sha;return gh("GET",base+"/git/commits/"+sha)}).then(function(cm){tree=cm.tree.sha;var entries=[],p=Promise.resolve();
files.forEach(function(f){p=p.then(function(){say("Mengunggah "+f.path+"...");return gh("POST",base+"/git/blobs",{content:f.content,encoding:f.encoding})}).then(function(b){entries.push({path:f.path,mode:"100644",type:"blob",sha:b.sha})})});return p.then(function(){return entries})})
.then(function(entries){say("Menyusun commit...");return gh("POST",base+"/git/trees",{base_tree:tree,tree:entries})})
.then(function(t){var d=new Date(),stamp=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");return gh("POST",base+"/git/commits",{message:"Update portfolio via developer mode ("+stamp+")",tree:t.sha,parents:[sha]})})
.then(function(cm){say("Menyimpan ke cabang "+c.branch+"...");return gh("PATCH",base+"/git/refs/heads/"+c.branch,{sha:cm.sha})})
.then(function(){S.busy=false;S.pending={};S.dirty=false;window.SITE.setVer(ver);say("\nSelesai.");done.appendChild(el("p",{class:"ok",text:"Berhasil diterbitkan. Perubahan terlihat oleh semua orang dalam sekitar 1-2 menit (GitHub Pages sedang memperbarui website)."}));done.appendChild(el("button",{class:"pri",type:"button",text:"Kembali",onclick:main}))})
.catch(function(e){S.busy=false;done.appendChild(el("p",{class:"err",text:friendly(e)}));done.appendChild(el("button",{type:"button",text:"Kembali",onclick:main}))})}

window.addEventListener("beforeunload",function(e){if(S.authed&&(S.dirty||pendingCount())){e.preventDefault();e.returnValue=""}});
window.DEV={open:open,_S:S};
})();
