// app.js v3 — Proyector de Servicio
const channel = new BroadcastChannel('proyector-sync');
let projectorWindow = null;
let projTheme = 'dark';
let projFont = "'Space Grotesk',sans-serif";
let projSize = '5.2vw';

const state = {
  section: 'canciones',
  selectedId: null,
  currentList: null,
  liveRef: null,
  audio: { dirHandle:null, files:[], currentIndex:-1, el:new Audio(), scrubbing:false },
};

// ── UTILS ──
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toastRoot').appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
function el(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── BOOT ──
async function boot() {
  if (!storage.supported) {
    document.getElementById('editor').innerHTML='<div class="editor-empty"><p>Usa Chrome actualizado.</p></div>';
    return;
  }
  const status = await storage.restore();
  if (status===true) {
    const exists = await storage.folderExists();
    if (!exists) { showFolderGate('deleted'); return; }
    afterDataReady();
  } else if (status==='needs-permission') {
    showFolderGate('needs-permission');
  } else {
    showFolderGate('new');
  }
}

function showFolderGate(mode) {
  let overlay = document.getElementById('folderOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'folderOverlay';
    overlay.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:999;background:var(--bg);';
    document.body.appendChild(overlay);
  }
  const msgs = {
    new: { icon:'📁', title:'Bienvenido a Proyector de Servicio', body:'Para empezar, elige o crea la carpeta donde se guardarán tus datos.', btn:'Elegir mi carpeta de datos' },
    'needs-permission': { icon:'🔑', title:'Un momento antes de continuar', body:'Chrome necesita confirmar el acceso a tu carpeta de datos. Solo toma un clic.', btn:'Conceder acceso' },
    deleted: { icon:'📂', title:'No encontramos tu carpeta de datos', body:'La carpeta fue borrada o movida. Elige una nueva para continuar.', btn:'Elegir carpeta de datos' },
  };
  const m = msgs[mode];
  overlay.innerHTML=`
    <div style="max-width:420px;width:90%;text-align:center;padding:20px;">
      <div style="width:68px;height:68px;border-radius:16px;background:linear-gradient(145deg,#E8AA4C,#b8821c);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-weight:800;color:#1a1005;font-size:30px;box-shadow:0 6px 20px rgba(232,170,76,.3);">P</div>
      <h2 style="margin:0 0 8px;font-size:22px;color:var(--text);">${m.title}</h2>
      <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin:0 0 24px;">${m.body}</p>
      <button class="btn btn-primary" id="btnChooseFolder" style="width:100%;padding:13px;font-size:14px;border-radius:10px;">📁  ${m.btn}</button>
      ${mode==='new'?'<p style="margin-top:14px;font-size:11px;color:var(--text-faint);">Esta configuración solo se hace una vez.</p>':''}
    </div>`;
  document.getElementById('btnChooseFolder').onclick = async ()=>{
    try {
      if (mode==='needs-permission') { const ok=await storage.requestPermission(); if(!ok)return; }
      else { await storage.chooseFolder(); }
      overlay.remove();
      renderListSelect(); renderTimeline();
      afterDataReady();
    } catch(e){}
  };
}

function afterDataReady() {
  renderLibrary(); renderEditorEmpty(); renderListSelect(); renderTimeline();
  const room = getRemoteRoom();
  connectRemoteWS(room, handleRemoteMessage);
}

async function ensureDataFolder() {
  if (storage.dirHandle) return true;
  try {
    await storage.chooseFolder();
    renderListSelect(); renderTimeline();
    return true;
  } catch(e) { toast('Necesitas elegir una carpeta de datos.'); return false; }
}

// ── SECCIONES / RAIL ──
document.querySelectorAll('.rail-btn[data-section]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.rail-btn[data-section]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.section = btn.dataset.section;
    state.selectedId = null;
    if (state.section==='audio') renderAudioSection();
    else if (state.section==='biblia') renderBibleSection();
    else { renderLibrary(); renderEditorEmpty(); }
  });
});

// ── LIBRARY ──
function renderLibrary() {
  const META = { canciones:{title:'Letras',addLabel:'+ Agregar letra'}, anuncios:{title:'Anuncios',addLabel:'+ Agregar anuncio'}, citas:{title:'Citas bíblicas',addLabel:'+ Agregar cita'} };
  const meta = META[state.section];
  if (!meta) return;
  document.getElementById('libTitle').textContent = meta.title;
  const items = storage.list(state.section);
  document.getElementById('libCount').textContent = items.length;
  document.getElementById('btnAdd').textContent = meta.addLabel;

  const query = document.getElementById('libSearch').value.trim().toLowerCase();
  const filtered = items.filter(i=>(i.title||i.reference||'').toLowerCase().includes(query));
  const list = document.getElementById('libList');
  list.innerHTML='';
  if (!filtered.length) { list.appendChild(el(`<div class="lib-empty">${items.length?'Sin resultados.':'Todavía no hay elementos. Agrega el primero.'}</div>`)); return; }

  filtered.forEach(item=>{
    const title = item.title||item.reference;
    const sub = state.section==='canciones'
      ? (item.author||'Sin autor')+` · ${item.slides?item.slides.length:0} diap.`
      : state.section==='anuncios' ? (item.type==='image'?'Imagen':'Texto')
      : 'Cita bíblica';
    const row = el(`
      <div class="lib-item ${state.selectedId===item.id?'selected':''}">
        <div class="lib-item-row">
          <div><div class="t-title">${esc(title)}</div><div class="t-sub">${esc(sub)}</div></div>
          <div class="lib-item-actions">
            <button class="icon-btn" data-act="project" title="Proyectar">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg>
            </button>
            <button class="icon-btn danger" data-act="delete" title="Eliminar">✕</button>
          </div>
        </div>
      </div>`);
    row.addEventListener('click',e=>{
      if (e.target.closest('[data-act="delete"]')) { deleteItem(item.id); return; }
      if (e.target.closest('[data-act="project"]')) { projectItem(state.section,item,0); return; }
      state.selectedId = item.id;
      openEditorFor(item);
    });
    list.appendChild(row);
  });
}
document.getElementById('libSearch').addEventListener('input',()=>{ if(!['audio','biblia'].includes(state.section)) renderLibrary(); });

