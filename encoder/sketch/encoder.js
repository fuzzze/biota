// Biota — Sketch encoder.
// Encrypt + ECC + encode an arbitrary string into the rotations of a chain of
// hexagonal symbol instances (honeycomb grid), 6 angles = base-6 digits.
//
// HOW TO RUN:
//   1. Select the hex symbol (or a group containing an instance of it).
//   2. Sketch -> Plugins -> Run Script... (enable Developer mode first), paste this.
//   3. Enter Text / Tiles per row / Secret. The result group "encrypted" appears
//      next to the selection. Export it to PNG.
//
// Constants ITER/NSYM/KBLK MUST match decoder/decode.py.

const sketch = require('sketch')
const ITER = 20000, NSYM = 8, KBLK = 223

// ===================== SHA-256 (pure JS) =====================
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
function sha256(bytes){const rotr=(x,n)=>(x>>>n)|(x<<(32-n));let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const l=bytes.length,msg=bytes.slice();msg.push(0x80);while(msg.length%64!==56)msg.push(0);const hi=Math.floor(l/0x20000000),lo=(l*8)>>>0;for(let i=0;i<4;i++)msg.push((hi>>>(24-8*i))&255);for(let i=0;i<4;i++)msg.push((lo>>>(24-8*i))&255);const w=new Array(64);for(let off=0;off<msg.length;off+=64){for(let i=0;i<16;i++)w[i]=((msg[off+4*i]<<24)|(msg[off+4*i+1]<<16)|(msg[off+4*i+2]<<8)|msg[off+4*i+3])>>>0;for(let i=16;i<64;i++){const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0}let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);const ch=(e&f)^((~e)&g);const t1=(h+S1+ch+K[i]+w[i])>>>0;const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);const maj=(a&b)^(a&c)^(b&c);const t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}H=[(H[0]+a)>>>0,(H[1]+b)>>>0,(H[2]+c)>>>0,(H[3]+d)>>>0,(H[4]+e)>>>0,(H[5]+f)>>>0,(H[6]+g)>>>0,(H[7]+h)>>>0]}const o=[];for(const x of H)o.push((x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);return o}

// ===================== crypto =====================
function utf8(s){const b=[];for(const ch of s){let c=ch.codePointAt(0);if(c<0x80)b.push(c);else if(c<0x800)b.push(0xC0|c>>6,0x80|c&63);else if(c<0x10000)b.push(0xE0|c>>12,0x80|c>>6&63,0x80|c&63);else b.push(0xF0|c>>18,0x80|c>>12&63,0x80|c>>6&63,0x80|c&63)}return b}
const cat=(...a)=>[].concat(...a)
function derive(sb,salt){let k=sha256(cat(sb,salt));for(let i=0;i<ITER;i++)k=sha256(cat(k,sb));return k}
function keystream(key,n){const o=[];let c=0;while(o.length<n){const blk=sha256(cat(key,[(c>>>24)&255,(c>>>16)&255,(c>>>8)&255,c&255]));for(const x of blk)o.push(x);c++}return o.slice(0,n)}
function encrypt(plain,secret){const sb=utf8(secret);const salt=[];for(let i=0;i<8;i++)salt.push(Math.floor(Math.random()*256));const key=derive(sb,salt);const ks=keystream(key,plain.length);const ct=plain.map((b,i)=>b^ks[i]);const mac=sha256(cat(key,ct)).slice(0,4);const N=plain.length;return cat([1,(N>>>8)&255,N&255],salt,mac,ct)}

