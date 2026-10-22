import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adjustmentTotal} from '../client/src/adjustment.js';
test('expense preview uses cents and handles empty/invalid/negative results',()=>{
  assert.equal(adjustmentTotal(0.1,'0.2','add'),0.3);
  assert.equal(adjustmentTotal(100,'25.25','subtract'),74.75);
  assert.equal(adjustmentTotal(10,'10','subtract'),0);
  assert.equal(adjustmentTotal(10,'11','subtract'),-1);
  for(const value of ['',-1,0,'oops',0.001])assert.equal(adjustmentTotal(10,value,'add'),null);
});
