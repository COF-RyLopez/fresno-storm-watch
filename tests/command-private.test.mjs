import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCommandBriefing, createCommandPrivate, taskRows} from '../site/lib/command-private.js';
import {commandBriefingText} from '../site/lib/command-private-ui.js';
import {digest, emptyRecords} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';

const config = {enabled: true, environment: 'exercise'};
const session = {username: 'Operator', token: 'private-token'};
const now = Date.now();
const record = (collection, id, payload, {incident = 'storm', entity = id, supersedes = []} = {}) =>
  ({collection, id, incident, entity, supersedes, payload, created: now, author: 'Operator'});
const incident = id => record('incidents', id, {name: id, level: 'Duty Officer monitoring'}, {incident: id});
const period = record('periods', 'period', {label: 'Day 1', start: now - 1000, end: now + 1000, nextBriefing: now + 1000, objectives: 'Monitor'});
const task = {kind: 'Follow-up', title: 'Call partner', location: 'County', status: 'Open', owner: 'County', due: now - 1, nextReview: 'Tonight', evidence: 'Review notes'};
const seed = () => ({...emptyRecords(), incidents: [incident('storm'), incident('second')], periods: [period]});
const open = async (createStore = () => createExerciseStore(seed()), onChange) => {
  const controller = createCommandPrivate({config, createStore, onChange});
  await controller.connect(session);
  return controller;
};

test('legacy unclassified tasks stay visible and closeout includes outstanding work', () => {
  const tasks = [record('coordination', 'legacy', task), record('coordination', 'prepare', {...task, phase: 'prepare'}), record('coordination', 'recover', {...task, phase: 'recover', status: 'Complete'})];
  assert.deepEqual(taskRows(tasks, 'respond', now).map(r => r.record.id), ['legacy']);
  assert.deepEqual(taskRows(tasks, 'prepare', now).map(r => r.record.id), ['legacy', 'prepare']);
  assert.deepEqual(taskRows(tasks, 'recover', now).map(r => r.group), ['Overdue', 'Completed or canceled']);
  assert.deepEqual(taskRows(tasks, 'closeout', now).map(r => r.record.id), ['legacy', 'prepare']);
});

test('explicit incident and period selection, frozen figure and narrative in exact approved digest', async () => {
  const seen = [];
  const controller = await open(undefined, state => seen.push(state));
  assert.equal(controller.state.incidents.length, 2);
  assert.equal(controller.state.incident, null);
  assert.throws(() => controller.saveBriefing({title: 'Handoff'}), /period/i);
  await assert.rejects(controller.append('coordination', task), /incident/i);
  await controller.selectIncident('storm');
  assert.throws(() => controller.saveBriefing({title: 'Handoff'}), /period/i);
  controller.selectPeriod(period.id);
  const evidence = {title: 'Gauge profile', chart: {samples: [10, 11]}};
  const frozen = controller.capture(evidence);
  evidence.chart.samples[0] = 99;
  assert.throws(() => frozen.evidence.chart.samples.push(12), TypeError);
  const saved = await controller.saveBriefing({title: 'Handoff', narrative: 'Final wording'});
  assert.deepEqual(saved.payload.snapshot.notifications[0].evidence.chart.samples, [10, 11]);
  assert.equal(saved.payload.snapshot.narrative, 'Final wording');
  assert.equal(await digest(saved.payload.snapshot), saved.payload.digest);
  const edited = await controller.saveBriefing({title: 'Handoff', narrative: 'New wording'});
  assert.notEqual(edited.payload.digest, saved.payload.digest);
  const approval = await controller.approveBriefing(saved, 'Documented review');
  assert.equal(approval.payload.digest, saved.payload.digest);
  assert.equal(controller.state.records.briefings.find(r => r.id === saved.id).payload.snapshot.narrative, 'Final wording');
  assert.equal(JSON.stringify(seen).includes('private-token'), false);
});

test('briefing size limit throws without dropping evidence', async () => {
  await assert.rejects(buildCommandBriefing({title: 'Handoff', records: seed(), period, captures: [{id: 'large', evidence: {description: 'a'.repeat(60000)}}]}), /60,000-character/);
});

test('permissions and explicit conflict resolution apply before writing', async () => {
  const data = seed();
  const primary = record('coordination', 'primary', task);
  const correction = record('coordination', 'parallel', {...task, title: 'Parallel version'}, {entity: primary.entity});
  data.coordination.push(primary, correction);
  const store = createExerciseStore(data);
  store.allowed.delete('reports');
  const controller = await open(() => store);
  await controller.selectIncident('storm');
  await assert.rejects(controller.append('reports', {}), /editing group/);
  await assert.rejects(controller.append('coordination', task, {entity: primary.entity, supersedes: [primary.id]}), /every current version/);
  assert.equal(taskRows(controller.state.records)[0].group, 'Conflicting versions');
  const saved = await controller.append('coordination', task, {entity: primary.entity, supersedes: [primary.id, correction.id]});
  assert.deepEqual(taskRows(controller.state.records).map(r => r.record.id), [saved.id]);
  assert.equal(controller.state.records.coordination.length, 3);
});

