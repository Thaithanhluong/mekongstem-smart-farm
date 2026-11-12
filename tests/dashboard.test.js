'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const Config = require('../farm-config.js');

function configured(username = 'farm_A') {
  return Config.normalize({ ...Config.defaults(), username, configured: true });
}

test('OhStem topics use username; explicit full topics preserve case and allow raw channels', () => {
  const config = configured();
  assert.equal(Config.topics(config, 'temperature')[0], 'farm_A/feeds/V1');
  config.bindings.temperature = { kind: 'topic', value: 'Other/Feed/Temp', aliases: [] };
  assert.equal(Config.routes(config, true).get('Other/Feed/Temp'), 'temperature');
  assert.equal(Config.routes(config, true).get('other/feed/temp'), undefined);
  config.bindings.temperature.value = 'V1';
  assert.equal(Config.topics(config, 'temperature')[0], 'V1');
  assert.equal(Config.routes(config, true).has('farm_A/feeds/V1'), false);
});

test('validation detects collisions between full topics, channels and aliases, including inactive bindings', () => {
  const config = configured();
  config.bindings.humidity = { kind: 'topic', value: 'farm_A/feeds/V1', aliases: [] };
  assert.ok(Config.validate(config)['bindings.humidity.0']);
  config.bindings.humidity.value = 'farm_A/feeds/V2';
  config.bindings.lightOn.aliases.push({ kind: 'channel', value: 'V1' });
  assert.ok(Config.validate(config)['bindings.lightOn.1']);
  config.bindings.lightOn.aliases = [];
  config.bindings.clock.value = 'V1';
  assert.ok(Config.validate(config)['bindings.clock.0']);
});

test('validation rejects malformed URLs, wildcard/NUL topics, channel paths, empty bindings and invalid commands', () => {
  for (const url of ['mqtt://host:1883', 'http://host', 'wss://', 'wss://user:pass@host/mqtt', 'wss://host/mqtt#fragment']) {
    assert.ok(Config.validate({ ...configured(), url }).url, url);
  }
  for (const value of ['', 'V#', 'V+', 'V\0', 'foo/bar', 'V 1']) {
    const config = configured();
    config.bindings.temperature.value = value;
    assert.ok(Config.validate(config)['bindings.temperature.0'], value);
  }
  const config = configured();
  config.bindings.pump.on = config.bindings.pump.off;
  assert.ok(Config.validate(config)['payload.pump']);
  assert.ok(Config.validate({ ...configured(), username: '' }).username);
  assert.deepEqual(Config.validate(Config.defaults()), {});
});

test('custom broker supports an empty base; numeric and device parsers reject unrelated traffic', () => {
  const config = Config.normalize({ ...configured(), provider: 'custom', baseTopic: '' });
  assert.equal(Config.topics(config, 'temperature')[0], 'V1');
  assert.deepEqual(Config.validate(config), {});
  config.bindings.pump.on = 'ON'; config.bindings.pump.off = 'OFF';
  assert.equal(Config.parseDevice(config, 'pump', 'ON'), true);
  assert.equal(Config.parseDevice(config, 'pump', 'OFF'), false);
  assert.equal(Config.parseDevice(config, 'pump', '1'), null);
  assert.equal(Config.parseNumber('30,5'), 30.5);
  for (const value of ['Hello', '30 garbage', '', '1.2.3', 'Infinity', '{}']) assert.ok(Number.isNaN(Config.parseNumber(value)));
});

test('fresh defaults do not connect to a personal farm; migration preserves connection and explicit V11 alias', () => {
  const fresh = Config.defaults();
  assert.equal(fresh.configured, false);
  assert.equal(fresh.username, '');
  assert.deepEqual(fresh.features, { heartbeat: false, sync: false, irrigation: false });
  assert.equal(Config.topics(fresh, 'lightOn').length, 1);
  const migrated = Config.migrate({ config: { url: fresh.url, username: 'old_farm', password: 'secret', baseTopic: 'old_farm/feeds' } });
  assert.equal(migrated.configured, true);
  assert.equal(migrated.password, 'secret');
  assert.equal(migrated.provider, 'ohstem');
  assert.deepEqual(Config.topics(migrated, 'lightOn'), ['old_farm/feeds/V12', 'old_farm/feeds/V11']);
  assert.ok(Object.values(migrated.features).every(Boolean));
  assert.deepEqual(Config.validate(migrated), {});
});

