// ═══════════════════════════════════════════════════════════════════════
// HTML MIRROR v2.4 — Plugin de Figma (Optimizado para IA)
// Solucionado: ReferenceError extractEffects.
// ═══════════════════════════════════════════════════════════════════════

// ── UI ──────────────────────────────────────────────────────────────────
var UI = [
'<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">',
'<style>',
'*{margin:0;padding:0;box-sizing:border-box;}',
':root{',
'  --bg:#0a0a0f;--sf:#111118;--sf2:#17171f;--bd:#1c1c26;',
'  --tx:#e4e4f0;--mu:#5a5a70;--mu2:#7a7a90;',
'  --ac:#7c6fff;--ac2:#9d94ff;',
'  --gn:#22c55e;--re:#f87171;--ye:#fbbf24;',
'}',
'html,body{height:100%;background:var(--bg);color:var(--tx);',
'  font-family:Inter,system-ui,sans-serif;font-size:12px;overflow:hidden;}',
'.app{display:flex;flex-direction:column;height:100vh;}',
'.hdr{padding:10px 14px;border-bottom:1px solid var(--bd);',
'  display:flex;align-items:center;gap:8px;flex-shrink:0;}',
'.hlogo{font-size:11px;font-weight:700;letter-spacing:.5px;color:#f0f0ff;flex:1;}',
'.hbadge{font-size:10px;font-family:monospace;background:var(--sf);',
'  border:1px solid var(--bd);color:var(--mu);padding:2px 8px;',
'  border-radius:100px;white-space:nowrap;max-width:200px;',
'  overflow:hidden;text-overflow:ellipsis;}',
'.hbadge.on{border-color:var(--ac);color:var(--ac2);}',
'.dot{width:6px;height:6px;background:var(--gn);border-radius:50%;',
'  box-shadow:0 0 5px var(--gn);animation:pulse 2s infinite;display:none;}',
'.dot.on{display:block;}',
'@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}',
'.search-row{padding:8px 14px;border-bottom:1px solid var(--bd);flex-shrink:0;}',
'#search{width:100%;background:var(--sf);border:1px solid var(--bd);',
'  color:var(--tx);border-radius:8px;padding:6px 10px;font-size:11px;',
'  outline:none;}',
'#search:focus{border-color:var(--ac);}',
'#search::placeholder{color:var(--mu);}',
'.stats{padding:5px 14px;border-bottom:1px solid var(--bd);',
'  display:flex;gap:14px;flex-shrink:0;}',
'.stat{font-size:10px;color:var(--mu2);display:flex;align-items:center;gap:4px;}',
'.stat b{color:var(--tx);font-weight:600;}',
'.tabs{display:flex;border-bottom:1px solid var(--bd);padding:0 14px;gap:2px;flex-shrink:0;}',
'.tab{font-size:11px;padding:7px 10px;cursor:pointer;color:var(--mu);',
'  border-bottom:2px solid transparent;user-select:none;white-space:nowrap;}',
'.tab:hover{color:var(--mu2);}',
'.tab.on{color:var(--tx);border-color:var(--ac);}',
'.panels{flex:1;overflow:hidden;}',
'.panel{height:100%;overflow-y:auto;display:none;flex-direction:column;}',
'.panel.on{display:flex;}',
'.empty{flex:1;display:flex;flex-direction:column;align-items:center;',
'  justify-content:center;gap:8px;padding:32px;text-align:center;color:var(--mu);}',
'.eico{font-size:26px;opacity:.35;}',
'.etit{font-size:12px;font-weight:500;color:#4a4a60;}',
'.esub{font-size:11px;line-height:1.6;max-width:220px;}',
'#ptree{padding:8px 0;}',
'.nrow{display:flex;align-items:stretch;cursor:pointer;',
'  border-bottom:1px solid transparent;transition:background .1s;}',
'.nrow:hover{background:var(--sf);}',
'.nrow.sel{background:var(--sf2);}',
'.nindent{flex-shrink:0;}',
'.ntoggle{width:20px;flex-shrink:0;display:flex;align-items:center;',
'  justify-content:center;color:var(--mu);font-size:9px;cursor:pointer;}',
'.ntoggle:hover{color:var(--tx);}',
'.nicon{width:20px;flex-shrink:0;display:flex;align-items:center;',
'  justify-content:center;font-size:11px;opacity:.8;}',
'.nmain{flex:1;min-width:0;padding:5px 8px 5px 2px;}',
'.nname{font-size:11px;font-weight:500;color:var(--tx);',
'  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}',
'.ntype{font-size:9px;color:var(--mu);letter-spacing:.5px;text-transform:uppercase;}',
'.ntags{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;}',
'.ntag{font-size:9px;padding:1px 5px;border-radius:3px;font-family:monospace;white-space:nowrap;}',
'.tag-fill{background:rgba(124,111,255,.15);color:#9d94ff;}',
'.tag-text{background:rgba(251,191,36,.12);color:#fbbf24;}',
'.tag-effect{background:rgba(248,113,113,.15);color:#f87171;}',
'.tag-stroke{background:rgba(34,197,94,.12);color:#22c55e;}',
'.tag-layout{background:rgba(56,189,248,.12);color:#38bdf8;}',
'.tag-child{background:rgba(255,255,255,.06);color:var(--mu2);}',
'.detail{border-left:2px solid var(--ac);margin:0 10px 0 14px;',
'  background:var(--sf);border-radius:0 8px 8px 0;overflow:hidden;',
'  margin-bottom:2px;}',
'.dsec{border-bottom:1px solid var(--bd);}',
'.dstit{padding:5px 10px;font-size:9px;color:var(--mu);',
'  text-transform:uppercase;letter-spacing:1.1px;font-weight:700;',
'  background:rgba(0,0,0,.2);}',
'.drow{display:flex;align-items:center;padding:3px 10px;gap:8px;}',
'.drow:hover{background:rgba(255,255,255,.02);}',
'.dk{font-size:10px;color:var(--mu2);flex:0 0 110px;white-space:nowrap;}',
'.dv{font-size:10px;color:#d0d0e0;font-family:monospace;',
'  flex:1;text-align:right;word-break:break-all;',
'  display:flex;align-items:center;gap:4px;justify-content:flex-end;}',
'.sw{width:10px;height:10px;border-radius:2px;',
'  border:1px solid rgba(255,255,255,.12);flex-shrink:0;}',
'.txtprev{margin:6px 10px;padding:8px 10px;background:rgba(251,191,36,.05);',
'  border:1px solid rgba(251,191,36,.15);border-radius:6px;',
'  font-size:11px;color:#d0c060;line-height:1.5;',
'  word-break:break-word;max-height:80px;overflow:hidden;',
'  text-overflow:ellipsis;}',
'#pcode{padding:14px;}',
'pre.codeblock{font-family:Menlo,monospace;font-size:10.5px;',
'  line-height:1.75;white-space:pre-wrap;word-break:break-word;',
'  color:#c4c4d4;}',
'.ht{color:#7dd3fc;}.ha{color:#c084fc;}',
'.cs{color:#7dd3fc;}.cp{color:#c084fc;}.cv{color:#86efac;}',
'.cn{color:#fda4af;}.cc{color:#4a4a62;font-style:italic;}',
'.ftr{border-top:1px solid var(--bd);padding:9px 12px;',
'  display:flex;gap:7px;flex-shrink:0;}',
'.btn{flex:1;padding:6px;border-radius:8px;font-size:11px;font-weight:600;',
'  cursor:pointer;border:none;letter-spacing:.2px;}',
'.bg{background:var(--sf);color:#b0b0c0;border:1px solid var(--bd);}',
'.bg:hover{background:var(--sf2);}',
'.ba{background:var(--ac);color:#fff;}',
'.ba:hover{filter:brightness(1.15);}',
'.toast{position:fixed;bottom:52px;left:50%;',
'  transform:translateX(-50%) translateY(6px);',
'  background:var(--gn);color:#fff;font-size:11px;font-weight:600;',
'  padding:4px 14px;border-radius:100px;opacity:0;',
'  transition:all .18s;pointer-events:none;}',
'.toast.on{opacity:1;transform:translateX(-50%) translateY(0);}',
'::-webkit-scrollbar{width:3px;}',
'::-webkit-scrollbar-thumb{background:#1e1e2e;border-radius:2px;}',
'</style></head><body>',

'<div class="app">',
'<div class="hdr">',
'  <div class="dot" id="dot"></div>',
'  <div class="hlogo">&#60;/&#62; HTML Mirror v2.4</div>',
'  <div class="hbadge" id="badge">sin seleccion</div>',
'</div>',

'<div class="search-row">',
'  <input id="search" type="text" placeholder="Buscar nodo por nombre o tipo...">',
'</div>',

'<div class="stats" id="stats" style="display:none">',
'  <div class="stat">Nodos: <b id="sn">0</b></div>',
'  <div class="stat">Texto: <b id="st">0</b></div>',
'  <div class="stat">Fills: <b id="sf">0</b></div>',
'  <div class="stat">Efectos: <b id="se">0</b></div>',
'</div>',

'<div class="tabs">',
'  <div class="tab on" data-p="tree">Arbol</div>',
'  <div class="tab" data-p="code">CSS Specs</div>',
'</div>',

'<div class="panels">',
'<div class="panel on" id="pptree">',
'  <div class="empty" id="etree">',
'    <div class="eico">&#8990;</div>',
'    <div class="etit">Selecciona un elemento</div>',
'    <div class="esub">Selecciona cualquier frame o capa para ver sus specs y coordenadas reales.</div>',
'  </div>',
'  <div id="ptree" style="display:none"></div>',
'</div>',

'<div class="panel" id="ppcode">',
'  <pre class="codeblock" id="pcode"><span style="color:var(--mu)">/* Selecciona un frame para ver los specs generados */</span></pre>',
'</div>',
'</div>',

'<div class="ftr">',
'  <button class="btn bg" id="bcss">Copiar CSS</button>',
'  <button class="btn ba" id="ball">Copiar HTML + CSS</button>',
'</div>',
'</div>',

'<div class="toast" id="toast">Copiado</div>',

'<script>',
'var DATA=null, expanded={}, selected=null, query="";',

'document.querySelectorAll(".tab").forEach(function(t){',
'  t.addEventListener("click",function(){',
'    document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("on");});',
'    document.querySelectorAll(".panel").forEach(function(x){x.classList.remove("on");});',
'    t.classList.add("on");',
'    document.getElementById("pp"+t.dataset.p).classList.add("on");',
'  });',
'});',

'document.getElementById("search").addEventListener("input",function(){',
'  query=this.value.toLowerCase().trim();',
'  if(DATA) renderTree();',
'});',

'window.onmessage=function(e){',
'  var msg=e.data.pluginMessage; if(!msg) return;',
'  if(msg.type==="frame-data"){',
'    DATA=msg;',
'    document.getElementById("badge").textContent=msg.name+" ("+msg.nodes.length+" nodos)";',
'    document.getElementById("badge").classList.add("on");',
'    document.getElementById("dot").classList.add("on");',
'    document.getElementById("stats").style.display="flex";',
'    var nt=0,nf=0,ne=0;',
'    msg.nodes.forEach(function(n){',
'      if(n.type==="TEXT") nt++;',
'      if(n.hasFill) nf++;',
'      if(n.hasEffect) ne++;',
'    });',
'    document.getElementById("sn").textContent=msg.nodes.length;',
'    document.getElementById("st").textContent=nt;',
'    document.getElementById("sf").textContent=nf;',
'    document.getElementById("se").textContent=ne;',
'    var css=msg.nodes.map(function(n){return n.css;}).join("\\n\\n");',
'    document.getElementById("pcode").innerHTML=hl(css);',
'    renderTree();',
'  }',
'  if(msg.type==="cleared"){',
'    DATA=null; selected=null; expanded={};',
'    document.getElementById("badge").textContent="sin seleccion";',
'    document.getElementById("badge").classList.remove("on");',
'    document.getElementById("dot").classList.remove("on");',
'    document.getElementById("stats").style.display="none";',
'    document.getElementById("etree").style.display="";',
'    document.getElementById("ptree").style.display="none";',
'    document.getElementById("ptree").innerHTML="";',
'    document.getElementById("pcode").innerHTML=\'<span style="color:var(--mu)">/* Selecciona un frame */</span>\';',
'  }',
'};',

'function renderTree(){',
'  if(!DATA) return;',
'  document.getElementById("etree").style.display="none";',
'  var el=document.getElementById("ptree");',
'  el.style.display="";',
'  var html="";',
'  DATA.nodes.forEach(function(n){',
'    if(query && n.name.toLowerCase().indexOf(query)<0 && n.type.toLowerCase().indexOf(query)<0) return;',
'    html+=renderNode(n);',
'  });',
'  el.innerHTML=html||\'<div class="empty"><div class="esub">Sin resultados para "\'+query+\'"</div></div>\';',
'  el.querySelectorAll(".ntoggle").forEach(function(btn){',
'    btn.addEventListener("click",function(e){',
'      e.stopPropagation();',
'      var id=btn.dataset.id;',
'      expanded[id]=!expanded[id];',
'      renderTree();',
'    });',
'  });',
'  el.querySelectorAll(".nrow").forEach(function(row){',
'    row.addEventListener("click",function(){',
'      selected=row.dataset.id;',
'      el.querySelectorAll(".nrow").forEach(function(r){r.classList.remove("sel");});',
'      row.classList.add("sel");',
'      var det=document.getElementById("det-"+row.dataset.id);',
'      if(det) det.style.display=det.style.display==="none"?"":"none";',
'    });',
'  });',
'}',

'function renderNode(n){',
'  var hasKids=n.childCount>0;',
'  var isOpen=expanded[n.id];',
'  var indent=n.depth*18;',
'  var icon=nodeIcon(n.type);',
'  var tags="";',
'  if(n.hasFill) tags+=\'<span class="ntag tag-fill">fill</span>\';',
'  if(n.type==="TEXT") tags+=\'<span class="ntag tag-text">texto</span>\';',
'  if(n.hasEffect) tags+=\'<span class="ntag tag-effect">effect</span>\';',
'  if(n.hasStroke) tags+=\'<span class="ntag tag-stroke">stroke</span>\';',
'  if(n.isLayout) tags+=\'<span class="ntag tag-layout">flex</span>\';',
'  if(n.childCount>0) tags+=\'<span class="ntag tag-child">\'+n.childCount+\' hijos</span>\';',
'  var h=\'<div class="nrow" data-id="\'+n.id+\'">\';',
'  h+=\'<div class="nindent" style="width:\'+indent+\'px"></div>\';',
'  if(hasKids){',
'    h+=\'<div class="ntoggle" data-id="\'+n.id+\'">\';',
'    h+=isOpen?"&#9660;":"&#9654;";',
'    h+=\'</div>\';',
'  } else {',
'    h+=\'<div class="nindent" style="width:20px"></div>\';',
'  }',
'  h+=\'<div class="nicon">\'+icon+\'</div>\';',
'  h+=\'<div class="nmain">\';',
'  h+=\'<div class="nname" title="\'+esc(n.name)+\'">\'+esc(n.name)+\'</div>\';',
'  h+=\'<div class="ntype">\'+n.type+(n.parentName?\'&nbsp;&nbsp;in \'+esc(n.parentName):"")+"</div>";',
'  if(tags) h+=\'<div class="ntags">\'+tags+"</div>";',
'  h+=\'</div></div>\';',
'  h+=\'<div class="detail" id="det-\'+n.id+\'" style="display:none">\';',
'  h+=buildDetail(n);',
'  h+=\'</div>\';',
'  if(hasKids && isOpen && !query){',
'    h+=\'<div id="kids-\'+n.id+\'">\';',
'    DATA.nodes.forEach(function(c){',
'      if(c.parentId===n.id) h+=renderNode(c);',
'    });',
'    h+=\'</div>\';',
'  }',
'  return h;',
'}',

'function buildDetail(n){',
'  var h="";',
'  h+=sec("Geometria",[',
'    {k:"x (abs)",v:n.absX+"px"},{k:"y (abs)",v:n.absY+"px"},',
'    {k:"x (relativo)",v:n.x+"px"},{k:"y (relativo)",v:n.y+"px"},',
'    {k:"width",v:n.width+"px"},{k:"height",v:n.height+"px"},',
'    n.rotation?{k:"rotation",v:n.rotation+"deg"}:null,',
'    n.opacity<1?{k:"opacity",v:String(n.opacity)}:null,',
'    n.parentName?{k:"contenedor",v:n.parentName}:null,',
'  ]);',
'  if(n.fills && n.fills.length){',
'    var fi=[];',
'    n.fills.forEach(function(f,i){',
'      var px=n.fills.length>1?"["+i+"] ":"";',
'      fi.push({k:px+"tipo",v:f.type});',
'      if(f.hex) fi.push({k:px+"HEX",v:f.hex,color:f.hex});',
'      if(f.rgb) fi.push({k:px+"RGB",v:f.rgb});',
'      if(f.cmyk) fi.push({k:px+"CMYK",v:f.cmyk});',
'      if(f.alpha!==undefined) fi.push({k:px+"alpha",v:String(f.alpha)});',
'      if(f.gradient) fi.push({k:px+"gradient",v:f.gradient});',
'    });',
'    h+=sec("Fill",fi);',
'  }',
'  if(n.strokes && n.strokes.length){',
'    var si=[];',
'    n.strokes.forEach(function(s){',
'      if(s.hex) si.push({k:"color",v:s.hex,color:s.hex});',
'    });',
'    if(n.strokeWeight) si.push({k:"weight",v:n.strokeWeight+"px"});',
'    if(n.strokeAlign)  si.push({k:"align", v:n.strokeAlign});',
'    h+=sec("Stroke",si);',
'  }',
'  if(n.radius){',
'    h+=sec("Border Radius",[{k:"valor",v:n.radius}]);',
'  }',
'  if(n.effects && n.effects.length){',
'    var ei=[];',
'    n.effects.forEach(function(e,i){',
'      ei.push({k:"["+i+"] tipo",v:e.type});',
'      if(e.color) ei.push({k:"["+i+"] color",v:e.color,color:e.colorHex});',
'      if(e.offsetX!==undefined) ei.push({k:"["+i+"] offset",v:e.offsetX+"px, "+e.offsetY+"px"});',
'      if(e.radius!==undefined) ei.push({k:"["+i+"] radius",v:e.radius+"px"});',
'      if(e.spread!==undefined) ei.push({k:"["+i+"] spread",v:e.spread+"px"});',
'    });',
'    h+=sec("Effects",ei);',
'  }',
'  if(n.type==="TEXT" && n.typo){',
'    var ty=n.typo;',
'    var tyi=[];',
'    if(ty.family)        tyi.push({k:"family",       v:ty.family});',
'    if(ty.style)         tyi.push({k:"style",        v:ty.style});',
'    if(ty.weight)        tyi.push({k:"font-weight",  v:String(ty.weight)});',
'    if(ty.italic)        tyi.push({k:"font-style",   v:"italic"});',
'    if(ty.size)          tyi.push({k:"font-size",    v:ty.size+"px"});',
'    if(ty.lineHeight)    tyi.push({k:"line-height",  v:ty.lineHeight});',
'    if(ty.letterSpacing) tyi.push({k:"letter-spacing",v:ty.letterSpacing});',
'    if(ty.align)         tyi.push({k:"text-align",   v:ty.align});',
'    if(ty.decoration)    tyi.push({k:"text-decoration",v:ty.decoration});',
'    if(ty.textCase)      tyi.push({k:"text-transform",v:ty.textCase});',
'    if(ty.color)         tyi.push({k:"color",        v:ty.color,color:ty.colorHex});',
'    h+=sec("Tipografia",tyi);',
'    if(n.textContent)',
'      h+=\'<div class="txtprev">\'+esc(n.textContent.substring(0,120))+(n.textContent.length>120?"...":"")+"</div>";',
'  }',
'  if(n.isLayout){',
'    var ali=[];',
'    ali.push({k:"direction",   v:n.layoutDir});',
'    ali.push({k:"gap",         v:n.gap+"px"});',
'    ali.push({k:"padding",     v:n.padding});',
'    ali.push({k:"align-items", v:n.alignItems});',
'    ali.push({k:"justify",     v:n.justify});',
'    h+=sec("Auto Layout / Flex",ali);',
'  }',
'  return h;',
'}',

'function sec(label,items){',
'  var valid=items.filter(function(x){return x && x.v!==undefined && x.v!==null && x.v!=="";});',
'  if(!valid.length) return "";',
'  var h=\'<div class="dsec"><div class="dstit">\'+label+"</div>";',
'  valid.forEach(function(item){',
'    var v=item.color',
'      ?\'<span class="sw" style="background:\'+item.color+\'"></span>\'+esc(item.v)',
'      :esc(item.v);',
'    h+=\'<div class="drow"><span class="dk">\'+esc(item.k)+\'</span><span class="dv">\'+v+"</span></div>";',
'  });',
'  h+="</div>";',
'  return h;',
'}',

'function nodeIcon(type){',
'  var m={TEXT:"T",FRAME:"&#9633;",GROUP:"&#9671;",',
'    RECTANGLE:"&#9632;",ELLIPSE:"&#9711;",',
'    COMPONENT:"&#10070;",INSTANCE:"&#9671;",',
'    VECTOR:"&#9651;",LINE:"&#8212;",',
'    POLYGON:"&#11039;",STAR:"&#9733;",',
'    BOOLEAN_OPERATION:"&#8746;"};',
'  return m[type]||"&#9642;";',
'}',

'function copyText(txt){',
'  var ta=document.createElement("textarea");',
'  ta.value=txt;ta.style.position="fixed";ta.style.opacity="0";',
'  document.body.appendChild(ta);ta.select();',
'  document.execCommand("copy");',
'  document.body.removeChild(ta);',
'  var t=document.getElementById("toast");',
'  t.classList.add("on");',
'  setTimeout(function(){t.classList.remove("on");},1500);',
'}',

'document.getElementById("ball").onclick=function(){',
'  if(!DATA) return;',
'  var html=DATA.nodes.map(function(n){return n.html;}).join("\\n");',
'  var css=DATA.nodes.map(function(n){return n.css;}).join("\\n\\n");',
'  copyText(html+"\\n\\n"+css);',
'};',
'document.getElementById("bcss").onclick=function(){',
'  if(!DATA) return;',
'  copyText(DATA.nodes.map(function(n){return n.css;}).join("\\n\\n"));',
'};',

'function esc(s){',
'  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");',
'}',

'function hl(raw){',
'  var s=esc(raw);',
'  var rC=new RegExp("(\\/\\\\*[\\\\s\\\\S]*?\\\\*\\\\/)","g");',
'  s=s.replace(rC,"<span class=\\"cc\\">$1</span>");',
'  var rS=new RegExp("^([.#]?[\\\\w][\\\\w\\\\s,.-]*)([\\\\s]*\\\\{)","gm");',
'  s=s.replace(rS,"<span class=\\"cs\\">$1</span>$2");',
'  var rP=new RegExp("([\\\\w-]+)([\\\\s]*:[\\\\s]*)([^;\\\\n{<]+)(;?)","g");',
'  s=s.replace(rP,function(_,p,c,v,semi){',
'    var rN=new RegExp("([\\\\d.]+)(px|em|rem|%|vw|vh|deg|s|ms)","g");',
'    var val=v.replace(rN,"<span class=\\"cn\\">$1</span><span class=\\"cc\\">$2</span>");',
'    return "<span class=\\"cp\\">"+p+"</span>"+c+"<span class=\\"cv\\">"+val+"</span>"+semi;',
'  });',
'  return s;',
'}',

'parent.postMessage({pluginMessage:{type:"ready"}},"*");',
'<\/script></body></html>'
].join('\n');