document.getElementById('btnAdd').addEventListener('click',async()=>{
  if (state.section==='audio') { await chooseAudioFolder(); return; }
  if (!(await ensureDataFolder())) return;
  openEditorFor(null);
});

async function deleteItem(id) {
  if (!confirm('¿Eliminar este elemento?')) return;
  await storage.remove(state.section, id);
  if (state.selectedId===id) { state.selectedId=null; renderEditorEmpty(); }
  renderLibrary();
}

function renderEditorEmpty() {
  document.getElementById('editor').innerHTML=`
    <div class="editor-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>Selecciona un elemento o agrega uno nuevo.</p>
    </div>`;
}

function openEditorFor(item) {
  if (state.section==='canciones') renderSongEditor(item);
  else if (state.section==='anuncios') renderAnnouncementEditor(item);
  else if (state.section==='citas') renderVerseEditor(item);
}

// ── EDITOR CANCIONES (con slide cards) ──
function renderSongEditor(item) {
  const isNew = !item;
  const draft = item ? JSON.parse(JSON.stringify(item)) : { id:uid(), title:'', author:'', slides:[''] };
  const editor = document.getElementById('editor');
  editor.innerHTML=`
    <div class="editor-toolbar">
      <h2>${isNew?'Nueva letra':'Editar letra'}</h2>
      <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
    </div>
    <div class="field-row split">
      <div><label class="field-label">Título</label><input class="field-input" id="songTitle" value="${esc(draft.title)}" placeholder="Nombre de la canción"/></div>
      <div><label class="field-label">Autor</label><input class="field-input" id="songAuthor" value="${esc(draft.author)}" placeholder="Autor / intérprete"/></div>
    </div>
    <label class="field-label">Diapositivas — arrastra para reordenar</label>
    <p class="hint" style="margin-bottom:10px;">Cada tarjeta es una diapositiva. Haz clic en ella para editar el texto. La primera diapositiva (título) se genera automáticamente.</p>
    <div class="slides-grid" id="slidesGrid"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveSong">Guardar letra</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;

  document.getElementById('songTitle').addEventListener('input',e=>draft.title=e.target.value);
  document.getElementById('songAuthor').addEventListener('input',e=>draft.author=e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());

  function renderSlideCards() {
    const grid = document.getElementById('slidesGrid');
    if (!grid) return;
    grid.innerHTML='';
    draft.slides.forEach((text,i)=>{
      const bg = projTheme==='light' ? 'light-bg' : 'dark-bg';
      const card = el(`
        <div class="slide-card" draggable="true" data-i="${i}">
          <div class="slide-card-preview ${bg}">
            <div class="slide-card-text">${esc(text)||'<span style="opacity:.35">Vacía</span>'}</div>
          </div>
          <div class="slide-card-footer">
            <span class="slide-card-num">DIAP. ${i+1}</span>
            <div class="slide-card-actions">
              <span class="slide-card-drag">⠿</span>
              <button class="icon-btn danger" title="Eliminar">✕</button>
            </div>
          </div>
        </div>`);
      card.querySelector('.icon-btn').addEventListener('click',()=>{
        if (draft.slides.length<=1){ toast('Debe quedar al menos una diapositiva.'); return; }
        draft.slides.splice(i,1); renderSlideCards();
      });
      card.querySelector('.slide-card-preview').addEventListener('click',()=>openSlideEdit(i));
      card.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);card.style.opacity='.4';});
      card.addEventListener('dragend',()=>card.style.opacity='1');
      card.addEventListener('dragover',e=>e.preventDefault());
      card.addEventListener('drop',e=>{
        e.preventDefault();
        const from=parseInt(e.dataTransfer.getData('text/plain'));
        if(from===i)return;
        const [moved]=draft.slides.splice(from,1);
        draft.slides.splice(i,0,moved);
        renderSlideCards();
      });
      grid.appendChild(card);
    });
    // Botón agregar
    const addCard = el(`
      <button class="slide-add-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
        Agregar diapositiva
      </button>`);
    addCard.addEventListener('click',()=>{ draft.slides.push(''); renderSlideCards(); });
    grid.appendChild(addCard);
  }

  function openSlideEdit(i) {
    const existing = document.getElementById('slideEditOverlay');
    if (existing) existing.remove();
    const overlay = el(`
      <div class="slide-edit-overlay" id="slideEditOverlay">
        <div class="slide-edit-box">
          <h4>Editar diapositiva ${i+1}</h4>
          <textarea class="field-input" id="slideEditText" rows="5" placeholder="Texto de esta diapositiva...">${esc(draft.slides[i])}</textarea>
          <div class="slide-edit-actions">
            <button class="btn btn-ghost btn-sm" id="slideEditCancel">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="slideEditSave">Guardar</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(overlay);
    document.getElementById('slideEditText').focus();
    document.getElementById('slideEditCancel').addEventListener('click',()=>overlay.remove());
    document.getElementById('slideEditSave').addEventListener('click',()=>{
      draft.slides[i]=document.getElementById('slideEditText').value;
      overlay.remove(); renderSlideCards();
    });
    overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });
  }

  renderSlideCards();

  document.getElementById('btnSaveSong').addEventListener('click',async()=>{
    if (!draft.title.trim()){ toast('Ponle un título a la canción.'); return; }
    draft.slides = draft.slides.filter(s=>s.trim()||draft.slides.length===1);
    try {
      await storage.save('canciones',draft);
      toast('Letra guardada.');
      state.selectedId=draft.id;
      renderLibrary(); renderSongEditor(draft);
    } catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('canciones',draft,0));
}