test('out-of-order incident queries and disconnect discard stale records and evidence', async () => {
  const loaders = new Map();
  const store = createExerciseStore(seed());
  store.load = id => new Promise(resolve => loaders.set(id, resolve));
  const controller = await open(() => store);
  const first = controller.selectIncident('storm');
  const second = controller.selectIncident('second');
  loaders.get('second')({...emptyRecords(), incidents: [incident('second')]});
  await second;
  controller.capture({title: 'Second incident evidence'});
  loaders.get('storm')({...emptyRecords(), incidents: [incident('storm')]});
  await first;
  assert.equal(controller.state.records.incidents[0].incident, 'second');
  const third = controller.selectIncident('storm');
  assert.deepEqual(controller.state.captures, []);
  controller.disconnect();
  loaders.get('storm')({...emptyRecords(), incidents: [incident('storm')]});
  await third;
  assert.equal(controller.state.username, null);
  assert.deepEqual(controller.state.incidents, []);
  assert.deepEqual(controller.state.records, emptyRecords());
});

test('an ambiguous append retries with the original event id', async () => {
  const store = createExerciseStore(seed());
  const append = store.append;
  const calls = [];
  store.append = async (...args) => {
    calls.push(args[0].id);
    if (calls.length === 1) throw Error('Receipt was unavailable');
    return append(...args);
  };
  const controller = await open(() => store);
  await controller.selectIncident('storm');
  await assert.rejects(controller.append('coordination', task), /Receipt/);
  await controller.append('coordination', task);
  assert.equal(calls[0], calls[1]);
  assert.equal(controller.state.records.coordination.length, 1);
});

test('printable evidence identifies the frozen figure units, timestamps and qualification', async () => {
  const controller = await open();
  await controller.selectIncident('storm');
  controller.selectPeriod(period.id);
  controller.capture({title: 'Gauge snapshot', quality: 'Provisional publisher readings', association: 'Nearby; impact not established',
    evidence: [{label: 'Stage', units: 'ft', value: 5, time: now, source: 'USGS', quality: 'Provisional', points: [{time: now, value: 4.9}]}]});
  const saved = await controller.saveBriefing({title: 'Shift briefing', narrative: 'Review the crossing.'});
  const text = commandBriefingText(saved);
  assert.match(text, /Review the crossing\./);
  assert.match(text, /Stage — 5 ft/);
  assert.match(text, /Source USGS\nSource time/);
  assert.match(text, /Provisional/);
  assert.match(text, /Nearby; impact not established/);
  assert.match(text, /Observed samples · 1 saved · 4\.9 to 4\.9 ft/);
  assert.doesNotMatch(text, /"points":/);
});

test('saved handoff includes current operational records, exact conflicts and no other incident data', async () => {
  const data = seed();
  const current = record('coordination', 'a', task);
  data.coordination.push(current,
    record('coordination', 'b', {...task, title: 'Confirm alternate route', owner: 'Roads'}, {entity: current.entity}),
    record('coordination', 'c', {...task, title: 'Other incident task'}, {incident: 'second'}));
  data.checklists.push(record('checklists', 'd', {check: 'Communications', status: 'Blocked', owner: 'Dispatch', evidence: 'Radio check pending'}));
  data.staging.push(record('staging', 'e', {location: 'North yard', status: 'Unconfirmed', owner: 'Facilities', evidence: 'Gate access needs review'}));
  const controller = await open(() => createExerciseStore(data));
  await controller.selectIncident('storm');
  controller.selectPeriod(period.id);
  const saved = await controller.saveBriefing({title: 'Shift handoff', narrative: 'Review the current issues.'});
  assert.equal(saved.payload.snapshot.records.coordination.length, 2);
  const text = commandBriefingText(saved);
  assert.match(text, /Conflicting current version · Call partner · County · Follow-up · Open · Owner County · Due/);
  assert.match(text, /Confirm alternate route · County · Follow-up · Open · Owner Roads · Due/);
  assert.match(text, /Communications · Blocked · Owner Dispatch · Radio check pending/);
  assert.match(text, /North yard · Unconfirmed · Owner Facilities · Gate access needs review/);
  assert.doesNotMatch(text, /Other incident task|second/);
  await controller.append('coordination', {...task, status: 'Complete'}, {entity: current.entity, supersedes: ['a', 'b']});
  assert.equal(commandBriefingText(saved), text);
  assert.equal(await digest(saved.payload.snapshot), saved.payload.digest);
});
