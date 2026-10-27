"use strict";
/* WaveLog（satoshi-hello-vlioilv/WaveLog）の static/js/list/list-formula.js をそのまま持ち込んだもの。
   品質異常の計算列・読み替えルールの式で、WaveLog と同じ書き方・同じ答えにするため。直すときは WaveLog と揃える。 */
/* list-formula.js: 一覧へ「計算で作る列」を足す(§9.111 ⑦)。

要望は「計算式で様々な条件を追加できるが、元の列がないと使えないので、
純粋に追加したい時に困る」。つまり**データ側に無い列を、既にある列から
作って一覧へ並べたい**。

設計の要点
------------------------------------------------------------
・**表示だけの列**。並べ替え・絞り込みはサーバーがデータ側の列に対して
  行うので、ここで作った列は対象にならない。**できないことは画面にそう
  書く**(できるように見せて効かないのが一番わかりにくい)。
・**`eval`を使わない。** 式は利用者が書くもので、しかもマスタに保存されて
  他のPCでも動く。文字列をそのままJSとして実行する作りにすると、保存した
  式がそのPCで何でもできてしまう。ここでは自前で字句解析→構文解析→評価を
  行い、**書ける物を最初から限る**。
・**壊れた式は列ごと落とさず、その行だけ空にする**(表示ルールと同じ方針)。
  式の誤りはパネル側で書いている最中に伝える。

書ける物
------------------------------------------------------------
  [列名]              その行のその列の値
  数値 / '文字列'     そのまま
  + - * / %  ( )      四則(+は数値どうしなら足し算、片方が文字なら連結)
  = <> < <= > >=      比較(真なら1、偽なら0)
  and / or / not      論理
  if(条件, 真, 偽)    条件分岐
  num(x) text(x) round(x,n) abs(x) len(x) left(x,n) right(x,n)
  concat(...) trim(x) upper(x) lower(x) coalesce(...)
*/
(function(){
 /* 長すぎる式は読めないので入口で断る。**2000字**（§9.474）——表示ルールを式へ変換すると
    （行＝if の入れ子）実際のルール（4条件×6行）で 400字を超えた。 */
 const MAX_LEN=2000;
 const NUM=/^\d+(\.\d+)?/;

 /* ---------- 字句解析 ---------- */
 function lex(src){
  const out=[];let i=0;
  const s=String(src||'');
  while(i<s.length){
   const ch=s[i];
   if(/\s/.test(ch)){i++;continue}
   if(ch==='['){
    const end=s.indexOf(']',i+1);
    if(end<0)throw Error('列名の [ ] が閉じていません');
    out.push({t:'col',v:s.slice(i+1,end)});i=end+1;continue;
   }
   if(ch==="'"||ch==='"'){
    const q=ch;let j=i+1,buf='';
    while(j<s.length&&s[j]!==q){buf+=s[j];j++}
    if(j>=s.length)throw Error('文字列の引用符が閉じていません');
    out.push({t:'str',v:buf});i=j+1;continue;
   }
   const m=s.slice(i).match(NUM);
   if(m){out.push({t:'num',v:parseFloat(m[0])});i+=m[0].length;continue}
   const two=s.slice(i,i+2);
   if(two==='<='||two==='>='||two==='<>'||two==='!='){out.push({t:'op',v:two==='!='?'<>':two});i+=2;continue}
   if('+-*/%(),'.includes(ch)){out.push({t:ch==='('||ch===')'||ch===','?ch:'op',v:ch});i++;continue}
   if(ch==='='||ch==='<'||ch==='>'){out.push({t:'op',v:ch});i++;continue}
   const w=s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
   if(w){out.push({t:'name',v:w[0].toLowerCase()});i+=w[0].length;continue}
   throw Error(`使えない文字です: ${ch}`);
  }
  return out;
 }

 /* ---------- 構文解析(下降型) ---------- */
 function parse(src){
  if(String(src||'').length>MAX_LEN)throw Error(`式が長すぎます(${MAX_LEN}文字まで)`);
  const ts=lex(src);let p=0;
  const peek=()=>ts[p];
  const eat=(t,v)=>{const x=ts[p];if(!x||x.t!==t||(v!==undefined&&x.v!==v))return null;p++;return x};
  const expect=(t,v)=>{const x=eat(t,v);if(!x)throw Error(`${v||t} が必要です`);return x};

  function orExpr(){
   let n=andExpr();
   while(peek()&&peek().t==='name'&&peek().v==='or'){p++;n={k:'or',a:n,b:andExpr()}}
   return n;
  }
  function andExpr(){
   let n=cmpExpr();
   while(peek()&&peek().t==='name'&&peek().v==='and'){p++;n={k:'and',a:n,b:cmpExpr()}}
   return n;
  }
  function cmpExpr(){
   let n=addExpr();
   while(peek()&&peek().t==='op'&&['=','<>','<','<=','>','>='].includes(peek().v)){
    const op=ts[p++].v;n={k:'cmp',op,a:n,b:addExpr()};
   }
   return n;
  }
  function addExpr(){
   let n=mulExpr();
   while(peek()&&peek().t==='op'&&(peek().v==='+'||peek().v==='-')){
    const op=ts[p++].v;n={k:'bin',op,a:n,b:mulExpr()};
   }
   return n;
  }
  function mulExpr(){
   let n=unary();
   while(peek()&&peek().t==='op'&&['*','/','%'].includes(peek().v)){
    const op=ts[p++].v;n={k:'bin',op,a:n,b:unary()};
   }
   return n;
  }
  function unary(){
   if(peek()&&peek().t==='op'&&peek().v==='-'){p++;return {k:'neg',a:unary()}}
   if(peek()&&peek().t==='name'&&peek().v==='not'){p++;return {k:'not',a:unary()}}
   return atom();
  }
  function atom(){
   const x=peek();
   if(!x)throw Error('式が途中で終わっています');
   if(x.t==='num'){p++;return {k:'num',v:x.v}}
   if(x.t==='str'){p++;return {k:'str',v:x.v}}
   if(x.t==='col'){p++;return {k:'col',v:x.v}}
   if(x.t==='('){p++;const n=orExpr();expect(')');return n}
   if(x.t==='name'){
    p++;
    if(!eat('('))throw Error(`関数の ( が必要です: ${x.v}`);
    const args=[];
    if(!eat(')')){
     args.push(orExpr());
     while(eat(','))args.push(orExpr());
     expect(')');
    }
    /* **知らない関数はここで断る。** 評価時まで待つと、書いている最中は
       何も言われず、実データの行が全部空になってから気づくことになる。 */
    if(x.v!=='if'&&!Object.prototype.hasOwnProperty.call(FUNCS,x.v))
     throw Error(`知らない関数です: ${x.v}`);
    if(x.v==='if'&&args.length<2)throw Error('if は if(条件, 真のとき, 偽のとき) です');
    const need=ARITY[x.v];
    if(need!==undefined&&args.length!==need)
     throw Error(`${x.v} は引数が${need}個です（${args.length}個でした）`);
    const rng=ARITY_RANGE[x.v];
    if(rng&&(args.length<rng[0]||args.length>rng[1]))
     throw Error(`${x.v} は引数が${rng[0]}〜${rng[1]}個です（${args.length}個でした）`);
    /* 正規表現を字で書いたときは**書いている最中に**確かめる（壊れた書き方を
       実データの行が全部空になってから知らせない）。 */
    if(REGEX_FUNCS.has(x.v)&&args[1]&&args[1].k==='str'){
     try{reOf(String(args[1].v),'')}
     catch(e){throw Error(`${x.v} の正規表現として読めません: ${e.message}`)}
    }
    return {k:'call',name:x.v,args};
   }
   throw Error('式として読めません');
  }
  const node=orExpr();
  if(p<ts.length)throw Error('式の後ろに余分なものがあります');
  return node;
 }

 /* ---------- 評価 ---------- */
 const numOf=v=>{
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number')return v;
  const n=parseFloat(String(v).replace(/,/g,''));
  return Number.isFinite(n)?n:null;
 };
 const textOf=v=>v===null||v===undefined?'':String(v);
 const truthy=v=>{const n=numOf(v);return n===null?textOf(v)!=='':n!==0};
 /* 比較のためだけの「本当に数か」。**元の文字へ戻して一致するときだけ数**
    とみなす。`numOf`は緩く読む(計算では '010'×2=20 でよい)が、比較で
    それをやると **`[コード] = 10` が '010' に当たってしまう**——先頭ゼロの
    コードは実データに普通にあるので、照合が黙って壊れる。 */
 /* **表示ルールの比べ方**（§9.477）: 両辺が数として読めれば数で、そうでなければ字で比べる（-1/0/1）。
    数の読み方は**緩い**——前後の空白・3桁区切り・先頭のゼロ・「+」を許す（実データは同じ項目でも
    '5'・'05'・'5.0'・'1,000' が混ざる）。上の比較演算子（`=`等）は先頭ゼロのコードを取り違えないために
    **厳しく**読むので、2つは別の約束。**表示ルールの判定（base.js）もこの1本を呼ぶ**——ルールを式へ
    変換したとき、同じ比べ方の式（`cmp(a,b) = 0`）で同じ答えになる。 */
 const LOOSE_NUM=/^[-+]?(\d+\.?\d*|\.\d+)$/;
 const looseNum=v=>{
  const t=textOf(v).trim().replace(/,/g,'');
  if(!t||!LOOSE_NUM.test(t))return null;
  const n=Number(t);return Number.isFinite(n)?n:null;
 };
 function cmp(a,b){
  const x=looseNum(a),y=looseNum(b);
  if(x!==null&&y!==null)return x<y?-1:x>y?1:0;
  const s=textOf(a),t=textOf(b);
  return s<t?-1:s>t?1:0;
 }
 const strictNum=v=>{
  if(typeof v==='number')return v;
  const s=textOf(v).trim();
  if(s==='')return null;
  const n=Number(s);
  return Number.isFinite(n)&&String(n)===s?n:null;
 };

 /* ---------- 文字列からの抽出・変換（§9.464、利用者の指示「データの抽出などは対応できて
    いないので、文字列からの抽出や変換処理もできるように」） ----------
    正規表現は利用者が書く。**壊れた書き方はその行を空にする**（列ごと落とさない・
    `compile().run`が受ける）。長すぎる書き方は断り、作った正規表現は使い回す
    （行ごとに作り直すと200行×列で効いてくる）。 */
 const RE_MAX=200;
 /* 重すぎる正規表現・長すぎる答えを断る（版 3.52.1。サーバーの services/formula.py の regex_risk・RE_TEXT_MAX・STR_MAX と同じ決まり）:
    ① 繰り返しを含むかっこを、さらに繰り返す（(a+)+ の形） ② 「.」の繰り返しが 3 つ以上。調べる字は 2000 字まで・答えは 10 万字まで */
 const RE_TEXT_MAX=2000,STR_MAX=100000,DOT_REPEAT_MAX=2,QUANT=/[*+]|\{[0-9]+(?:,[0-9]*)?\}/y;
 function quantAt(src,i){QUANT.lastIndex=i;const m=QUANT.exec(src);return m?QUANT.lastIndex:-1}
 function regexRisk(src){
  const st=[false];let i=0,inClass=false,dots=0;const n=src.length;
  while(i<n){
   const c=src[i];
   if(c==='\\'){i+=2;continue}
   if(inClass){inClass=c!==']';i++;continue}
   if(c==='['){inClass=true;i++;continue}
   if(c==='('){st.push(false);i++;continue}
   if(c===')'){
    const inner=st.length>1?st.pop():false;i++;
    const q=quantAt(src,i);
    if(q>=0&&inner)return '繰り返しを含むかっこを、さらに繰り返す正規表現は使えません（とても重くなるため）';
    if(q>=0||inner)st[st.length-1]=true;
    continue;
   }
   const q=quantAt(src,i);
   if(q>=0){st[st.length-1]=true;if(i>0&&src[i-1]==='.'&&(i<2||src[i-2]!=='\\'))dots++;i=q;continue}
   i++;
  }
  return dots>DOT_REPEAT_MAX?`「.*」「.+」は ${DOT_REPEAT_MAX} つまでです（とても重くなるため）`:'';
 }
 const tooLong=()=>Error(`答えが長すぎます（${STR_MAX}文字まで）`);
 function reText(v){const t=textOf(v);if(t.length>RE_TEXT_MAX)throw Error(`正規表現で調べる字は${RE_TEXT_MAX}文字までです`);return t}
 const reCache=new Map();
 function reOf(src,flags){
  const k=flags+'\u0000'+src;
  if(reCache.has(k))return reCache.get(k);
  if(src.length>RE_MAX)throw Error(`正規表現は${RE_MAX}文字までです`);
  const why=regexRisk(src);
  if(why)throw Error(why);
  const re=new RegExp(src,flags);
  if(reCache.size>200)reCache.clear();
  reCache.set(k,re);
  return re;
 }
 /* ---------- 変換表（版 3.42.0。LotScope だけ。マスタ「変換表」: コードの読み替え・条件の判定表） ----------
    conv('表の名前', 値1, 値2, …) … 値を表の「入力」の順に渡すと、上から順に見て最初に当たった行の「出す値」を返す。
    どの行にも当たらなければ「その他」。出す値が = で始まれば式（[入力の名前] で入力の値を読む。例: =[地取区分] は元の値のまま）。
    表は画面が変換表のマスタを読んで setTables で渡す（サーバーは services/formula.py の use_tables。同じ決まり・同じ答え）。
    表の形: {inputs:[{name, type:'text'|'num'}], rows:[{when:{入力の名前:[試し…]}, out}], other}
      行の when は 入力ごとの試しの並び（並びの中は「または」・入力どうしは「かつ」。書いていない入力は不問。when が空なら必ず当たる）
      試し {op, v:[値…]}: eq（どれかと同じ）・ne（どれとも違う）・starts・nstarts（で始まる／始まらない）・ends・nends・contains・ncontains・
        empty（空欄）・filled（空欄でない）・range（{min, max, minInc, maxInc}。数に読める値だけ）
      字は前後の空白を除いて比べる（大小は区別する）。eq・ne は、入力が数（type:'num'）なら数で比べる（26 と 26.0 は同じ）
    表が無い・壊れているときは空（その行だけ空にする決まりと同じ） */
 let convSource=()=>null;
 const convCompiled=new WeakMap();
 const convText=v=>textOf(v).trim();
 function convEq(s,x,type){
  const t=String(x).trim();
  if(type==='num'){const a=looseNum(s),b=looseNum(t);if(a!==null&&b!==null)return a===b}
  return s===t;
 }
 function convTest(t,v,type){
  const s=convText(v),vs=Array.isArray(t.v)?t.v.map(textOf):[];
  const any=f=>vs.some(x=>x!==''&&f(x));
  switch(t.op){
   case 'eq':return vs.some(x=>convEq(s,x,type));
   case 'ne':return !vs.some(x=>convEq(s,x,type));
   case 'starts':return any(x=>s.startsWith(x));
   case 'nstarts':return !any(x=>s.startsWith(x));
   case 'ends':return any(x=>s.endsWith(x));
   case 'nends':return !any(x=>s.endsWith(x));
   case 'contains':return any(x=>s.includes(x));
   case 'ncontains':return !any(x=>s.includes(x));
   case 'empty':return s==='';
   case 'filled':return s!=='';
   case 'range':{
    const n=looseNum(s);if(n===null)return false;
    const lo=t.min==null||t.min===''?null:looseNum(t.min),hi=t.max==null||t.max===''?null:looseNum(t.max);
    if(lo!==null&&(t.minInc===false?!(n>lo):!(n>=lo)))return false;
    if(hi!==null&&(t.maxInc===false?!(n<hi):!(n<=hi)))return false;
    return true;
   }
  }
  return false;
 }
 /* 出す値（= で始まれば式）を 1 度だけ読む。読めない式は null（当たったら空） */
 function convOut(o){
  const t=o==null?'':String(o);
  if(!t.startsWith('='))return {text:t};
  try{return {f:compile(t.slice(1))}}catch(e){return {bad:true}}
 }
 function convPrep(tb){
  let c=convCompiled.get(tb);
  if(c)return c;
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x),list=v=>(Array.isArray(v)?v:[]).filter(obj);
  const inputs=list(tb.inputs).map(x=>({name:String(x.name),type:x.type==='num'?'num':'text'}));
  c={inputs,rows:list(tb.rows).map(r=>({when:obj(r.when)?r.when:{},out:convOut(r.out)})),other:convOut(tb.other)};
  convCompiled.set(tb,c);
  return c;
 }
 function convGive(o,vals){
  if(o.bad)return null;
  if(!o.f)return o.text;
  const v=o.f.run(vals);return v===undefined?null:v;
 }
 function convRun(a){return convWith(convSource(textOf(a[0])),a.slice(1))}
 /* 表 tb に値の並びを渡した答え（マスタの変換表の「試す」も使う: 保存する前の表で試す） */
 function convWith(tb,values){
  if(!tb||typeof tb!=='object'||Array.isArray(tb))return null;
  const c=convPrep(tb),vals={};
  c.inputs.forEach((x,i)=>{vals[x.name]=i<values.length?values[i]:null});
  for(const r of c.rows){
   if(c.inputs.every(x=>{const ts=r.when[x.name];return !Array.isArray(ts)||!ts.length||ts.some(t=>!!t&&typeof t==='object'&&convTest(t,vals[x.name],x.type))}))
    return convGive(r.out,vals);
  }
  return convGive(c.other,vals);
 }
 /* 位置は**1から数える**（Excelの MID／FIND と同じ・現場の数え方）。 */
 const posOf=v=>{const n=numOf(v);return n===null?1:Math.max(1,Math.floor(n))};
 /* ---------- 版 3.46.0 で足した関数（利用者の要望「文字列カウント・ほかの便利な関数」）。
    サーバー（services/formula.py）と同じ決まり・同じ答え（tests/test_formula_parity.py が突き合わせる） ---------- */
 const nums=a=>a.map(numOf).filter(n=>n!==null);
 const digitsOf=v=>Math.trunc(Math.max(0,Math.min(8,numOf(v)||0)));
 /* Excel の ROUNDUP（0 から遠い側）・ROUNDDOWN（0 の側）。x×10^桁 の小さな誤差は 15 桁で丸めてから切る */
 function roundDir(a,up){const n=numOf(a[0]);if(n===null)return null;
  const p=Math.pow(10,a.length>1?digitsOf(a[1]):0),t=parseFloat((Math.abs(n)*p).toPrecision(15));
  return (n<0?-1:1)*(up?Math.ceil(t):Math.floor(t))/p}
 const REPT_MAX=10000,LENB_ONE=/[\x00-\x7f\uff61-\uff9f]/;
 /* 日時（年月日・時刻）。数字は半角だけ。区切りは - / . 年月日 と、日と時刻の間の T・空白（全角の空白も） */
 const D_YMD=/^([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T \u3000]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?$/,
       D_YY=/^([0-9]{2})\/([0-9]{1,2})\/([0-9]{1,2})(?:[T \u3000]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?$/,
       D_8=/^([0-9]{4})([0-9]{2})([0-9]{2})$/,D_T=/^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/,
       DIM=[31,28,31,30,31,30,31,31,30,31,30,31];
 /* 1970-01-01 からの日数（days_from_civil。整数だけで計算する） */
 function daysOf(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,
  doy=Math.floor((153*(m+(m>2?-3:9))+2)/5)+d-1;return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468}
 /* 値 → [年,月,日,時,分,秒,日付がある]。読めなければ null（時刻だけは 1970-01-01 の時刻） */
 function when(v){
  const t=textOf(v).trim();let m=t.match(D_YMD),yy=false,g,y,has=true;
  if(!m){m=t.match(D_YY);yy=!!m}
  if(!m)m=t.match(D_8);
  if(m){g=m.slice(1).map(x=>x?parseInt(x,10):0);while(g.length<6)g.push(0);y=yy?g[0]+2000:g[0]}
  else{m=t.match(D_T);if(!m)return null;g=[1970,1,1].concat(m.slice(1).map(x=>x?parseInt(x,10):0));y=1970;has=false}
  const mo=g[1],d=g[2],h=g[3],mi=g[4],sec=g[5];
  const dim=mo===2&&(y%4===0&&(y%100!==0||y%400===0))?29:(mo>=1&&mo<=12?DIM[mo-1]:0);
  if(!(d>=1&&d<=dim&&h<=23&&mi<=59&&sec<=59))return null;
  return [y,mo,d,h,mi,sec,has];
 }
 const secOf=w=>daysOf(w[0],w[1],w[2])*86400+w[3]*3600+w[4]*60+w[5];
 const DATEDIFF_UNITS={d:86400,'日':86400,h:3600,'時':3600,'時間':3600,m:60,'分':60,s:1,'秒':1};
 const partOf=(i,needDate=true)=>a=>{const w=when(a[0]);return !w||(needDate&&!w[6])?null:w[i]};
 const FUNCS={
  num:a=>numOf(a[0]),
  text:a=>textOf(a[0]),
  abs:a=>{const n=numOf(a[0]);return n===null?null:Math.abs(n)},
  round:a=>{const n=numOf(a[0]);if(n===null)return null;
            const d=Math.max(0,Math.min(8,numOf(a[1])||0));
            const p=Math.pow(10,d);return Math.round(n*p)/p},
  len:a=>textOf(a[0]).length,
  left:a=>textOf(a[0]).slice(0,Math.max(0,numOf(a[1])||0)),
  right:a=>{const n=Math.max(0,numOf(a[1])||0);return n?textOf(a[0]).slice(-n):''},
  trim:a=>textOf(a[0]).trim(),
  upper:a=>textOf(a[0]).toUpperCase(),
  lower:a=>textOf(a[0]).toLowerCase(),
  concat:a=>a.map(textOf).join(''),
  coalesce:a=>{for(const v of a){if(v!==null&&v!==undefined&&v!=='')return v}return ''},
  /* mid(x, 何文字目から, 何文字)。文字数を省くと最後まで。 */
  mid:a=>{const t=textOf(a[0]),st=posOf(a[1])-1;
          const n=a.length>2?Math.max(0,numOf(a[2])||0):t.length;return t.slice(st,st+n)},
  /* find(x, 探す字)。見つかった位置（1から）、無ければ0。 */
  find:a=>{const i=textOf(a[0]).indexOf(textOf(a[1]));return i<0?0:i+1},
  /* replace(x, 探す字, 置く字)。**全部**置き換える（1つ目だけにすると、2つ目が残って気づけない）。 */
  replace:a=>{const t=textOf(a[0]),sub=textOf(a[1]),r=textOf(a[2]);const hits=sub===''?t.length+1:t.split(sub).length-1;
               if(t.length+hits*(r.length-sub.length)>STR_MAX)throw tooLong();return t.split(sub).join(r)},
  /* extract(x, 正規表現[, 組])。合った部分（組を指定すればその組）。合わなければ空。 */
  extract:a=>{const m=reText(a[0]).match(reOf(textOf(a[1]),''));
              if(!m)return '';const g=a.length>2?Math.max(0,numOf(a[2])||0):0;return m[g]===undefined?'':m[g]},
  /* match(x, 正規表現)。合えば1・合わなければ0（条件にそのまま使える）。 */
  match:a=>reOf(textOf(a[1]),'').test(reText(a[0]))?1:0,
  /* regreplace(x, 正規表現, 置く字)。$1 などで組を使える。 */
  regreplace:a=>{const t=reText(a[0]),r=textOf(a[2]);if(r.length*(t.length+1)+t.length>STR_MAX)throw tooLong();
                 return t.replace(reOf(textOf(a[1]),'g'),r)},
  /* split(x, 区切り, 何番目)。1から数える。無ければ空。 */
  split:a=>{const sep=textOf(a[1]);const parts=sep?textOf(a[0]).split(sep):[textOf(a[0])];
            const v=parts[posOf(a[2])-1];return v===undefined?'':v},
  contains:a=>textOf(a[0]).includes(textOf(a[1]))?1:0,
  /* cmp(a, b): 表示ルールと同じ比べ方（-1/0/1・§9.477）。 */
  cmp:a=>cmp(a[0],a[1]),
  startswith:a=>textOf(a[0]).startsWith(textOf(a[1]))?1:0,
  endswith:a=>textOf(a[0]).endsWith(textOf(a[1]))?1:0,
  /* 全角の英数記号・空白を半角へ（NFKC）。半角カナは全角カナになる（NFKCの決まり）。 */
  hankaku:a=>textOf(a[0]).normalize('NFKC'),
  /* padleft(x, 桁, 埋める字)。埋める字を省くと0。 */
  /* conv('変換表の名前', 値…)。変換表で読み替える（上の説明）。 */
  conv:a=>convRun(a),
  padleft:a=>textOf(a[0]).padStart(Math.max(0,Math.min(64,numOf(a[1])||0)),a.length>2?(textOf(a[2])||'0'):'0'),
  /* count(x, 字): 字が何回出てくるか（重ならない数え方）。regcount(x, 正規表現): 合う所の数 */
  count:a=>{const t=textOf(a[1]);return t?textOf(a[0]).split(t).length-1:0},
  regcount:a=>(reText(a[0]).match(reOf(textOf(a[1]),'g'))||[]).length,
  /* lenb(x): 半角の英数記号・半角カナを 1、ほかを 2 と数えた長さ（Excel の LENB） */
  lenb:a=>{const t=textOf(a[0]);let n=0;for(let i=0;i<t.length;i++)n+=LENB_ONE.test(t[i])?1:2;return n},
  rept:a=>{const t=textOf(a[0]);let n=Math.trunc(Math.max(0,Math.min(1000,numOf(a[1])||0)));
           if(t&&t.length*n>REPT_MAX)n=Math.floor(REPT_MAX/t.length);return t.repeat(n)},
  min:a=>{const x=nums(a);return x.length?Math.min(...x):null},
  max:a=>{const x=nums(a);return x.length?Math.max(...x):null},
  sum:a=>{const x=nums(a);return x.length?x.reduce((s,v)=>s+v,0):null},
  avg:a=>{const x=nums(a);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null},
  int:a=>{const n=numOf(a[0]);return n===null?null:Math.floor(n)},
  ceil:a=>{const n=numOf(a[0]);return n===null?null:Math.ceil(n)},
  roundup:a=>roundDir(a,true),
  rounddown:a=>roundDir(a,false),
  sqrt:a=>{const n=numOf(a[0]);return n===null||n<0?null:Math.sqrt(n)},
  isnum:a=>strictNum(a[0])===null?0:1,
  isblank:a=>textOf(a[0]).trim()===''?1:0,
  /* ifs(条件1, 答え1, …[, どれでもない時])・switch(x, 値1, 答え1, …[, どれでもない時])（値は = と同じ比べ方） */
  ifs:a=>{for(let i=0;i+1<a.length;i+=2)if(truthy(a[i]))return a[i+1];return a.length%2?a[a.length-1]:''},
  switch:a=>{for(let i=1;i+1<a.length;i+=2)if(eqOf(a[0],a[i]))return a[i+1];return a.length%2===0?a[a.length-1]:''},
  year:partOf(0),month:partOf(1),day:partOf(2),hour:partOf(3,false),minute:partOf(4,false),
  /* weekday(x): 1＝日 〜 7＝土（Excel の WEEKDAY と同じ） */
  weekday:a=>{const w=when(a[0]);return !w||!w[6]?null:((daysOf(w[0],w[1],w[2])%7)+7+4)%7+1},
  date:a=>{const w=when(a[0]);return !w||!w[6]?null:`${String(w[0]).padStart(4,'0')}-${String(w[1]).padStart(2,'0')}-${String(w[2]).padStart(2,'0')}`},
  /* datediff(始め, 終わり[, 単位])＝終わり−始め（d＝日〈既定〉・h＝時間・m＝分・s＝秒） */
  datediff:a=>{const x=when(a[0]),y=when(a[1]),u=DATEDIFF_UNITS[a.length>2?textOf(a[2]).trim().toLowerCase():'d'];
               return !x||!y||!u?null:(secOf(y)-secOf(x))/u},
  /* kamadate(釜番[, 基準日])（版 3.51.2）: 釜番（週・曜日〈日＝1〜土＝7〉・何番目の 3 桁）→ 日付。釜番は月を持たないので、基準日（省くと今日）の
     前の月・その月・次の月のうち、その週・曜日の日付が基準日にいちばん近い物（同じなら前）。月の中の数え方は利用者の kama_to_date（VBA）と同じ */
  kamadate:a=>{const k=textOf(a[0]).trim();if(!/^[0-9]{3}$/.test(k))return null;const wk=+k[0],wd=+k[1];if(wk<1||wk>5||wd<1||wd>7)return null;
               let y,m,d0;if(a.length>1){const w=when(a[1]);if(!w||!w[6])return null;y=w[0];m=w[1];d0=w[2]}else{const t=new Date();y=t.getFullYear();m=t.getMonth()+1;d0=t.getDate()}
               const base=daysOf(y,m,d0);let best=null;
               for(const dm of [-1,0,1]){const yy=m+dm===0?y-1:m+dm===13?y+1:y,mm=m+dm===0?12:m+dm===13?1:m+dm,d=kamaDay(yy,mm,wk,wd);
                 if(d!==null){const gap=Math.abs(daysOf(yy,mm,d)-base);if(best===null||gap<best[0])best=[gap,yy,mm,d]}}
               return best===null?null:`${String(best[1]).padStart(4,'0')}-${String(best[2]).padStart(2,'0')}-${String(best[3]).padStart(2,'0')}`},
 };
 /* y 年 m 月の第 wk 週・曜日 wd（日＝1〜土＝7）の日（無ければ null）。月初を第 1 週として日曜日で進み、第 6 週は第 1 週に戻す（同じなら早い方） */
 function kamaDay(y,m,wk,wd){const first=daysOf(y,m,1),last=(m===12?daysOf(y+1,1,1):daysOf(y,m+1,1))-first,sw=((first%7)+7+4)%7;let n=0;
  for(let d=1;d<=last;d++){const dw=(sw+d-1)%7+1;if(n===0||dw===1)n=n===5?1:n+1;if(n===wk&&dw===wd)return d}return null}
 /* = と同じ比べ方（どちらも本当に数なら数で、ほかは字で） */
 function eqOf(a,b){const x=strictNum(a),y=strictNum(b);return x!==null&&y!==null?x===y:textOf(a)===textOf(b)}
 const ARITY={cmp:2,num:1,text:1,abs:1,round:2,len:1,left:2,right:2,trim:1,upper:1,lower:1,
              find:2,replace:3,match:2,regreplace:3,split:3,contains:2,startswith:2,endswith:2,
              hankaku:1,
              count:2,regcount:2,lenb:1,rept:2,int:1,ceil:1,sqrt:1,isnum:1,isblank:1,
              year:1,month:1,day:1,hour:1,minute:1,weekday:1,date:1};
 /* 引数の数に幅がある関数（下限〜上限）。 */
 const ARITY_RANGE={mid:[2,3],extract:[2,3],padleft:[2,3],conv:[2,9],
                    roundup:[1,2],rounddown:[1,2],datediff:[2,3],ifs:[2,40],switch:[3,41],kamadate:[1,2],
                    min:[1,30],max:[1,30],sum:[1,30],avg:[1,30]};
 const REGEX_FUNCS=new Set(['extract','match','regreplace','regcount']);

 function evalNode(n,row){
  switch(n.k){
   case 'num':case 'str':return n.v;
   case 'col':{const v=row?row[n.v]:undefined;return v===undefined?null:v}
   case 'neg':{const a=numOf(evalNode(n.a,row));return a===null?null:-a}
   case 'not':return truthy(evalNode(n.a,row))?0:1;
   case 'and':return (truthy(evalNode(n.a,row))&&truthy(evalNode(n.b,row)))?1:0;
   case 'or':return (truthy(evalNode(n.a,row))||truthy(evalNode(n.b,row)))?1:0;
   case 'cmp':{
    const a=evalNode(n.a,row),b=evalNode(n.b,row);
    const x=strictNum(a),y=strictNum(b);
    /* **どちらも「本当に数」のときだけ数で比べる。** 緩く読むと
       「'010' = 10」が真になり、先頭ゼロのコードの照合が壊れる。 */
    const [l,r]=(x!==null&&y!==null)?[x,y]:[textOf(a),textOf(b)];
    switch(n.op){
     case '=':return l===r?1:0;
     case '<>':return l!==r?1:0;
     case '<':return l<r?1:0;
     case '<=':return l<=r?1:0;
     case '>':return l>r?1:0;
     default:return l>=r?1:0;
    }
   }
   case 'bin':{
    const a=evalNode(n.a,row),b=evalNode(n.b,row);
    if(n.op==='+'){
     const x=numOf(a),y=numOf(b);
     /* 片方でも数でなければ**連結**。「品番+枝番」のような使い方が
        いちばん多いので、そこで0が出ると意図と違う。 */
     if(x!==null&&y!==null)return x+y;
     const ta=textOf(a),tb=textOf(b);
     if(ta.length+tb.length>STR_MAX)throw tooLong();
     return ta+tb;
    }
    const x=numOf(a),y=numOf(b);
    if(x===null||y===null)return null;
    if(n.op==='-')return x-y;
    if(n.op==='*')return x*y;
    if(n.op==='/')return y===0?null:x/y;      // 0除算は空にする(エラーにしない)
    return y===0?null:x%y;
   }
   case 'call':{
    if(n.name==='if'){
     if(n.args.length<2)throw Error('if は if(条件, 真のとき, 偽のとき) です');
     return truthy(evalNode(n.args[0],row))
      ? evalNode(n.args[1],row)
      : (n.args.length>2?evalNode(n.args[2],row):'');
    }
    const f=Object.hasOwn(FUNCS,n.name)?FUNCS[n.name]:null;    // constructor など、関数の表に無い名前は引かない（版 3.52.1）
    if(!f)throw Error(`知らない関数です: ${n.name}`);
    const v=f(n.args.map(a=>evalNode(a,row)));
    if(typeof v==='string'&&v.length>STR_MAX)throw tooLong();
    return v;
   }
  }
  return null;
 }

 /* ---------- 外向きのAPI ---------- */
 /* 式に出てくる列名。パネルの説明と、必要な列の取得漏れの確認に使う。 */
 function columnsUsed(node,out){
  out=out||new Set();
  if(!node||typeof node!=='object')return out;
  if(node.k==='col')out.add(node.v);
  ['a','b'].forEach(k=>{if(node[k])columnsUsed(node[k],out)});
  (node.args||[]).forEach(a=>columnsUsed(a,out));
  return out;
 }
 /* 式を1回だけ解いて使い回す(行ごとに解き直すと200行×列で効いてくる)。 */
 function compile(src){
  const node=parse(src);
  return {
   columns:[...columnsUsed(node)],
   run(row){
    try{return evalNode(node,row)}
    catch(e){return null}      // **その行だけ空**にする(列ごと落とさない)
   },
  };
 }
 /* 書いている最中の確認用。{ok:true} か {ok:false,error:'...'}。 */
 function check(src){
  if(!String(src||'').trim())return {ok:false,error:'式を入力してください'};
  try{const c=compile(src);return {ok:true,columns:c.columns}}
  catch(e){return {ok:false,error:e.message}}
 }

 window.WL=window.WL||{};
 /* **関数の名前と引数の形**（§9.474・候補の表示用）。書く人が選ぶ物なので、書き方の説明（`help`）と
    同じ言葉で1つずつ持つ。`FUNCS`に足したらここにも足す（網: test_formula が両方の名前を突き合わせる）。 */
 const SIGS=[
  ['if','条件, 真のとき, 偽のとき','条件で切り替える'],
  ['and','','論理（a and b）'],['or','','論理（a or b）'],['not','','論理（not a）'],
  ['round','x, 桁','四捨五入'],['abs','x','絶対値'],['num','x','数として読む'],['text','x','文字として読む'],
  ['len','x','文字数'],['left','x, 文字数','左から切り出す'],['right','x, 文字数','右から切り出す'],
  ['mid','x, 何文字目, 文字数','途中を切り出す（位置は1から）'],['find','x, 字','字の位置（無ければ0）'],
  ['split','x, 区切り, 何番目','区切って何番目か'],['trim','x','前後の空白を取る'],
  ['upper','x','大文字へ'],['lower','x','小文字へ'],['concat','a, b','つなぐ'],['coalesce','a, b','空ならb'],
  ['replace','x, 字, 置く字','字を置き換える'],['regreplace','x, 正規表現, 置く字','正規表現で置き換える'],
  ['hankaku','x','全角の英数を半角へ'],['padleft','x, 桁, 字','左を字で埋める'],
  ['extract','x, 正規表現, 組','正規表現で抜き出す'],['match','x, 正規表現','正規表現に合うか'],
  ['contains','x, 字','字を含むか'],['cmp','a, b','比べる（数に読めれば数で・-1／0／1）'],['startswith','x, 字','字で始まるか'],['endswith','x, 字','字で終わるか'],
  ['conv',"'変換表', 値…",'変換表で読み替える（マスタ「変換表」）'],
  ['count','x, 字','字が何回出てくるか'],['regcount','x, 正規表現','正規表現に合う所の数'],['lenb','x','バイト数（全角 2・半角 1）'],
  ['rept','x, 回数','字をくり返す'],['min','a, b, …','いちばん小さい数'],['max','a, b, …','いちばん大きい数'],
  ['sum','a, b, …','数の合計'],['avg','a, b, …','数の平均'],['int','x','小数を切り捨てた整数（小さい側）'],['ceil','x','小数を切り上げた整数'],
  ['roundup','x, 桁','切り上げ（0 から遠い側）'],['rounddown','x, 桁','切り捨て（0 の側）'],['sqrt','x','平方根'],
  ['isnum','x','数か（1／0）'],['isblank','x','空か（1／0）'],
  ['ifs','条件1, 答え1, …, どれでもない時','条件を順に見て、最初に合った答え'],['switch','x, 値1, 答え1, …, どれでもない時','値で切り替える'],
  ['year','日時','年'],['month','日時','月'],['day','日時','日'],['hour','日時','時'],['minute','日時','分'],
  ['weekday','日時','曜日（1＝日 〜 7＝土）'],['date','日時','年月日（2026-10-01 の形）'],
  ['datediff',"始め, 終わり, 'm'",'日時の差（d＝日・h＝時間・m＝分・s＝秒）'],
  ['kamadate','釜番, 基準日','釜番（週・曜日・何番目の 3 桁）→ 基準日にいちばん近い日付（前の月・その月・次の月から。基準日を省くと今日）'],
 ];
 /* ---------- 書いている最中の候補（§9.474、利用者の指示「条件式の部分もさらに使いやすく、関数などは
    特にサジェスト機能なども組み込んで」） ----------
    式の入力欄（表示ルールの条件・この列の作り方）に付ける。**焦点は入力欄のまま**（コンボボックス）
    ——`WL.popMenu`は項目へ焦点を移すメニューの器なので使わず、見た目だけ`.wl-menu`を名乗る。
      ・英字を打つと関数の候補（名前の頭が合う物が先、途中に含む物が後）
      ・[ を打つと列名の候補（`opt.columns()`が答える。表示名でも元の名前でもよい）
      ・↑↓で選び、Enter／Tab で入れる。Esc で閉じる（押下は受けたと名乗る＝窓は閉じない）
    関数は`name(`まで入れて、引数の形を候補の中に言う（例: extract(x, 正規表現, 組)）。 */
 let sgEl=null,sgFor=null,sgItems=[],sgAt=0,sgSpan=null,sgSig='',sgRaf=0;
 function sgClose(){cancelAnimationFrame(sgRaf);if(sgEl)sgEl.hidden=true;sgFor=null;sgItems=[];sgSpan=null;sgSig=''}
 /* 候補を出すのは 1 コマに 1 回（速く打っても、打鍵ごとに候補を作り直さない）。
    測るのは入力欄の位置だけ（候補の高さ・幅は行の高さと最大幅から決める）。候補が前と同じなら中身は作り直さない。
    （以前は打鍵ごとに 中身を作る→位置を測る→大きさを測る で、後ろの大きな一覧まで配置を計算し直し、打つ手を待たせた） */
 const SG_ROW=26,SG_PAD=10,SG_MAXW=460;
 function sgQueue(inp,opt){cancelAnimationFrame(sgRaf);sgRaf=requestAnimationFrame(()=>sgShow(inp,opt))}
 function sgWord(inp){
  const v=inp.value,c=inp.selectionStart||0,head=v.slice(0,c);
  const open=head.lastIndexOf('['),close=head.lastIndexOf(']');
  if(open>close)return {kind:'col',q:head.slice(open+1),from:open+1,to:c};
  const m=head.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if(m&&!/['"]/.test(head.slice(-m[0].length-1,-m[0].length)))return {kind:'fn',q:m[0].toLowerCase(),from:c-m[0].length,to:c};
  return null;
 }
 function sgShow(inp,opt){
  const w=sgWord(inp);
  if(!w){sgClose();return}
  const q=w.q.toLowerCase();
  let items;
  if(w.kind==='fn'){
   const all=SIGS.filter(([n])=>n.includes(q));
   items=[...all.filter(([n])=>n.startsWith(q)),...all.filter(([n])=>!n.startsWith(q))]
    .map(([n,a,note])=>({ins:['and','or','not'].includes(n)?n+' ':n+'(',label:n,args:a,note}));
  }else{
   const cols=((opt.columns&&opt.columns())||[]).map(String);
   items=cols.filter(n=>n.toLowerCase().includes(q)).slice(0,40).map(n=>({ins:n+']',label:n,args:'',note:'列'}));
  }
  if(!items.length||(w.kind==='fn'&&items.length===1&&items[0].label===q)){sgClose();return}
  if(!sgEl){
   /* 候補は、画面いっぱいの透明な台（大きさを閉じ込めた .fx-suggest-host）の中に置く。body の直下に置くと、動かす・中身を変える
      たびに文書全体（後ろの大きな一覧）から配置を計算し直し、打つ手を待たせた（台で計算が止まる） */
   /* 台そのものは固定配置（OOF）なので組み直しの区切りにならない。中に区切りになる普通の箱（.fx-suggest-layer）を挟む */
   const host=document.createElement('div');host.className='fx-suggest-host';document.body.appendChild(host);
   const layer=document.createElement('div');layer.className='fx-suggest-layer';host.appendChild(layer);
   sgEl=document.createElement('div');
   sgEl.className='wl-menu fx-suggest';sgEl.setAttribute('role','listbox');sgEl.hidden=true;
   layer.appendChild(sgEl);
   sgEl.addEventListener('mousedown',e=>{
    const li=e.target.closest('[data-i]');if(!li)return;
    e.preventDefault();sgPick(+li.dataset.i);
   });
  }
  const r=inp.getBoundingClientRect();
  const next=items.slice(0,12),sig=next.map(it=>it.label).join('\u001f');
  sgFor=inp;sgSpan=w;
  if(sig!==sgSig||sgEl.hidden){
   sgItems=next;sgAt=0;sgSig=sig;
   sgEl.innerHTML=sgItems.map((it,i)=>`<div role="option" data-i="${i}" class="fx-sg-item${i===sgAt?' is-on':''}">`
    +`<b>${escHtml(it.label)}</b>${it.args?`<code>(${escHtml(it.args)})</code>`:''}<small>${escHtml(it.note)}</small></div>`).join('');
  }
  const h=sgItems.length*SG_ROW+SG_PAD,below=r.bottom+4+h<=innerHeight;
  sgEl.style.left=`${Math.max(6,Math.min(r.left,innerWidth-SG_MAXW-6))}px`;
  sgEl.style.top=`${below?r.bottom+4:Math.max(6,r.top-h-4)}px`;
  sgEl.hidden=false;
 }
 function sgMark(){if(sgEl)sgEl.querySelectorAll('.fx-sg-item').forEach((el,i)=>el.classList.toggle('is-on',i===sgAt))}
 function sgPick(i){
  const it=sgItems[i],inp=sgFor,w=sgSpan;
  if(!it||!inp||!w)return;
  const v=inp.value;
  /* 列名の候補は、すでに閉じ括弧があれば二重にしない。 */
  const rest=v.slice(w.to);
  const ins=it.ins.endsWith(']')&&rest.startsWith(']')?it.ins.slice(0,-1):it.ins;
  inp.value=v.slice(0,w.from)+ins+rest;
  const at=w.from+ins.length+(ins!==it.ins?1:0);
  inp.setSelectionRange(at,at);
  sgClose();
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.focus();
 }
 const escHtml=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function suggest(inp,opt){
  if(!inp||inp.dataset.fxSuggest)return;
  inp.dataset.fxSuggest='1';
  inp.setAttribute('autocomplete','off');
  const o=opt||{};
  /* 日本語入力の変換中は候補を出さず、確定してから出す（変換中に候補を動かすと、確定の Enter で候補を選んでしまう） */
  inp.addEventListener('input',e=>{if(!window.TPA||!TPA.composing(e))sgQueue(inp,o)});
  inp.addEventListener('compositionend',()=>sgQueue(inp,o));
  inp.addEventListener('click',()=>sgQueue(inp,o));
  inp.addEventListener('blur',()=>setTimeout(()=>{if(sgFor===inp&&document.activeElement!==inp)sgClose()},0));
  inp.addEventListener('keydown',e=>{
   if(sgFor!==inp||!sgEl||sgEl.hidden||e.isComposing||e.keyCode===229)return;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();sgAt=(sgAt+(e.key==='ArrowDown'?1:-1)+sgItems.length)%sgItems.length;sgMark();
   }else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();sgPick(sgAt)}
   else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();sgClose()}
  });
 }
 /* 変換表を渡す（名前 → 表。無ければ null）。渡し直すと、次に計算する行から新しい表を使う */
 function setTables(fn){convSource=typeof fn==='function'?fn:()=>null}
 window.WL.formula={compile,check,parse,regexRisk,sigs:SIGS,truthy,cmp,MAX_LEN,suggest,setTables,convWith,
             /* 説明文をパネルとドキュメントで共用する(2箇所に書かない)。 */
             help:[
              ['[列名]','その行のその列の値'],
              ['+ - * / %','四則。+ は数値どうしなら足し算、片方が文字なら連結'],
              ['= <> < <= > >=','比較(真なら1・偽なら0)'],
              ['and / or / not','論理'],
              ['if(条件, 真, 偽)','条件で切り替える'],
              ['round(x,n) abs(x) num(x)','数の整え'],
              ['concat(a,b) left(x,n) right(x,n) len(x)','文字の整え'],
              ['trim(x) upper(x) lower(x) coalesce(a,b)','その他'],
              ['mid(x,何文字目,文字数) find(x,字) split(x,区切り,何番目)','切り出す（位置は1から）'],
              ['replace(x,字,置く字) regreplace(x,正規表現,置く字) hankaku(x) padleft(x,桁,字)','変換する'],
              ['extract(x,正規表現[,組]) match(x,正規表現) contains(x,字)','抜き出す・合うか'],
              ["conv('変換表', 値…)",'変換表（マスタ）で読み替える'],
              ['count(x,字) regcount(x,正規表現) lenb(x) rept(x,回数)','数える・くり返す'],
              ['min(…) max(…) sum(…) avg(…) int(x) ceil(x) roundup(x,桁) rounddown(x,桁) sqrt(x)','数の計算'],
              ['ifs(条件,答え,…) switch(x,値,答え,…) isnum(x) isblank(x)','切り替える・確かめる'],
              ["year(x) month(x) day(x) hour(x) minute(x) weekday(x) date(x) datediff(始め,終わり,'m')",'日時（作業時間は datediff で分に）'],
             ]};
})();