// ── EDITOR ANUNCIOS ──
function renderAnnouncementEditor(item) {
  const isNew=!item;
  const draft=item?JSON.parse(JSON.stringify(item)):{id:uid(),title:'',type:'text',text:'',imageData:''};
  const editor=document.getElementById('editor');
  editor.innerHTML=`
    <div class="editor-toolbar">
      <h2>${isNew?'Nuevo anuncio':'Editar anuncio'}</h2>
      <button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button>
    </div>
    <div class="field-row"><label class="field-label">Título (referencia interna)</label><input class="field-input" id="annTitle" value="${esc(draft.title)}" placeholder="Ej: Reunión de jóvenes..."/></div>
    <div class="toggle-group" id="annToggle">
      <div class="toggle-opt ${draft.type==='text'?'active':''}" data-t="text">Texto</div>
      <div class="toggle-opt ${draft.type==='image'?'active':''}" data-t="image">Imagen</div>
    </div>
    <div id="annBody"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveAnn">Guardar anuncio</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;

  function renderBody(){
    const body=document.getElementById('annBody');
    if(draft.type==='text'){
      body.innerHTML='';
      const ta=el(`<textarea class="field-input" rows="8" placeholder="Texto del anuncio...">${esc(draft.text)}</textarea>`);
      ta.addEventListener('input',e=>draft.text=e.target.value);
      body.appendChild(ta);
    } else {
      body.innerHTML='';
      const zone=el(`<div class="drop-zone">Haz clic para elegir imagen<br><span style="font-size:11px;">JPG o PNG</span></div>`);
      const input=el(`<input type="file" accept="image/*" style="display:none;"/>`);
      zone.appendChild(input);
      zone.addEventListener('click',()=>input.click());
      input.addEventListener('change',()=>{
        const f=input.files[0]; if(!f)return;
        const r=new FileReader();
        r.onload=()=>{ draft.imageData=r.result; renderBody(); };
        r.readAsDataURL(f);
      });
      body.appendChild(zone);
      if(draft.imageData) body.appendChild(el(`<img class="img-preview" src="${draft.imageData}"/>`));
    }
  }
  renderBody();
  document.getElementById('annTitle').addEventListener('input',e=>draft.title=e.target.value);
  document.querySelectorAll('#annToggle .toggle-opt').forEach(o=>{
    o.addEventListener('click',()=>{ draft.type=o.dataset.t; document.querySelectorAll('#annToggle .toggle-opt').forEach(x=>x.classList.toggle('active',x===o)); renderBody(); });
  });
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());
  document.getElementById('btnSaveAnn').addEventListener('click',async()=>{
    if(!draft.title.trim()){ toast('Ponle un título al anuncio.'); return; }
    if(draft.type==='text'&&!draft.text.trim()){ toast('Escribe el texto del anuncio.'); return; }
    if(draft.type==='image'&&!draft.imageData){ toast('Elige una imagen.'); return; }
    try{ await storage.save('anuncios',draft); toast('Anuncio guardado.'); state.selectedId=draft.id; renderLibrary(); renderAnnouncementEditor(draft); }
    catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('anuncios',draft,0));
}

// ── EDITOR CITAS ──
function renderVerseEditor(item) {
  const isNew=!item;
  const draft=item?JSON.parse(JSON.stringify(item)):{id:uid(),reference:'',text:''};
  document.getElementById('editor').innerHTML=`
    <div class="editor-toolbar"><h2>${isNew?'Nueva cita bíblica':'Editar cita'}</h2><button class="btn btn-ghost btn-sm" id="btnCancelEdit">Cancelar</button></div>
    <div class="field-row"><label class="field-label">Referencia</label><input class="field-input" id="verseRef" value="${esc(draft.reference)}" placeholder="Ej: Juan 3:16"/></div>
    <div class="field-row"><label class="field-label">Texto del versículo</label><textarea class="field-input" id="verseText" rows="6" placeholder="Escribe el texto...">${esc(draft.text)}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnSaveVerse">Guardar cita</button>
      ${!isNew?'<button class="btn btn-ghost" id="btnProjectFromEditor">Proyectar</button>':''}
    </div>`;
  document.getElementById('verseRef').addEventListener('input',e=>draft.reference=e.target.value);
  document.getElementById('verseText').addEventListener('input',e=>draft.text=e.target.value);
  document.getElementById('btnCancelEdit').addEventListener('click',()=>item?openEditorFor(item):renderEditorEmpty());
  document.getElementById('btnSaveVerse').addEventListener('click',async()=>{
    if(!draft.reference.trim()){ toast('Ponle una referencia a la cita.'); return; }
    try{ await storage.save('citas',draft); toast('Cita guardada.'); state.selectedId=draft.id; renderLibrary(); renderVerseEditor(draft); }
    catch(e){ toast(e.message); }
  });
  const pf=document.getElementById('btnProjectFromEditor');
  if(pf) pf.addEventListener('click',()=>projectItem('citas',draft,0));
}

// ── MÓDULO BIBLIA ──
const bibleState = { bookIndex:0, chapterIndex:0, selectedVerses:new Set() };

function renderBibleSection() {
  document.getElementById('libTitle').textContent='Biblia RVR60';
  document.getElementById('libCount').textContent='';
  document.getElementById('btnAdd').style.display='none';
  document.getElementById('libSearch').style.display='none';
  document.getElementById('libList').innerHTML='';

  const editor = document.getElementById('editor');
  editor.innerHTML=`<div class="bible-loading" id="bibleLoading"><div class="spinner"></div><span id="bibleLoadMsg">Cargando Biblia...</span></div>`;

  bible.load(msg=>{ const el=document.getElementById('bibleLoadMsg'); if(el)el.textContent=msg; }).then(ok=>{
    if (!ok) { editor.innerHTML='<div class="editor-empty"><p>No se pudo cargar la Biblia.<br>Verifica tu conexión a internet la primera vez.</p></div>'; return; }
    renderBibleBrowser();
  });
}

const MAX_VERSES = 3;

function renderBibleBrowser() {
  const editor = document.getElementById('editor');
  editor.innerHTML=`
    <div style="display:flex;flex-direction:column;height:100%;gap:0;overflow:hidden;">
      <div class="editor-toolbar" style="flex-shrink:0;">
        <h2>Biblia — Reina Valera 1960</h2>
      </div>

      <!-- Selector de libro -->
      <div class="bible-top-bar" style="flex-shrink:0;">
        <select class="bible-select" id="bibleBook"></select>
      </div>

      <!-- Grid de capítulos -->
      <div style="flex-shrink:0;margin-bottom:10px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);font-weight:700;margin-bottom:6px;">Capítulo</div>
        <div class="bible-chap-grid" id="bibleChapGrid"></div>
      </div>

      <!-- Barra de proyección siempre visible -->
      <div class="bible-proj-bar" style="flex-shrink:0;">
        <div class="bible-sel-counter"><span id="bibleSelCount">0</span>/${MAX_VERSES} versículos seleccionados</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" id="btnAddBibleToList">+ Lista</button>
          <button class="bible-proj-action" id="btnProjBible" disabled>Proyectar</button>
        </div>
      </div>

      <!-- Lista de versículos -->
      <div class="bible-verse-list" id="bibleVerseList"></div>
    </div>`;

  // Poblar libros
  const bookSel = document.getElementById('bibleBook');
  [['Antiguo Testamento',0,38],['Nuevo Testamento',39,65]].forEach(([group,from,to])=>{
    const og = document.createElement('optgroup');
    og.label = group;
    for(let i=from;i<=to;i++){
      const o=document.createElement('option');
      o.value=i; o.textContent=bible.BOOK_NAMES[i];
      if(i===bibleState.bookIndex) o.selected=true;
      og.appendChild(o);
    }
    bookSel.appendChild(og);
  });
  bookSel.addEventListener('change',()=>{
    bibleState.bookIndex=parseInt(bookSel.value);
    bibleState.chapterIndex=0;
    bibleState.selectedVerses.clear();
    renderBibleChapGrid();
    renderBibleVerses();
    updateBibleProjBar();
  });

  renderBibleChapGrid();
  renderBibleVerses();

  document.getElementById('btnProjBible').addEventListener('click',()=>{
    if(!bibleState.selectedVerses.size) return;
    projectBibleSelection();
  });

  document.getElementById('btnAddBibleToList').addEventListener('click',()=>{
    if(!bibleState.selectedVerses.size){ toast('Selecciona al menos un versículo.'); return; }
    const payload=buildBiblePayload();
    const list=getCurrentList();
    if(!list){ toast('Crea una lista de servicio primero.'); return; }
    list.items.push({ type:'citas', refId:'bible-'+uid(), title:payload.reference, biblePayload:payload });
    storage.saveList(list).then(()=>{ renderTimeline(); toast('Añadido a la lista.'); });
  });
}

function buildBiblePayload() {
  const sorted=[...bibleState.selectedVerses].sort((a,b)=>a-b);
  return bible.buildVersePayload(bibleState.bookIndex,bibleState.chapterIndex,sorted[0],sorted[sorted.length-1]);
}

function projectBibleSelection() {
  const payload=buildBiblePayload();
  state.liveRef={ collection:'biblia', id:'bible-current', slideIndex:0,
    snapshot:{ title:payload.reference, slides:[payload.text], reference:payload.reference, text:payload.text } };
  sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
}

function updateBibleProjBar() {
  const count = bibleState.selectedVerses.size;
  const countEl = document.getElementById('bibleSelCount');
  const btn = document.getElementById('btnProjBible');
  if(countEl) countEl.textContent = count;
  if(btn) {
    btn.disabled = count === 0;
    btn.textContent = count > 0 ? `Proyectar (${count})` : 'Proyectar';
  }
}

function renderBibleChapGrid() {
  const grid = document.getElementById('bibleChapGrid');
  if(!grid) return;
  const book = bible.getBook(bibleState.bookIndex);
  if(!book) return;
  grid.innerHTML='';
  book.chapters.forEach((_,i)=>{
    const btn = document.createElement('button');
    btn.className = 'bible-chap-btn' + (i===bibleState.chapterIndex?' active':'');
    btn.textContent = i+1;
    btn.addEventListener('click',()=>{
      bibleState.chapterIndex=i;
      bibleState.selectedVerses.clear();
      grid.querySelectorAll('.bible-chap-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
      renderBibleVerses();
      updateBibleProjBar();
    });
    grid.appendChild(btn);
  });
}

function renderBibleVerses() {
  const list=document.getElementById('bibleVerseList');
  if(!list) return;
  const verses=bible.getChapter(bibleState.bookIndex,bibleState.chapterIndex);
  list.innerHTML='';
  verses.forEach((text,i)=>{
    const isSelected = bibleState.selectedVerses.has(i);
    const isDisabled = !isSelected && bibleState.selectedVerses.size >= MAX_VERSES;
    const item=el(`
      <div class="bible-verse-item ${isSelected?'selected':''} ${isDisabled?'disabled':''}">
        <span class="bible-verse-num">${i+1}</span>
        <span class="bible-verse-text">${esc(text)}</span>
      </div>`);
    item.addEventListener('click',()=>{
      if(bibleState.selectedVerses.has(i)){
        bibleState.selectedVerses.delete(i);
      } else {
        if(bibleState.selectedVerses.size>=MAX_VERSES){
          toast(`Máximo ${MAX_VERSES} versículos a la vez.`); return;
        }
        bibleState.selectedVerses.add(i);
      }
      updateBibleProjBar();
      renderBibleVerses();
    });
    list.appendChild(item);
  });
}

// ── AUDIO ──
function renderAudioSection() {
  document.getElementById('libTitle').textContent='Audio';
  document.getElementById('libCount').textContent=state.audio.files.length;
  document.getElementById('btnAdd').textContent='+ Elegir carpeta de audio';
  document.getElementById('btnAdd').style.display='';
  document.getElementById('libSearch').style.display='';
  const list=document.getElementById('libList');
  list.innerHTML='';
  if(!state.audio.files.length){ list.appendChild(el('<div class="lib-empty">No hay carpeta de audio seleccionada.<br>Usa el botón de arriba.</div>')); }
  else {
    state.audio.files.forEach((f,i)=>{
      const item=el(`<div class="lib-item ${state.audio.currentIndex===i?'selected':''}"><div class="lib-item-row"><div><div class="t-title">${esc(f.name)}</div><div class="t-sub">Pista ${i+1}</div></div></div></div>`);
      item.addEventListener('click',()=>playAudioAt(i));
      list.appendChild(item);
    });
  }
  document.getElementById('editor').innerHTML=`<div class="editor-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg><p>Reproductor de audio independiente.<br>Elige una pista para reproducirla.</p></div>`;
}

