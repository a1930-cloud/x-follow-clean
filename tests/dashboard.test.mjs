import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const html=await readFile(new URL('../dashboard.html',import.meta.url),'utf8');
test('existing collected data renders selection and confirmation without initiating any action',async()=>{
 const {document}=parseHTML(html);
 // linkedom does not implement selected option defaults or native dialogs.
 for(const [id,value]of [['relationship','unknown'],['review','all']])Object.defineProperty(document.getElementById(id),'value',{value,writable:true});
 let shown=false,permissionCalls=0,messages=0;
 document.getElementById('unfollowConfirm').showModal=()=>shown=true;
 const dataset={owner:'me',createdAt:1,following:{target:{handle:'target',name:'Target'},kept:{handle:'kept',name:'Kept'}},followers:{},review:{kept:'keep'},expected:{},notes:{}};
 const context=vm.createContext({document,window:{addEventListener:()=>{}},URL,Blob,crypto:{randomUUID:()=> 'test-controller'},setTimeout,clearTimeout,setInterval,clearInterval,chrome:{storage:{local:{get:async()=>({dataset})},onChanged:{addListener:()=>{}}},runtime:{sendMessage:async()=>{messages++;return {ok:true};}},permissions:{request:async()=>{permissionCalls++;return true;}}}});
 for(const file of ['core.js','unfollow-core.js','unfollow-actions.js','dashboard.js','unfollow-ui.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(document.getElementById('unfollowDelay').getAttribute('min'),'5');
 assert.equal(document.getElementById('unfollowDelay').getAttribute('value'),'5');
 assert.equal(document.querySelectorAll('#rows tr').length,2);
 document.getElementById('selectFiltered').click();
 assert.equal(document.getElementById('selectionCount').textContent,'已选 1 人');
 document.getElementById('previewUnfollow').click();
 assert.equal(shown,true);assert.equal(document.querySelector('#confirmHandles').textContent,'@target');
 assert.equal(document.getElementById('startUnfollow').disabled,true);
 assert.equal(messages,0);assert.equal(permissionCalls,0);
});