function dashboard(initial = configured(), legacy = null) {
  const data = new Map();
  if (initial) data.set('mekongstem.smart-farm.dashboard.v2', JSON.stringify({ config: initial }));
  if (legacy) data.set('mekongstem.smart-farm.dashboard.v1', JSON.stringify(legacy));
  const clients = [];
  const timers = new Map();
  let timerId = 0;
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: true, dataset: {}, classList: { toggle() {}, remove() {} }, setAttribute() {} });
    return nodes.get(id);
  };
  class Client extends EventEmitter {
    connected = true;
    publications = [];
    subscribe(topics, options, callback) { this.topics = topics; this.subscribed = callback; }
    publish(topic, message, options, callback) { this.publications.push({ topic, message, options, callback }); }
    end() { this.connected = false; this.emit('close'); }
  }
  const localStorage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const context = vm.createContext({
    window: { SmartFarmConfig: Config, localStorage, setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id), setInterval: (fn) => { timers.set(++timerId, fn); return timerId; }, clearInterval: (id) => timers.delete(id) },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: node },
    mqtt: { connect: () => { const client = new Client(); clients.push(client); return client; } },
    location: { protocol: 'http:' }, console,
  });
  // Inspect the real dashboard closure without adding a production testing API.
  let source = fs.readFileSync(path.join(__dirname, '../scripts.js'), 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, `globalThis.app = { connectMqtt, reconnectMqtt, disconnectMqtt, publishChannel, setDevice, setIotMode, handleMqttMessage, persistState, checkMqttConnectionHealth,
    get state() { return state; }, get connected() { return mqttConnected; }, get queue() { return pendingMessages; }, get subscribed() { return mqttSubscribed; }, get webPumpOn() { return webPumpOn; }, get online() { return smartFarmConnected; }
  }; })();`);
  vm.runInContext(source, context);
  const connect = () => {
    context.app.connectMqtt();
    const client = clients.at(-1);
    client.emit('connect');
    client.subscribed(null, client.topics.map((topic) => ({ topic, qos: 0 })));
    return client;
  };
  return { app: context.app, clients, connect, data, node, localStorage, timers };
}

test('new dashboard waits for setup and preserves legacy settings/camera/thresholds', () => {
  const fresh = dashboard(null);
  fresh.app.connectMqtt();
  assert.equal(fresh.clients.length, 0);
  assert.equal(fresh.app.state.cameraUrl, '');
  const legacy = { config: { url: Config.defaults().url, username: 'legacy', baseTopic: 'legacy/feeds', password: '' }, cameraUrl: 'http://camera/stream', thresholds: { soilDry: 37 } };
  const migrated = dashboard(null, legacy);
  assert.equal(migrated.app.state.cameraUrl, legacy.cameraUrl);
  assert.equal(migrated.app.state.thresholds.soilDry, 37);
  assert.equal(migrated.app.state.config.features.irrigation, true);
  assert.equal(migrated.data.get('mekongstem.smart-farm.dashboard.v1'), JSON.stringify(legacy));
});

test('all configured bindings route by complete topic and incoming commands never echo publications', () => {
  const config = configured();
  config.features = { heartbeat: true, sync: true, irrigation: true };
  config.bindings.pump.on = 'RUN'; config.bindings.pump.off = 'STOP';
  const { app, connect } = dashboard(config);
  const client = connect();
  assert.equal(client.topics.includes('V1'), false);
  assert.equal(client.topics.includes('farm_A/feeds/V18'), false); // transmit-only
  client.publications.length = 0;
  for (const [key, meta] of Object.entries(Config.REGISTRY)) {
    const topic = Config.topics(config, key)[0];
    if (meta.sensor) {
      client.emit('message', topic, Buffer.from('42'));
      assert.equal(app.state.sensors[meta.sensor], 42);
    } else if (meta.type === 'device') {
      client.emit('message', topic, Buffer.from(config.bindings[key].on));
      assert.equal(app.state.controls[key], true);
    } else if (meta.type === 'threshold') {
      const value = { lightOn: 20, lightOff: 80, soilDry: 40, pumpDuration: 4, fanOn: 35, fanOff: 25 }[key];
      client.emit('message', topic, Buffer.from(String(value)));
      assert.equal(app.state.thresholds[key], value);
    }
  }
  assert.equal(client.publications.length, 0);
  assert.equal(app.webPumpOn, false); // receiving ON alone does not claim ownership
  const previous = app.state.sensors.temperature;
  for (const topic of ['farm_B/feeds/V1', 'V1', 'farm_A/feeds/v1']) client.emit('message', topic, Buffer.from('99'));
  client.emit('message', 'farm_A/feeds/V1', Buffer.from('Hello'));
  assert.equal(app.state.sensors.temperature, previous);
  app.setDevice('pump', true, { source: 'user' });
  assert.equal(client.publications.at(-1).message, 'RUN');
});

test('two users on the same channel do not consume each other\'s traffic', () => {
  const a = dashboard(configured('alice')), b = dashboard(configured('bob'));
  const ca = a.connect(), cb = b.connect();
  for (const client of [ca, cb]) client.emit('message', 'alice/feeds/V1', Buffer.from('25'));
  assert.equal(a.app.state.sensors.temperature, 25);
  assert.equal(b.app.state.sensors.temperature, null);
});