// ===================== Reed-Solomon (GF256, prim=0x11d, gen=2, fcr=0) =====================
function rsInit(){const exp=new Array(512),log=new Array(256);let x=1;for(let i=0;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&0x100)x^=0x11d}for(let i=255;i<512;i++)exp[i]=exp[i-255];return{exp,log}}
const GF=rsInit();const gmul=(a,b)=>(a===0||b===0)?0:GF.exp[(GF.log[a]+GF.log[b])%255]
function rsGenPoly(nsym){let g=[1];for(let i=0;i<nsym;i++){const f=[1,GF.exp[i]];const ng=new Array(g.length+1).fill(0);for(let a=0;a<g.length;a++)for(let b=0;b<f.length;b++)ng[a+b]^=gmul(g[a],f[b]);g=ng}return g}
function rsEncode(msg,nsym){const gen=rsGenPoly(nsym);const out=msg.concat(new Array(nsym).fill(0));for(let i=0;i<msg.length;i++){const coef=out[i];if(coef!==0){for(let j=1;j<gen.length;j++)out[i+j]^=gmul(gen[j],coef)}}return msg.concat(out.slice(msg.length))}
function rsFrame(payload){let body=[];for(let i=0;i<payload.length;i+=KBLK)body=body.concat(rsEncode(payload.slice(i,i+KBLK),NSYM));const bl=body.length;return rsEncode([(bl>>>8)&255,bl&255],4).concat(body)}

// ===================== dialog: text + cols + secret =====================
function prompt(){
  const alert=NSAlert.alloc().init()
  alert.setMessageText('Biota — encrypt + ECC encode into rotations')
  alert.addButtonWithTitle('OK'); alert.addButtonWithTitle('Cancel')
  const Wd=320,view=NSView.alloc().initWithFrame(NSMakeRect(0,0,Wd,104))
  const lbl=(y,t)=>{const l=NSTextField.alloc().initWithFrame(NSMakeRect(0,y,110,18));l.setStringValue(t);l.setEditable(false);l.setBezeled(false);l.setDrawsBackground(false);l.setSelectable(false);return l}
  const tText=NSTextField.alloc().initWithFrame(NSMakeRect(114,74,Wd-114,24));tText.setStringValue('Attack at dawn!')
  const tCols=NSTextField.alloc().initWithFrame(NSMakeRect(114,40,80,24));tCols.setStringValue('8')
  const tSec=NSSecureTextField.alloc().initWithFrame(NSMakeRect(114,6,Wd-114,24))
  view.addSubview(lbl(78,'Text:'));view.addSubview(tText)
  view.addSubview(lbl(44,'Tiles per row:'));view.addSubview(tCols)
  view.addSubview(lbl(10,'Secret:'));view.addSubview(tSec)
  tText.setNextKeyView(tCols);tCols.setNextKeyView(tSec)
  alert.setAccessoryView(view);alert.window().setInitialFirstResponder(tText)
  if(alert.runModal()!=1000)return null
  return {text:String(tText.stringValue()),cols:Math.max(1,parseInt(String(tCols.stringValue()),10)||1),secret:String(tSec.stringValue())}
}

// ===================== main =====================
const inp=prompt(); if(!inp) throw new Error('Cancelled')
const doc=sketch.getSelectedDocument()
const sel=doc.selectedLayers.layers[0]; if(!sel) throw new Error('Select the symbol (or a group with it)')
const srcInst=sel.type==='SymbolInstance'?sel:sel.layers.find(l=>l.type==='SymbolInstance')
if(!srcInst) throw new Error('No symbol in selection')
const master=doc.getSymbols().find(s=>s.symbolId===srcInst.symbolId)
const W=srcInst.frame.width,dx=Math.round(W*Math.sqrt(3)/2),dy=W*0.75,off=dx/2
const toDigits=b=>[Math.floor(b/216)%6,Math.floor(b/36)%6,Math.floor(b/6)%6,b%6]
const frame=rsFrame(encrypt(utf8(inp.text),inp.secret))
let digits=[].concat(...frame.map(toDigits))
const pad=(inp.cols-digits.length%inp.cols)%inp.cols;for(let i=0;i<pad;i++)digits.push(0)
const ox=sel.frame.x+sel.frame.width+200,oy=sel.frame.y
const insts=digits.map((d,i)=>{const r=Math.floor(i/inp.cols),c=i%inp.cols;const t=master.createNewInstance();t.frame.x=ox+(r%2===0?off:0)+c*dx;t.frame.y=oy+r*dy;t.transform.rotation=d*60;return t})
const grp=new sketch.Group({parent:sel.parent,name:'encrypted',layers:insts})
doc.selectedLayers=[grp]
sketch.UI.message(`Encrypted+ECC: ${insts.length} tiles, ${frame.length} bytes`)
