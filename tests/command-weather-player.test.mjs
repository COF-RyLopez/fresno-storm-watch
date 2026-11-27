import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../site/lib/command-weather-player.js';
import * as model from '../site/lib/command-model.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(overrides={}) {
  const draws=[],states=[],timers=new Map(),loads=[];let serial=0;
  const player=module.createForecastPlayback({frames:[10,20,30],load:async(frame)=>{loads.push(frame);return frame*2;},
    render:(value,frame)=>draws.push([value,frame]),changed:state=>states.push(state),available:()=>true,
    schedule:fn=>{timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id),...overrides});
  return {player,draws,states,loads,timers,async next(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}};
}
test('autoplay buffers the next frame before advancing and stops at the final published time',async()=>{
  const h=harness();await h.player.select(0);await h.player.play({automatic:true});
  assert.deepEqual(h.draws,[[20,10]]);assert.deepEqual(h.loads,[10,20]);
  assert.equal(h.player.playing,true);await h.next();assert.deepEqual(h.draws.at(-1),[40,20]);
  await h.next();assert.deepEqual(h.draws.at(-1),[60,30]);assert.equal(h.player.playing,false);assert.equal(h.timers.size,0);
});
test('reduced motion blocks automatic playback but permits a deliberate Play',async()=>{
  const h=harness({reducedMotion:()=>true});await h.player.select(0);await h.player.play({automatic:true});
  assert.equal(h.player.playing,false);assert.equal(h.timers.size,0);
  await h.player.play();assert.equal(h.player.playing,true);h.player.destroy();
});
test('destroying during a delayed frame never renders it and releases pending work',async()=>{
  let resolve,signal;const h=harness({load:(_frame,s)=>{signal=s;return new Promise(done=>resolve=done);}});
  const task=h.player.select(0);await tick();h.player.destroy();resolve(99);await task;
  assert.equal(signal.aborted,true);assert.equal(h.draws.length,0);assert.equal(h.timers.size,0);
});
test('missing buffered frames stop the sequence without clearing the current evidence',async()=>{
  const h=harness({load:async frame=>{if(frame===20)throw Error('frame unavailable');return frame;}});
  await h.player.select(0);await h.player.play({automatic:true});assert.equal(h.player.playing,false);
  assert.deepEqual(h.draws,[[10,10]]);assert.equal(h.states.at(-1).status,'error');assert.equal(h.timers.size,0);
});
test('hidden views stop playback and a later refresh does not restart it',async()=>{
  let visible=true;const h=harness({available:()=>visible});await h.player.select(0);await h.player.play();visible=false;
  await h.next();assert.equal(h.player.playing,false);visible=true;assert.equal(h.timers.size,0);
  const single=harness({frames:[10]});await single.player.select(0);await single.player.play();assert.equal(single.player.playing,false);
});

test('the selectable forecast sequence excludes elapsed and nonoverlapping times',()=>{
  assert.equal(typeof model.advisoryForecastFrames,'function');
  const windows=[{start:80,end:100},{start:100,end:160},{start:160,end:160},{start:200,end:240}];
  assert.deepEqual(model.advisoryForecastFrames(windows,{start:110,end:200},120),[windows[1],windows[2]]);
});

test('an already queued old timer cannot pause a newly started replay',async()=>{
  const h=harness();await h.player.select(0);await h.player.play();
  const oldTimer=[...h.timers.values()][0];h.player.pause();await h.player.play();
  await oldTimer();assert.equal(h.player.playing,true);assert.equal(h.timers.size,1);
  h.player.destroy();
});

test('every cached presentation is revalidated; a changed source cannot be replayed',async()=>{
  let current=true,checks=0;
  const h=harness({validate:async()=>{checks++;if(!current)throw Error('revision changed');}});
  await h.player.select(0);current=false;
  assert.equal(await h.player.select(0),false);
  assert.equal(checks,2);assert.deepEqual(h.loads,[10]);assert.equal(h.draws.length,1);
  assert.equal(h.states.at(-1).status,'error');h.player.destroy();
});

test('superseded async validation cannot paint over a newer selection',async()=>{
  let release;
  const h=harness({validate:async(_value,frame)=>{if(frame===10)await new Promise(done=>release=done);}});
  const old=h.player.select(0);await tick();await h.player.select(1);release();await old;
  assert.deepEqual(h.draws,[[40,20]]);h.player.destroy();
});

test('frame timing waits for map presentation before reporting the displayed index',async()=>{
 let release;const h=harness({render:()=>new Promise(done=>release=done)});
 const showing=h.player.select(0);await tick();
 assert.equal(h.states.at(-1).index,-1);release();assert.equal(await showing,true);
 assert.equal(h.states.at(-1).index,0);h.player.destroy();
});

test('next-frame preparation and the dwell clock run together',async()=>{
 let release;const h=harness({load:frame=>frame===20?new Promise(done=>release=done):Promise.resolve(frame)});
 await h.player.select(0);const starting=h.player.play();await tick();
 assert.equal(h.timers.size,1,'dwell starts without waiting for the next download');
 release(20);await starting;h.player.destroy();
});

test('overview can be inspected but is excluded from comparable-period playback',async()=>{
 const h=harness({firstPlayable:1});await h.player.select(0);await h.player.play();
 assert.deepEqual(h.draws,[[20,10],[40,20]]);await h.next();assert.deepEqual(h.draws.at(-1),[60,30]);
 assert.equal(h.player.playing,false);h.player.destroy();
});