test('basic Scratch has no automatic heartbeat, clock or sync; advanced features send only configured topics', () => {
  const basic = dashboard();
  const client = basic.connect();
  assert.equal(client.publications.length, 0);
  assert.equal(client.topics.includes('farm_A/feeds/V10'), false);
  client.emit('message', 'farm_A/feeds/V6', Buffer.from('1'));
  assert.equal(basic.app.online, false); // device echo must not mark board online
  const config = configured();
  config.features = { heartbeat: true, sync: true, irrigation: true };
  config.bindings.presence = { kind: 'topic', value: 'custom/PRESENCE', aliases: [] };
  config.bindings.clock = { kind: 'topic', value: 'custom/CLOCK', aliases: [] };
  const advanced = dashboard(config).connect();
  assert.ok(advanced.publications.some((p) => p.topic === 'custom/PRESENCE' && p.message === 'ARE U HERE'));
  assert.ok(advanced.publications.some((p) => p.topic === 'custom/PRESENCE' && p.message === 'SYNC_REQUEST'));
  assert.ok(advanced.publications.some((p) => p.topic === 'custom/CLOCK'));
  assert.equal(advanced.publications.some((p) => p.topic === 'V10'), false);
});

test('queued commands flush only after subscribe; changing connection discards old queue and late callbacks', () => {
  const h = dashboard();
  h.app.connectMqtt();
  const old = h.clients[0];
  old.emit('connect');
  h.app.publishChannel('light', '1');
  assert.equal(old.publications.length, 0);
  old.subscribed(null, []);
  assert.equal(old.publications.length, 1);
  old.emit('close');
  h.app.publishChannel('pump', '1');
  assert.equal(h.app.queue.length, 1);
  h.app.state.config.username = 'farm_B';
  h.app.reconnectMqtt();
  const current = h.clients[1];
  old.emit('connect'); old.emit('close'); old.emit('error', new Error('stale'));
  old.subscribed(null, []);
  current.emit('connect'); current.subscribed(null, []);
  assert.equal(h.app.connected, true);
  assert.equal(h.app.queue.length, 0);
  assert.equal(current.publications.length, 0);
  old.emit('message', 'farm_B/feeds/V1', Buffer.from('99'));
  assert.equal(h.app.state.sensors.temperature, null);
});

test('storage failures report failure instead of claiming success', () => {
  const h = dashboard();
  h.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(h.app.persistState(h.app.state), false);
  assert.equal(h.node('settingsNotice').hidden, false);
});

test('explicit compatibility aliases publish and subscribe only the configured topics', () => {
  const config = configured();
  config.bindings.lightOn.aliases.push({ kind: 'topic', value: 'legacy/LightThreshold' });
  const h = dashboard(config), client = h.connect();
  h.app.publishChannel('lightOn', 35);
  assert.deepEqual(client.publications.map((p) => p.topic), ['farm_A/feeds/V12', 'legacy/LightThreshold']);
  assert.ok(client.topics.includes('legacy/LightThreshold'));
  client.emit('message', 'legacy/LightThreshold', Buffer.from('40'));
  assert.equal(h.app.state.thresholds.lightOn, 40);
  assert.equal(client.publications.length, 2);
});

test('stale subscribe callbacks on a reconnecting transport cannot restart heartbeat or flush commands', () => {
  const h = dashboard();
  h.app.connectMqtt();
  const client = h.clients[0];
  client.emit('connect');
  const oldSubscribe = client.subscribed;
  client.emit('close');
  oldSubscribe(null, []);
  assert.equal(h.app.subscribed, false);
  client.emit('connect');
  h.app.publishChannel('light', '1');
  oldSubscribe(null, []);
  assert.equal(client.publications.length, 0);
  client.subscribed(null, []);
  assert.equal(client.publications.length, 1);
});

test('pump route lock is held until STOP is actually published; manual reconnect preserves pending STOP', () => {
  const h = dashboard(), client = h.connect();
  h.app.setDevice('pump', true, { source: 'user' });
  assert.equal(h.app.webPumpOn, true);
  client.emit('close');
  h.app.setDevice('pump', false, { source: 'user' });
  assert.equal(h.app.webPumpOn, true);
  h.app.reconnectMqtt();
  const current = h.clients[1];
  current.emit('connect'); current.subscribed(null, []);
  assert.equal(current.publications.at(-1).message, '0');
  assert.equal(h.app.webPumpOn, true);
  current.publications.at(-1).callback(null);
  assert.equal(h.app.webPumpOn, false);
});

test('irrigation status validation rejects malformed arrays and accepts the existing firmware protocol', () => {
  const valid = { mode: 'schedule', days: [0, 1], slots: [{ time: '08:00', seconds: 5 }] };
  assert.equal(Config.validIrrigation(valid), true);
  for (const config of [null, { ...valid, slots: [null] }, { ...valid, days: [8] }, { ...valid, days: [0, 0] },
    { ...valid, slots: [{ time: '25:00', seconds: 5 }] }, { ...valid, slots: [{ time: '08:00', seconds: 0 }] }]) {
    assert.equal(Config.validIrrigation(config), false);
  }
});
