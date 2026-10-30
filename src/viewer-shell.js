export function menuPosition(x,y,width,height,viewportWidth,viewportHeight){
  const margin=12,left=Math.max(margin,Math.min(x,viewportWidth-width-margin)),top=Math.max(margin,Math.min(y,viewportHeight-height-margin));
  return {left,top,origin:`${top<y?'bottom':'top'}-${left<x?'right':'left'}`};
}

export function uiHiddenPreference(search,saved=false){
  const value=new URLSearchParams(search).get('ui');
  return value==='0'?true:value==='1'?false:saved===true;
}

export function initialUiHidden(value){
  if(typeof value!=='boolean')try{value=localStorage.getItem('mte-ui-hidden')==='1';}catch{}
  return uiHiddenPreference(globalThis.location?.search||'',value);
}

export function uiShortcutPreference(value){
  return typeof value==='string'&&(value===''||/^[a-z]$/i.test(value))?value.toUpperCase():'H';
}

export function createViewerShell({stage,getView,setView,canSelect,canHide=()=>true,message,uiHidden:initialHidden=initialUiHidden()}){
  const menu=document.querySelector('#viewer-menu'),toggle=document.querySelector('#menu-toggle'),library=document.querySelector('.library'),inspector=document.querySelector('.inspector');
  const hideButton=document.querySelector('#viewer-hide-ui'),shortcutField=document.querySelector('#viewer-ui-shortcut');
  let closeTimer,returnFocus=toggle,uiHidden=false,shortcut='H';
  function restoreShortcut(){
    let saved;try{saved=localStorage.getItem('mte-ui-shortcut');}catch{}
    shortcut=uiShortcutPreference(saved);shortcutField.value=shortcut;
    if(shortcut)hideButton.setAttribute('aria-keyshortcuts',shortcut);else hideButton.removeAttribute('aria-keyshortcuts');
  }
  shortcutField.onchange=()=>{shortcut=uiShortcutPreference(shortcutField.value);try{localStorage.setItem('mte-ui-shortcut',shortcut);}catch{}if(shortcut)hideButton.setAttribute('aria-keyshortcuts',shortcut);else hideButton.removeAttribute('aria-keyshortcuts');};
  document.addEventListener('mte-preferences-restored',restoreShortcut);restoreShortcut();
  const items=()=>[...menu.querySelectorAll('[role="menuitem"]')].filter(item=>!item.disabled&&!item.hidden);
  function closeMenu(restore=false){
    if(!menu.classList.contains('is-open'))return;
    menu.classList.remove('is-open');menu.classList.add('is-closing');menu.inert=true;toggle.setAttribute('aria-expanded','false');
    clearTimeout(closeTimer);
    const closeMs=matchMedia('(prefers-reduced-motion: reduce)').matches?0:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur'))||150;
    closeTimer=setTimeout(()=>{menu.classList.remove('is-closing');menu.hidden=true;},closeMs);
    if(restore)returnFocus.focus({preventScroll:true});
  }
  function hidePanels(){
    library.hidden=true;inspector.hidden=true;document.body.classList.remove('library-open','inspector-open');
    document.querySelector('#library-toggle').setAttribute('aria-expanded','false');document.querySelector('#editor-toggle').setAttribute('aria-expanded','false');
  }
  function closePanels({watch=false,focus=true}={}){
    hidePanels();if(watch&&getView()!=='gallery')setView('gallery');if(focus)stage.canvas.focus({preventScroll:true});
  }
  function openMenu(x,y,from=toggle){
    if(uiHidden)setUiHidden(false,{focus:false});
    returnFocus=from;clearTimeout(closeTimer);menu.hidden=false;menu.inert=false;menu.classList.remove('is-closing','is-open');
    const bounds=toggle.getBoundingClientRect(),anchored=x===undefined;
    const position=menuPosition(anchored?bounds.right-menu.offsetWidth:x,anchored?bounds.bottom+8:y,menu.offsetWidth,menu.offsetHeight,innerWidth,innerHeight);
    menu.style.left=`${position.left}px`;menu.style.top=`${position.top}px`;menu.dataset.origin=anchored?'top-right':position.origin;
    void menu.offsetWidth;menu.classList.add('is-open');toggle.setAttribute('aria-expanded','true');items()[0]?.focus({preventScroll:true});
  }
  function openPanel(panel){
    if(uiHidden)setUiHidden(false,{focus:false});
    closeMenu();hidePanels();panel.hidden=false;
    const isLibrary=panel===library;document.body.classList.add(isLibrary?'library-open':'inspector-open');
    document.querySelector(isLibrary?'#library-toggle':'#editor-toggle').setAttribute('aria-expanded','true');
    panel.querySelector(isLibrary&&!matchMedia('(pointer: coarse)').matches?'#search':'[data-close-panel]')?.focus({preventScroll:true});
  }
  function setUiHidden(value,{persist=true,focus=true}={}){
    value=value===true;
    if(value&&!uiHidden&&!canHide()){message('Finish the current operation before hiding the interface.');return false;}
    if(value){closeMenu();hidePanels();if(getView()!=='gallery')setView('gallery');}
    uiHidden=value;document.body.dataset.uiHidden=String(value);stage.uiHidden=value;
    if(persist)try{localStorage.setItem('mte-ui-hidden',value?'1':'0');}catch{}
    stage.draw();if(focus)stage.canvas.focus({preventScroll:true});
    document.dispatchEvent(new CustomEvent('mte-ui-visibility-change',{detail:{hidden:value}}));
    return true;
  }
  toggle.onclick=()=>menu.classList.contains('is-open')?closeMenu(true):openMenu();
  document.querySelector('#library-toggle').onclick=()=>{if(canSelect())openPanel(library);};
  document.querySelector('#editor-toggle').onclick=()=>openPanel(inspector);
  hideButton.onclick=()=>setUiHidden(true);
  for(const button of document.querySelectorAll('[data-close-panel]'))button.onclick=()=>closePanels({watch:true});
  stage.canvas.addEventListener('contextmenu',event=>{event.preventDefault();openMenu(event.clientX,event.clientY,stage.canvas);});
  stage.canvas.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const rect=stage.canvas.getBoundingClientRect();openMenu(rect.left+rect.width/2,rect.top+rect.height/2,stage.canvas);}});
  stage.canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(stage.exportCropEditing)return;
    if(menu.classList.contains('is-open')||!library.hidden||!inspector.hidden){event.preventDefault();event.stopImmediatePropagation();closeMenu();closePanels({watch:true});}
  },true);
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&event.target!==toggle&&event.target!==stage.canvas)closeMenu();},true);
  menu.addEventListener('keydown',event=>{
    if(['Enter',' '].includes(event.key)){event.stopPropagation();return;}
    if(event.key==='Tab'){event.preventDefault();closeMenu(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const rows=items(),index=rows.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;rows[next]?.focus();
  });
  document.addEventListener('keydown',event=>{
    const typing=event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if(shortcut&&!event.defaultPrevented&&!event.isComposing&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!typing&&event.key?.toUpperCase()===shortcut){
      event.preventDefault();setUiHidden(!uiHidden);return;
    }
    if(event.key!=='Escape'||event.defaultPrevented)return;
    if(uiHidden){event.preventDefault();setUiHidden(false);return;}
    if(menu.classList.contains('is-open')){event.preventDefault();closeMenu(true);}
    else if(!library.hidden||!inspector.hidden){event.preventDefault();closePanels({watch:true});}
  });
  window.addEventListener('resize',()=>closeMenu());
  document.querySelector('#viewer-fit').onclick=()=>{document.querySelector('#fit').click();closeMenu();stage.canvas.focus({preventScroll:true});};
  document.querySelector('#pause').addEventListener('click',()=>{closeMenu();stage.canvas.focus({preventScroll:true});});
  const fullscreen=document.querySelector('#viewer-fullscreen');
  if(!document.documentElement.requestFullscreen)fullscreen.hidden=true;
  fullscreen.onclick=async()=>{closeMenu();try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{message('Full screen is not available in this browser.');}};
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
  menu.hidden=true;hidePanels();
  document.body.dataset.view=getView();
  setUiHidden(uiHiddenPreference(globalThis.location?.search||'',initialHidden),{persist:false,focus:false});
  return {
    get uiHidden(){return uiHidden;},
    setUiHidden,
    closeLibrary(){if(library.hidden)return;closePanels();if(getView()==='studio')openPanel(inspector);},
    showView(view){if(view==='gallery'){closeMenu();closePanels();}else openPanel(inspector);},
    setMode(view){if(view!=='gallery'&&uiHidden)setUiHidden(false,{focus:false});document.body.dataset.view=view;document.querySelector('#viewer-mode').textContent={gallery:'Gallery',studio:'Studio',export:'Export'}[view];document.querySelector('#inspector-title').textContent=view==='export'?'Export':'Scene';document.querySelector('#inspector-eyebrow').textContent=view==='export'?'Output':'Workspace';}
  };
}