async function chooseAudioFolder() {
  try {
    const handle=await window.showDirectoryPicker();
    state.audio.dirHandle=handle; state.audio.files=[];
    for await (const [name,h] of handle.entries()) {
      if(h.kind==='file'&&/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) state.audio.files.push({name,handle:h});
    }
    state.audio.files.sort((a,b)=>a.name.localeCompare(b.name));
    state.audio.currentIndex=-1;
    renderAudioSection(); toast(`${state.audio.files.length} pistas encontradas.`);
  } catch(e){}
}
document.getElementById('btnAudioFolder').addEventListener('click',chooseAudioFolder);

async function playAudioAt(i) {
  state.audio.currentIndex=i;
  const f=state.audio.files[i];
  const file=await f.handle.getFile();
  const url=URL.createObjectURL(file);
  state.audio.el.src=url; state.audio.el.play();
  document.getElementById('audioNow').textContent=f.name;
  document.getElementById('btnAudioPlay').textContent='⏸';
  if(state.section==='audio') renderAudioSection();
  publishRemoteState();
}

document.getElementById('btnAudioPlay').addEventListener('click',()=>{
  if(state.audio.currentIndex===-1&&state.audio.files.length){ playAudioAt(0); return; }
  if(state.audio.el.paused){ state.audio.el.play(); document.getElementById('btnAudioPlay').textContent='⏸'; }
  else{ state.audio.el.pause(); document.getElementById('btnAudioPlay').textContent='▶'; }
});
document.getElementById('btnAudioNext').addEventListener('click',()=>{
  if(!state.audio.files.length)return;
  playAudioAt((state.audio.currentIndex+1)%state.audio.files.length);
});
document.getElementById('btnAudioPrev').addEventListener('click',()=>{
  if(state.audio.currentIndex===-1)return;
  state.audio.el.currentTime=0; state.audio.el.play();
  document.getElementById('btnAudioPlay').textContent='⏸';
});

