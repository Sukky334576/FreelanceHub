'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/theme.js'), 'utf8');
function setup({saved=null, dark=false, blockedStorage=false}={}) {
  const storage=new Map(saved===null?[]:[['freelancehub_theme',saved]]), listeners={}, attrs={};
  const root={dataset:{},style:{}};
  function button(option) {
    return {dataset:{themeOption:option},attrs:{},icon:{},setAttribute(k,v){this.attrs[k]=v;},
      querySelector(){return this.icon;},addEventListener(name,fn){this[name]=fn;}};
  }
  const toggle=button(), options=['light','dark','system'].map(button);
  const media={matches:dark,addEventListener(name,fn){this.change=fn;}};
  const window={matchMedia:()=>media,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent(){}};
  const document={documentElement:root,querySelector:()=>({setAttribute:(k,v)=>attrs[k]=v}),
    querySelectorAll:selector=>selector==='[data-theme-toggle]'?[toggle]:options,
    addEventListener:(name,fn)=>listeners[name]=fn};
  const context=vm.createContext({window,document,CustomEvent:function(type,detail){this.type=type;this.detail=detail;},
    localStorage:{getItem:k=>{if(blockedStorage)throw new Error('blocked');return storage.get(k)||null;},
      setItem:(k,v)=>{if(blockedStorage)throw new Error('blocked');storage.set(k,v);}}});
  vm.runInContext(source,context);
  return {root,attrs,storage,toggle,options,media,listeners,ready:()=>listeners.DOMContentLoaded()};
}
function test(name,fn){fn();console.log('PASS: '+name);}
test('saved choice applies before DOMContentLoaded, including native controls and browser chrome',()=>{
  const t=setup({saved:'dark',dark:false});
  assert.equal(t.root.dataset.theme,'dark');assert.equal(t.root.style.colorScheme,'dark');assert.equal(t.attrs.content,'#121212');
  t.ready();assert.equal(t.options[1].attrs['aria-pressed'],'true');assert.match(t.toggle.attrs['aria-label'],/สว่าง/);
});
test('system theme follows OS changes, while explicit choice is not overwritten',()=>{
  const t=setup();t.ready();t.media.matches=true;t.media.change();assert.equal(t.root.dataset.theme,'dark');
  t.options[0].click();t.media.change();assert.equal(t.root.dataset.theme,'light');
  t.options[2].click();assert.equal(t.root.dataset.theme,'dark');assert.equal(t.storage.get('freelancehub_theme'),'system');
});
test('toggle persists choice across reloads and updates accessible action labels',()=>{
  const t=setup();t.ready();t.toggle.click();
  assert.equal(t.storage.get('freelancehub_theme'),'dark');assert.match(t.toggle.attrs['aria-label'],/สว่าง/);
  const reloaded=setup({saved:t.storage.get('freelancehub_theme')});assert.equal(reloaded.root.dataset.theme,'dark');
  t.toggle.click();assert.equal(t.root.dataset.theme,'light');assert.equal(t.attrs.content,'#164F57');
});
test('storage changes sync theme across tabs without reacting to unrelated financial cache keys',()=>{
  const t=setup();t.ready();t.listeners.storage({key:'freelancehub_theme',newValue:'dark'});
  assert.equal(t.root.dataset.theme,'dark');t.listeners.storage({key:'wallets',newValue:'light'});assert.equal(t.root.dataset.theme,'dark');
  t.listeners.storage({key:null,newValue:null});assert.equal(t.root.dataset.theme,'light');assert.equal(t.options[2].attrs['aria-pressed'],'true');
});
test('invalid preferences and unavailable storage still allow switching',()=>{
  const invalid=setup({saved:'unexpected',dark:true});assert.equal(invalid.root.dataset.theme,'dark');
  const t=setup({blockedStorage:true});t.ready();t.toggle.click();assert.equal(t.root.dataset.theme,'dark');
});