// ═══════════════════════════════════════════════════════════════════════
// PLUGIN MAIN
// ═══════════════════════════════════════════════════════════════════════

figma.showUI(UI, { width: 440, height: 680, themeColors: false });

figma.ui.on("message", function(msg) {
  if (msg.type === "ready") processSelection();
});

figma.on("selectionchange", processSelection);

function processSelection() {
  var sel = figma.currentPage.selection;
  if (sel.length === 0) {
    figma.ui.postMessage({ type: "cleared" });
    return;
  }
  var root = sel[0];
  
  var baseFrame = root;
  while (baseFrame && baseFrame.parent && baseFrame.parent.type !== "PAGE") {
    baseFrame = baseFrame.parent;
  }

  var nodeList = [];
  nodeList.push(extractNode(root, 0, null, baseFrame));
  if ("children" in root) {
    walkChildren(root.children, 1, root.id, baseFrame, nodeList);
  }
  figma.ui.postMessage({
    type:  "frame-data",
    name:  root.name,
    nodes: nodeList
  });
}

function walkChildren(children, depth, parentId, baseFrame, list) {
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    list.push(extractNode(child, depth, parentId, baseFrame));
    if ("children" in child && child.children.length > 0) {
      walkChildren(child.children, depth + 1, child.id, baseFrame, list);
    }
  }
}