let _lastAudioPublish=0;
state.audio.el.addEventListener('timeupdate',()=>{
  const{currentTime,duration}=state.audio.el;
  if(duration&&!state.audio.scrubbing) document.getElementById('audioProgressFill').style.width=`${(currentTime/duration)*100}%`;
  const now=Date.now();
  if(now-_lastAudioPublish>3000){ _lastAudioPublish=now; publishRemoteState(); }
});
state.audio.el.addEventListener('ended',()=>document.getElementById('btnAudioNext').click());

const audioProgressBar=document.getElementById('audioProgress');
function seekFromEvent(e){
  if(!state.audio.el.duration)return;
  const rect=audioProgressBar.getBoundingClientRect();
  const ratio=Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
  document.getElementById('audioProgressFill').style.width=`${ratio*100}%`;
  state.audio.el.currentTime=ratio*state.audio.el.duration;
}
audioProgressBar.addEventListener('mousedown',e=>{
  if(state.audio.currentIndex===-1)return;
  state.audio.scrubbing=true;
  seekFromEvent(e);
  const onMove=ev=>seekFromEvent(ev);
  const onUp=()=>{ state.audio.scrubbing=false; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
});

// ── PROYECCIÓN ──
function kindForCollection(c){ return c==='canciones'?'song':c==='anuncios'?'announcement':c==='biblia'?'verse':'verse'; }

function songDisplaySlides(song) {
  return [{ isTitle:true, title:song.title, author:song.author }, ...song.slides.map(text=>({text}))];
}

function buildPayloadFromLive() {
  const{collection,snapshot,slideIndex}=state.liveRef;
  const kind=kindForCollection(collection);
  if(kind==='announcement'&&snapshot.type==='image') return{kind:'image',imageData:snapshot.imageData};
  if(kind==='song'){
    const slides=songDisplaySlides(snapshot);
    const s=slides[slideIndex]||slides[0];
    if(s.isTitle) return{kind:'song',text:s.title,reference:s.author||undefined};
    return{kind:'song',text:s.text};
  }
  return{kind:'verse',text:snapshot.text||snapshot.slides?.[slideIndex]||'',reference:snapshot.reference};
}

function projectItem(collection,item,slideIndex){
  state.liveRef={collection,id:item.id,slideIndex:slideIndex||0,snapshot:item};
  sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
}

function clearProjection(){
  state.liveRef=null;
  sendCurrentSlide(); renderPreview(); updateLiveBadge(false); highlightTimelineLive();
  publishRemoteState();
}
document.getElementById('btnClearProj').addEventListener('click',clearProjection);

function sendCurrentSlide(){
  if(!state.liveRef){ channel.postMessage({type:'content',payload:{kind:'blank'}}); publishRemoteState(); updateMobileProjBar(); return; }
  channel.postMessage({type:'content',payload:buildPayloadFromLive(),font:projFont,size:projSize});
  publishRemoteState(); updateMobileProjBar();
}

function updateLiveBadge(on){
  document.getElementById('liveBadge').classList.toggle('on',on);
  document.getElementById('liveText').textContent=on?'EN VIVO':'SIN SEÑAL';
  document.getElementById('dotLive').classList.toggle('on',on);
  document.getElementById('dotLive2').classList.toggle('on',on);
}

function renderPreview(){
  const frame=document.getElementById('projFrame');
  const slideNav=document.getElementById('slideNav');
  if(!state.liveRef){ frame.innerHTML='<span class="ph-text">Nada en proyección</span>'; slideNav.classList.add('hidden'); return; }
  const{collection,snapshot,slideIndex}=state.liveRef;
  const kind=kindForCollection(collection);
  if(kind==='announcement'&&snapshot.type==='image'){ frame.innerHTML=`<img src="${snapshot.imageData}"/>`; slideNav.classList.add('hidden'); return; }
  let text='',totalSlides=1;
  if(kind==='song'){
    const slides=songDisplaySlides(snapshot); totalSlides=slides.length;
    const s=slides[slideIndex]||slides[0];
    text=s.isTitle?s.title+(s.author?`\n${s.author}`:''):s.text;
  } else { text=(snapshot.text||snapshot.slides?.[slideIndex]||'')+(snapshot.reference?`\n— ${snapshot.reference}`:''); }
  frame.innerHTML=`<span class="ph-text">${esc(text)}</span>`;
  if(kind==='song'&&totalSlides>1){ slideNav.classList.remove('hidden'); document.getElementById('slideCounter').textContent=`${slideIndex+1}/${totalSlides}`; }
  else slideNav.classList.add('hidden');
}

document.getElementById('btnPrevSlide').addEventListener('click',()=>{
  if(!state.liveRef)return;
  state.liveRef.slideIndex=Math.max(0,state.liveRef.slideIndex-1);
  sendCurrentSlide(); renderPreview();
});
document.getElementById('btnNextSlide').addEventListener('click',()=>{
  if(!state.liveRef)return;
  const kind=kindForCollection(state.liveRef.collection);
  const max=kind==='song'?songDisplaySlides(state.liveRef.snapshot).length-1:0;
  state.liveRef.slideIndex=Math.min(max,state.liveRef.slideIndex+1);
  sendCurrentSlide(); renderPreview();
});

channel.onmessage=e=>{ if(e.data&&e.data.type==='request-state') sendCurrentSlide(); };

// Tema y fuente
let _projThemeApplied=false;
document.getElementById('btnToggleTheme').addEventListener('click',()=>{
  projTheme=projTheme==='dark'?'light':'dark';
  document.getElementById('btnToggleTheme').textContent=projTheme==='dark'?'☀️ Fondo blanco':'🌙 Fondo negro';
  channel.postMessage({type:'theme',theme:projTheme});
  // Actualizar preview frame
  const frame=document.getElementById('projFrame');
  frame.style.background=projTheme==='light'?'#fff':'#000';
  const txt=frame.querySelector('.ph-text');
  if(txt) txt.style.color=projTheme==='light'?'#111':'#fff';
  renderPreview();
});
document.getElementById('projFont').addEventListener('change',e=>{
  projFont=e.target.value;
  channel.postMessage({type:'settings',font:projFont,size:projSize});
});
document.getElementById('projSize').addEventListener('change',e=>{
  projSize=e.target.value;
  channel.postMessage({type:'settings',font:projFont,size:projSize});
});

// ── PROYECTOR WINDOW ──
function openProjectorWindow(){ projectorWindow=window.open('projection.html','proyeccion','width=1280,height=720'); }
document.getElementById('btnProjectorWindow').addEventListener('click',openProjectorWindow);
document.getElementById('btnOpenProjector').addEventListener('click',openProjectorWindow);

// ── LISTA DE SERVICIO ──
function renderListSelect(){
  const sel=document.getElementById('listSelect');
  const lists=storage.getLists();
  sel.innerHTML=lists.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');
  if(!state.currentList&&lists.length) state.currentList=lists[0].id;
  if(state.currentList) sel.value=state.currentList;
  if(!lists.length) sel.innerHTML='<option>Sin listas — crea una</option>';
}
document.getElementById('listSelect').addEventListener('change',e=>{ state.currentList=e.target.value; renderTimeline(); });
document.getElementById('btnNewList').addEventListener('click',async()=>{
  if(!(await ensureDataFolder()))return;
  const name=prompt('Nombre de la lista:',`Servicio ${new Date().toLocaleDateString('es-MX')}`);
  if(!name)return;
  const list={id:uid(),name,items:[]};
  await storage.saveList(list); state.currentList=list.id; renderListSelect(); renderTimeline();
});
document.getElementById('btnDeleteList').addEventListener('click',async()=>{
  if(!state.currentList)return;
  if(!confirm('¿Borrar esta lista?'))return;
  await storage.removeList(state.currentList); state.currentList=null; renderListSelect(); renderTimeline();
});

function getCurrentList(){ return storage.getLists().find(l=>l.id===state.currentList)||null; }

function renderTimeline(){
  const tl=document.getElementById('timeline');
  const list=getCurrentList();
  tl.innerHTML='';
  if(!list){ tl.appendChild(el('<div class="tl-empty">Crea una lista de servicio para organizar el culto.</div>')); return; }
  if(!list.items.length){ tl.appendChild(el('<div class="tl-empty">Lista vacía — usa "+ Agregar a la lista".</div>')); return; }
  list.items.forEach((it,idx)=>{
    const isLive=state.liveRef&&state.liveRef.collection===it.type&&state.liveRef.id===it.refId;
    const node=el(`
      <div class="tl-item ${isLive?'live':''}" draggable="true" data-idx="${idx}">
        <button class="tl-remove" title="Quitar">✕</button>
        <div class="tl-type">${it.type}</div>
        <div class="tl-title">${esc(it.title)}</div>
      </div>`);
    node.addEventListener('click',e=>{
      if(e.target.closest('.tl-remove')){ list.items.splice(idx,1); storage.saveList(list).then(renderTimeline); return; }
      if(it.biblePayload){
        state.liveRef={collection:'biblia',id:it.refId,slideIndex:0,snapshot:{title:it.title,text:it.biblePayload.text,reference:it.biblePayload.reference,slides:[it.biblePayload.text]}};
        sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive(); return;
      }
      const item=storage.list(it.type).find(x=>x.id===it.refId);
      if(item){ projectItem(it.type,item,0); renderTimeline(); } else toast('Este elemento ya no existe en la biblioteca.');
    });
    node.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',idx); });
    node.addEventListener('dragover',e=>e.preventDefault());
    node.addEventListener('drop',e=>{ e.preventDefault(); const from=parseInt(e.dataTransfer.getData('text/plain')); if(from===idx)return; const[moved]=list.items.splice(from,1); list.items.splice(idx,0,moved); storage.saveList(list).then(renderTimeline); });
    tl.appendChild(node);
  });
}
function highlightTimelineLive(){ renderTimeline(); }

document.getElementById('btnAddToList').addEventListener('click',e=>{ const list=getCurrentList(); if(!list){ toast('Crea una lista de servicio primero.'); return; } openAddMenu(e.currentTarget); });

function openAddMenu(anchor){
  document.querySelectorAll('.menu').forEach(m=>m.remove());
  const rect=anchor.getBoundingClientRect();
  const menu=el(`<div class="menu" style="position:fixed;left:${rect.left-200}px;top:${rect.top-200}px;background:var(--panel-raised);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:50;min-width:170px;padding:6px;">
    <button data-c="canciones" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">🎵 Canción...</button>
    <button data-c="anuncios" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">📢 Anuncio...</button>
    <button data-c="citas" style="display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--text);padding:8px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;">📖 Cita...</button>
  </div>`);
  document.body.appendChild(menu);
  const close=()=>menu.remove();
  setTimeout(()=>document.addEventListener('click',close,{once:true}),0);
  menu.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ openPickerModal(b.dataset.c); menu.remove(); }));
}

