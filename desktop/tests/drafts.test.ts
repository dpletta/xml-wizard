import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/lib/core.ts';
import { useStore } from '../src/lib/store.ts';
import { autosave } from '../src/lib/session.ts';

test('unavailable browser storage reports failure and keeps the editable project intact', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){throw new Error('Quota exceeded');}}});
  try {
    const p=C.sampleProject(); useStore.getState().open(p,null,'design');
    useStore.getState().mutate((p)=>{p.title='Unsaved example';});
    const before=JSON.stringify(p);
    assert.equal(await autosave(),false);
    assert.equal(useStore.getState().draftStatus,'error');
    assert.equal(JSON.stringify(useStore.getState().project),before);
    assert.match(useStore.getState().toast!.text,/could not be saved/);
    assert.equal(useStore.getState().dirty,true);
  } finally {
    if(descriptor) Object.defineProperty(globalThis,'indexedDB',descriptor);
    else Reflect.deleteProperty(globalThis,'indexedDB');
  }
});