function extractNode(node, depth, parentId, baseFrame) {
  var className = sanitize(node.name);

  var absX = round(node.absoluteBoundingBox && baseFrame.absoluteBoundingBox ? node.absoluteBoundingBox.x - baseFrame.absoluteBoundingBox.x : node.x);
  var absY = round(node.absoluteBoundingBox && baseFrame.absoluteBoundingBox ? node.absoluteBoundingBox.y - baseFrame.absoluteBoundingBox.y : node.y);

  var fills = extractFills(node);
  var strokes = extractStrokes(node);
  var effects = extractEffects(node); // ¡Restaurada!

  var typo = null;
  var textContent = null;
  if (node.type === "TEXT") {
    typo = extractTypo(node);
    textContent = typeof node.characters === "string" ? node.characters : "";
  }

  var radius = extractRadius(node);
  var isLayout = "layoutMode" in node && (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL");

  return {
    id:         node.id,
    name:       node.name,
    type:       node.type,
    x:          round(node.x || 0),
    y:          round(node.y || 0),
    absX:       absX,
    absY:       absY,
    width:      round(node.width  || 0),
    height:     round(node.height || 0),
    rotation:   ("rotation" in node && node.rotation) ? round2(node.rotation) : 0,
    opacity:    ("opacity"  in node) ? round2(node.opacity) : 1,
    visible:    node.visible !== false,
    blendMode:  node.blendMode || "NORMAL",
    childCount: ("children" in node) ? node.children.length : 0,
    fills:      fills,
    strokes:    strokes,
    strokeWeight: ("strokeWeight" in node) ? round(node.strokeWeight) : 0,
    strokeAlign:  ("strokeAlign"  in node) ? node.strokeAlign : "CENTER",
    effects:    effects,
    radius:     radius,
    typo:       typo,
    css:        buildCSS(node, className, fills, strokes, typo, radius, absX, absY, effects)
  };
}

function extractFills(node) {
  if (!("fills" in node) || typeof node.fills === "symbol" || !Array.isArray(node.fills)) return [];
  var result = [];
  node.fills.forEach(function(f) {
    if (f.visible === false) return;
    var item = { type: f.type };
    if (f.type === "SOLID") {
      item.hex   = rgbHex(f.color.r, f.color.g, f.color.b);
      item.rgb   = r255(f.color.r) + ", " + r255(f.color.g) + ", " + r255(f.color.b);
      item.cmyk  = formatCmyk(rgbCmyk(f.color.r, f.color.g, f.color.b));
      item.alpha = round2(f.opacity !== undefined ? f.opacity : 1);
    }
    result.push(item);
  });
  return result;
}

function extractStrokes(node) {
  if (!("strokes" in node) || typeof node.strokes === "symbol" || !Array.isArray(node.strokes)) return [];
  var result = [];
  node.strokes.forEach(function(s) {
    if (s.visible === false) return;
    var item = { type: s.type };
    if (s.type === "SOLID") {
      item.hex   = rgbHex(s.color.r, s.color.g, s.color.b);
      item.rgb   = r255(s.color.r) + ", " + r255(s.color.g) + ", " + r255(s.color.b);
      item.cmyk  = formatCmyk(rgbCmyk(s.color.r, s.color.g, s.color.b));
      item.alpha = round2(s.opacity !== undefined ? s.opacity : 1);
    }
    result.push(item);
  });
  return result;
}

function extractEffects(node) {
  if (!("effects" in node) || typeof node.effects === "symbol" || !Array.isArray(node.effects)) return [];
  var result = [];
  node.effects.forEach(function(eff) {
    if (!eff.visible) return;
    var item = { type: eff.type };
    if ("radius" in eff)  item.radius  = round(eff.radius);
    if ("spread" in eff)  item.spread  = round(eff.spread);
    if ("offset" in eff) {
      item.offsetX = round(eff.offset.x);
      item.offsetY = round(eff.offset.y);
    }
    if ("color" in eff) {
      var c = eff.color;
      item.colorHex = rgbHex(c.r, c.g, c.b);
      item.color    = item.colorHex + " / a:" + round2(c.a || 1);
    }
    result.push(item);
  });
  return result;
}

function extractTypo(node) {
  var t = {};
  if (node.fontName && typeof node.fontName !== "symbol") {
    t.family = node.fontName.family;
    t.style  = node.fontName.style;
    t.weight = fontWeight(node.fontName.style);
  }
  t.size = (typeof node.fontSize === "number") ? round(node.fontSize) : 0;
  
  if (node.lineHeight && typeof node.lineHeight !== "symbol") {
    t.lineHeight = node.lineHeight.unit === "AUTO" ? "auto" : 
      (node.lineHeight.unit === "PERCENT" ? round2(node.lineHeight.value / 100) : round(node.lineHeight.value) + "px");
  }
  if (node.letterSpacing && typeof node.letterSpacing !== "symbol") {
    t.letterSpacing = node.letterSpacing.unit === "PERCENT" ? round2(node.letterSpacing.value / 100) + "em" : round2(node.letterSpacing.value) + "px";
  }
  
  t.alignH = notMixed(node.textAlignHorizontal) ? node.textAlignHorizontal : "LEFT";
  t.alignV = notMixed(node.textAlignVertical) ? node.textAlignVertical : "TOP";
  
  return t;
}

function extractRadius(node) {
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") return round(node.cornerRadius) + "px";
  return null;
}

// ── CSS BUILDER REESCRITO (Para matchar tu checklist) ────────────────────
function buildCSS(node, className, fills, strokes, typo, radius, absX, absY, effects) {
  var r = [];

  r.push("/* --- Position & Layout --- */");
  r.push("x: " + absX + "px");
  r.push("y: " + absY + "px");
  r.push("rotation: " + (node.rotation || 0) + "deg");
  r.push("width: " + round(node.width || 0) + "px");
  r.push("height: " + round(node.height || 0) + "px");

  r.push("");
  r.push("/* --- Appearance --- */");
  r.push("opacity: " + node.opacity);
  r.push("border-radius: " + (radius || "0px"));
  r.push("visibility: " + (node.visible ? "visible" : "hidden"));
  r.push("mix-blend-mode: " + blendToCSS(node.blendMode));

  if (effects && effects.length > 0) {
    var shadows = [];
    var blurVal = null;
    effects.forEach(function(eff) {
      if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
        var pre = eff.type === "INNER_SHADOW" ? "inset " : "";
        var origEff = null;
        if ("effects" in node) {
          for (var ei = 0; ei < node.effects.length; ei++) {
            if (node.effects[ei].type === eff.type) { origEff = node.effects[ei]; break; }
          }
        }
        var a2 = origEff && origEff.color ? round2(origEff.color.a || 1) : 1;
        var rgb3 = origEff && origEff.color
          ? r255(origEff.color.r) + "," + r255(origEff.color.g) + "," + r255(origEff.color.b)
          : "0,0,0";
        shadows.push(pre + (eff.offsetX||0) + "px " + (eff.offsetY||0) + "px " +
          (eff.radius||0) + "px " + (eff.spread ? eff.spread + "px " : "") +
          "rgba(" + rgb3 + "," + a2 + ")");
      }
      if (eff.type === "LAYER_BLUR") blurVal = eff.radius;
    });
    if (shadows.length) r.push("box-shadow: " + shadows.join(", "));
    if (blurVal)        r.push("filter: blur(" + blurVal + "px)");
  }

  if (node.type === "TEXT" && typo) {
    r.push("");
    r.push("/* --- Typography --- */");
    r.push("font-family: '" + (typo.family || "Mixed") + "'");
    r.push("font-size: " + typo.size + "px");
    r.push("font-weight: " + typo.weight);
    r.push("line-height: " + (typo.lineHeight || "normal"));
    r.push("letter-spacing: " + (typo.letterSpacing || "0px"));
    r.push("text-align: " + String(typo.alignH).toLowerCase());
    r.push("/* text-align-vertical: " + String(typo.alignV).toLowerCase() + " */");
  }

  r.push("");
  r.push("/* --- Fill --- */");
  if (fills.length > 0 && fills[0].type === "SOLID") {
    r.push("background-color: " + fills[0].hex);
    r.push("/* fill-rgb: " + fills[0].rgb + " */");
    r.push("/* fill-cmyk: " + fills[0].cmyk + " */");
    r.push("/* fill-opacity: " + fills[0].alpha + " */");
  } else if (fills.length > 0) {
    r.push("/* fill: " + fills[0].type + " */");
  } else {
    r.push("/* no fill */");
  }

  r.push("");
  r.push("/* --- Stroke --- */");
  if (strokes.length > 0 && strokes[0].type === "SOLID") {
    r.push("border-color: " + strokes[0].hex);
    r.push("/* stroke-rgb: " + strokes[0].rgb + " */");
    r.push("/* stroke-cmyk: " + strokes[0].cmyk + " */");
    r.push("/* stroke-opacity: " + strokes[0].alpha + " */");
    r.push("border-width: " + node.strokeWeight + "px");
    r.push("/* stroke-align: " + node.strokeAlign + " */");
  } else {
    r.push("/* no stroke */");
  }

  return "." + className + " {\n  " + r.join(";\n  ") + "\n}";
}