function openPickerModal(collection){
  const items=storage.list(collection);
  const root=document.getElementById('modalRoot');
  const labelMap={canciones:'canción',anuncios:'anuncio',citas:'cita bíblica'};
  root.innerHTML=`
    <div class="modal-bg" id="modalBg"><div class="modal">
      <h3>Elige una ${labelMap[collection]}</h3>
      <div class="modal-list">
        ${items.length?items.map(i=>`<div class="lib-item" data-id="${i.id}"><div class="t-title">${esc(i.title||i.reference)}</div></div>`).join(''):'<div class="lib-empty">No hay elementos guardados todavía.</div>'}
      </div>
      <div class="btn-row"><button class="btn btn-ghost" id="modalCancel">Cancelar</button></div>
    </div></div>`;
  document.getElementById('modalCancel').addEventListener('click',()=>root.innerHTML='');
  document.getElementById('modalBg').addEventListener('click',e=>{ if(e.target.id==='modalBg') root.innerHTML=''; });
  root.querySelectorAll('.modal-list .lib-item').forEach(row=>{
    row.addEventListener('click',async()=>{
      const item=items.find(i=>i.id===row.dataset.id);
      const list=getCurrentList();
      list.items.push({type:collection,refId:item.id,title:item.title||item.reference});
      await storage.saveList(list); renderTimeline(); root.innerHTML='';
    });
  });
}

// ── MOBILE BAR ──
function updateMobileProjBar(){
  const dot=document.getElementById('dotLiveMobile');
  const title=document.getElementById('mobileProjTitle');
  const counter=document.getElementById('slideCounterMobile');
  if(!dot)return;
  if(!state.liveRef){ dot.classList.remove('on'); title.textContent='Sin proyección'; counter.textContent='-'; return; }
  dot.classList.add('on');
  title.textContent=state.liveRef.snapshot.title||state.liveRef.snapshot.reference||'Proyectando';
  const kind=kindForCollection(state.liveRef.collection);
  if(kind==='song'){ const total=songDisplaySlides(state.liveRef.snapshot).length; counter.textContent=`${state.liveRef.slideIndex+1}/${total}`; }
  else counter.textContent='1/1';
}
document.getElementById('btnPrevSlideMobile').addEventListener('click',()=>document.getElementById('btnPrevSlide').click());
document.getElementById('btnNextSlideMobile').addEventListener('click',()=>document.getElementById('btnNextSlide').click());
document.getElementById('btnClearMobile').addEventListener('click',clearProjection);

// ── CONTROL REMOTO MQTT ──
const REMOTE_KEY='proyector-remote-state';
let mqttClient=null,remoteConnected=false,_remoteRoom=null,_onRemoteMessage=null;

function getRemoteRoom(){ let r=localStorage.getItem('proyector-room'); if(!r){ r='ps-'+Math.random().toString(36).slice(2,10); localStorage.setItem('proyector-room',r); } return r; }

function connectRemoteWS(room,onMessage){
  _remoteRoom=room; _onRemoteMessage=onMessage;
  if(typeof Paho==='undefined')return;
  if(mqttClient&&mqttClient.isConnected())return;
  const clientId='chromebook-'+Math.random().toString(36).slice(2,8);
  mqttClient=new Paho.Client('broker.hivemq.com',8884,'/mqtt',clientId);
  mqttClient.onConnectionLost=()=>{ remoteConnected=false; setTimeout(()=>connectRemoteWS(room,onMessage),3000); };
  mqttClient.onMessageArrived=msg=>{ try{ onMessage(JSON.parse(msg.payloadString)); }catch(_){} };
  mqttClient.connect({ useSSL:true, keepAliveInterval:30,
    onSuccess:function(){ remoteConnected=true; mqttClient.subscribe('proyector/'+room+'/cmd'); },
    onFailure:function(){ remoteConnected=false; setTimeout(()=>connectRemoteWS(room,onMessage),4000); }
  });
}