function rgbHex(r, g, b) {
  var h = function(v) { return Math.round(v * 255).toString(16).padStart(2, "0"); };
  return "#" + h(r) + h(g) + h(b);
}
function rgbCmyk(r, g, b) {
  var k = 1 - Math.max(r, g, b);
  if (k >= 0.999) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: Math.round(((1 - r - k) / (1 - k)) * 100), m: Math.round(((1 - g - k) / (1 - k)) * 100), y: Math.round(((1 - b - k) / (1 - k)) * 100), k: Math.round(k * 100) };
}
function formatCmyk(c) { return "C:" + c.c + " M:" + c.m + " Y:" + c.y + " K:" + c.k; }
function blendToCSS(m) {
  var map = { MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay", DARKEN: "darken", LIGHTEN: "lighten", COLOR_DODGE: "color-dodge", COLOR_BURN: "color-burn", HARD_LIGHT: "hard-light", SOFT_LIGHT: "soft-light", DIFFERENCE: "difference", EXCLUSION: "exclusion", HUE: "hue", SATURATION: "saturation", COLOR: "color", LUMINOSITY: "luminosity" };
  return map[m] || "normal";
}
function fontWeight(style) {
  var s = (style || "").toLowerCase();
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semibold|demibold/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}
function sanitize(name) { return ((name || "element").toLowerCase().replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, "-").replace(/^(\d)/, "el-$1").replace(/-+/g, "-").substring(0, 40)) || "element"; }
function round(v) { return Math.round(v); }
function round2(v) { return Math.round(v * 100) / 100; }
function r255(v) { return Math.round(v * 255); }
function notMixed(v) { return typeof v !== "symbol"; }