function sendRemote(data){
  if(!mqttClient||!mqttClient.isConnected()||!_remoteRoom)return;
  const msg=new Paho.Message(JSON.stringify(data));
  msg.destinationName='proyector/'+_remoteRoom+'/state';
  msg.retained=true;
  try{ mqttClient.send(msg); }catch(_){}
}

function publishRemoteState(){
  if(!mqttClient||!mqttClient.isConnected())return;
  const payload=state.liveRef?buildPayloadFromLive():{kind:'blank'};
  const full={
    type:'state', payload,
    slideIndex:state.liveRef?state.liveRef.slideIndex:0,
    totalSlides:state.liveRef&&state.liveRef.snapshot&&state.liveRef.snapshot.slides?songDisplaySlides(state.liveRef.snapshot).length:1,
    title:state.liveRef?(state.liveRef.snapshot.title||state.liveRef.snapshot.reference||''):'',
    list:(()=>{ const l=getCurrentList(); if(!l)return[]; return l.items.map(it=>({ type:it.type, title:it.title, refId:it.refId, biblePayload:it.biblePayload||null, isLive:!!(state.liveRef&&state.liveRef.collection===it.type&&state.liveRef.id===it.refId) })); })(),
    library:{ canciones:storage.list('canciones'), anuncios:storage.list('anuncios').map(a=>({id:a.id,title:a.title,type:a.type})), citas:storage.list('citas') },
    audio:{ files:state.audio.files.map((f,i)=>({name:f.name,index:i})), currentIndex:state.audio.currentIndex, playing:!state.audio.el.paused, currentTime:state.audio.el.currentTime, duration:state.audio.el.duration||0 },
    bibleState:{ bookIndex:bibleState.bookIndex, chapterIndex:bibleState.chapterIndex },
    ts:Date.now(),
  };
  sendRemote(full);
}

function handleRemoteMessage(msg){
  if(msg.type!=='cmd')return;
  if(msg.action==='prev') document.getElementById('btnPrevSlide').click();
  else if(msg.action==='next') document.getElementById('btnNextSlide').click();
  else if(msg.action==='clear') clearProjection();
  else if(msg.action==='project'&&msg.collection&&msg.refId){
    if(msg.collection==='biblia'&&msg.biblePayload){
      state.liveRef={collection:'biblia',id:msg.refId,slideIndex:0,snapshot:{title:msg.biblePayload.reference,text:msg.biblePayload.text,reference:msg.biblePayload.reference,slides:[msg.biblePayload.text]}};
      sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
    } else {
      const item=storage.list(msg.collection).find(x=>x.id===msg.refId);
      if(item){ projectItem(msg.collection,item,0); renderTimeline(); }
    }
  }
  else if(msg.action==='request-state') publishRemoteState();
  else if(msg.action==='audio-play'){
    if(state.audio.el.paused){ state.audio.el.play(); document.getElementById('btnAudioPlay').textContent='⏸'; }
    else{ state.audio.el.pause(); document.getElementById('btnAudioPlay').textContent='▶'; }
    publishRemoteState();
  }
  else if(msg.action==='audio-next') document.getElementById('btnAudioNext').click();
  else if(msg.action==='audio-prev') document.getElementById('btnAudioPrev').click();
  else if(msg.action==='audio-select'&&typeof msg.index==='number') playAudioAt(msg.index);
  else if(msg.action==='audio-seek'&&typeof msg.ratio==='number'){
    if(state.audio.el.duration){ state.audio.el.currentTime=msg.ratio*state.audio.el.duration; publishRemoteState(); }
  }
  else if(msg.action==='bible-project'&&msg.biblePayload){
    state.liveRef={collection:'biblia',id:'bible-remote',slideIndex:0,snapshot:{title:msg.biblePayload.reference,text:msg.biblePayload.text,reference:msg.biblePayload.reference,slides:[msg.biblePayload.text]}};
    sendCurrentSlide(); renderPreview(); updateLiveBadge(true); highlightTimelineLive();
  }
}

// Botón de control remoto
document.getElementById('btnRemoteControl').addEventListener('click',()=>{
  const existing=document.getElementById('qrOverlay');
  if(existing){ existing.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); return; }
  state.audio.el.play().then(()=>{ state.audio.el.pause(); state.audio.el.currentTime=0; }).catch(()=>{});
  const room=getRemoteRoom();
  if(!mqttClient||!mqttClient.isConnected()) connectRemoteWS(room,handleRemoteMessage);
  const base=window.location.href.split('?')[0].replace(/\/[^/]*$/,'/');
  const remoteUrl=base+'remote.html?room='+room;
  const overlay=document.createElement('div');
  overlay.id='qrOverlay'; overlay.className='qr-overlay';
  overlay.innerHTML=`<div class="qr-card"><h3>📱 Control Remoto</h3><p>Escanea con la cámara del celular o tablet. Ambos dispositivos necesitan internet.</p><div id="qrCanvas"></div><div class="qr-url">${remoteUrl}</div><button class="btn btn-ghost" id="btnCloseQR" style="width:100%;justify-content:center;">Cerrar</button></div>`;
  document.body.appendChild(overlay);
  try{ new QRCode(document.getElementById('qrCanvas'),{text:remoteUrl,width:200,height:200,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); }
  catch(e){ document.getElementById('qrCanvas').textContent='Copia el enlace de abajo.'; }
  document.getElementById('btnCloseQR').addEventListener('click',()=>{ overlay.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); });
  overlay.addEventListener('click',e=>{ if(e.target===overlay){ overlay.remove(); document.getElementById('btnRemoteControl').classList.remove('active'); } });
  document.getElementById('btnRemoteControl').classList.add('active');
});

// ── INICIO ──
boot();
