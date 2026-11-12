(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmartFarmConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Protocol defaults only. Runtime routing always resolves the user's bindings.
  const REGISTRY = {
    temperature: { label: 'Nhiệt độ', channel: 'V1', direction: 'rx', type: 'number', sensor: 'temperature' },
    humidity: { label: 'Độ ẩm không khí', channel: 'V2', direction: 'rx', type: 'number', sensor: 'humidity' },
    soilOne: { label: 'Đất khu A', channel: 'V3', direction: 'rx', type: 'number', sensor: 'soilOne' },
    soilTwo: { label: 'Đất khu B', channel: 'V4', direction: 'rx', type: 'number', sensor: 'soilTwo' },
    lightSensor: { label: 'Cảm biến ánh sáng', channel: 'V5', direction: 'rx', type: 'number', sensor: 'light' },
    light: { label: 'Đèn trồng cây', channel: 'V6', direction: 'both', type: 'device' },
    pump: { label: 'Bơm tưới nước', channel: 'V7', direction: 'both', type: 'device' },
    fan: { label: 'Quạt điều hòa', channel: 'V8', direction: 'both', type: 'device' },
    mode: { label: 'Chế độ (0: tự động, 1: thủ công)', channel: 'V9', direction: 'both', type: 'mode' },
    presence: { label: 'Kiểm tra kết nối / đồng bộ', channel: 'V10', direction: 'both', type: 'presence' },
    lightOn: { label: 'Ngưỡng bật đèn', channel: 'V12', direction: 'both', type: 'threshold' },
    lightOff: { label: 'Ngưỡng tắt đèn', channel: 'V13', direction: 'both', type: 'threshold' },
    soilDry: { label: 'Ngưỡng đất khô', channel: 'V14', direction: 'both', type: 'threshold' },
    pumpDuration: { label: 'Thời gian tưới', channel: 'V15', direction: 'both', type: 'threshold' },
    fanOn: { label: 'Ngưỡng bật quạt', channel: 'V16', direction: 'both', type: 'threshold' },
    fanOff: { label: 'Ngưỡng tắt quạt', channel: 'V17', direction: 'both', type: 'threshold' },
    irrigation: { label: 'Gửi cấu hình tưới', channel: 'V18', direction: 'tx', type: 'json', feature: 'irrigation' },
    irrigationStatus: { label: 'Phản hồi ESP32', channel: 'V19', direction: 'rx', type: 'json', feature: 'irrigation' },
    clock: { label: 'Đồng bộ giờ UTC', channel: 'V20', direction: 'tx', type: 'number', feature: 'irrigation' },
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalizeBase = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '');

  function defaults() {
    return {
      version: 2, provider: 'ohstem', configured: false,
      url: 'wss://mqtt.ohstem.vn:8084/mqtt', username: '', password: '', baseTopic: '',
      features: { heartbeat: false, sync: false, irrigation: false },
      bindings: Object.fromEntries(Object.entries(REGISTRY).map(([key, meta]) => [key, {
        kind: 'channel', value: meta.channel, aliases: [],
        ...(meta.type === 'device' ? { on: '1', off: '0' } : {}),
      }])),
    };
  }

  function normalize(config) {
    const result = defaults();
    if (!config || typeof config !== 'object') return result;
    result.provider = config.provider === 'custom' ? 'custom' : 'ohstem';
    result.configured = config.configured === true;
    for (const key of ['url', 'username', 'password', 'baseTopic']) {
      if (typeof config[key] === 'string') result[key] = key === 'password' ? config[key] : config[key].trim();
    }
    result.baseTopic = result.provider === 'ohstem'
      ? (result.username ? `${result.username}/feeds` : '') : normalizeBase(result.baseTopic);
    for (const key of Object.keys(result.features)) result.features[key] = config.features?.[key] === true;
    for (const key of Object.keys(REGISTRY)) {
      const binding = config.bindings?.[key];
      if (!binding || typeof binding !== 'object') continue;
      result.bindings[key] = {
        kind: binding.kind === 'topic' ? 'topic' : 'channel',
        value: typeof binding.value === 'string' ? binding.value.trim() : '',
        aliases: Array.isArray(binding.aliases) ? binding.aliases.map((ref) => ({
          kind: ref?.kind === 'topic' ? 'topic' : 'channel',
          value: typeof ref?.value === 'string' ? ref.value.trim() : '',
        })) : [],
      };
      if (REGISTRY[key].type === 'device') {
        result.bindings[key].on = typeof binding.on === 'string' ? binding.on.trim() : '1';
        result.bindings[key].off = typeof binding.off === 'string' ? binding.off.trim() : '0';
      }
    }
    return result;
  }

  function migrate(legacy) {
    const config = defaults();
    const old = legacy?.config || {};
    for (const key of ['url', 'username', 'password', 'baseTopic']) {
      if (typeof old[key] === 'string') config[key] = old[key];
    }
    config.provider = config.url === defaults().url && normalizeBase(config.baseTopic) === `${config.username}/feeds`
      ? 'ohstem' : 'custom';
    config.configured = Boolean(old.url);
    config.features = { heartbeat: true, sync: true, irrigation: true };
    config.bindings.lightOn.aliases = [{ kind: 'channel', value: 'V11' }];
    return normalize(config);
  }

  function baseTopic(config) {
    return config.provider === 'ohstem' ? (config.username ? `${config.username}/feeds` : '') : normalizeBase(config.baseTopic);
  }

  function resolve(config, ref) {
    const value = String(ref?.value || '').trim();
    if (ref?.kind === 'topic') return value;
    const base = baseTopic(config);
    return base ? `${base}/${value}` : value;
  }

  function topics(config, key) {
    const binding = config.bindings[key];
    return [...new Set([binding, ...(binding.aliases || [])].map((ref) => resolve(config, ref)))];
  }

  function active(config, key) {
    if (key === 'presence') return config.features.heartbeat || config.features.sync;
    return !REGISTRY[key].feature || config.features[REGISTRY[key].feature];
  }

  function routes(config, receiveOnly = false) {
    const map = new Map();
    for (const [key, meta] of Object.entries(REGISTRY)) {
      if (!active(config, key) || (receiveOnly && meta.direction === 'tx')) continue;
      topics(config, key).forEach((topic) => map.set(topic, key));
    }
    return map;
  }

  function validate(config, requireConnection = config.configured) {
    const errors = {};
    try {
      const url = new URL(config.url);
      if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.hash || url.username || url.password) throw new Error();
      if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol === 'ws:') {
        errors.url = 'Trang HTTPS cần broker wss://.';
      }
    } catch { errors.url = 'Nhập URL WebSocket ws:// hoặc wss:// hợp lệ.'; }
    if (config.provider === 'ohstem' && requireConnection && !config.username.trim()) errors.username = 'Nhập username giống khối kết nối OhStem.';
    if (config.provider === 'ohstem' && /[\s/+#\u0000]/.test(config.username)) errors.username = 'Username không chứa khoảng trắng, /, + hoặc #.';
    if (/[+#\u0000]/.test(baseTopic(config))) errors.baseTopic = 'Topic gốc không được chứa +, # hoặc ký tự rỗng.';
    const used = new Map();
    for (const key of Object.keys(REGISTRY)) {
      const binding = config.bindings[key];
      [binding, ...(binding.aliases || [])].forEach((ref, index) => {
        const field = `bindings.${key}.${index}`;
        if (!ref.value || /[+#\u0000]/.test(ref.value) || (ref.kind === 'channel' && /[\s/]/.test(ref.value))) {
          errors[field] = 'Nhập channel không chứa dấu /, khoảng trắng; topic không chứa +, # hoặc ký tự rỗng.';
          return;
        }
        const topic = resolve(config, ref);
        if (used.has(topic)) {
          const previous = used.get(topic);
          errors[field] = `Topic trùng với ${REGISTRY[previous.key].label}.`;
          errors[previous.field] = 'Topic này đang được dùng ở mục khác hoặc kênh phụ.';
        } else used.set(topic, { key, field });
      });
      if (REGISTRY[key].type === 'device' && (!binding.on.trim() || !binding.off.trim() || binding.on.trim() === binding.off.trim())) {
        errors[`payload.${key}`] = 'Lệnh bật/tắt phải có nội dung và khác nhau.';
      }
    }
    return errors;
  }

  function parseNumber(value) {
    const text = String(value).trim().replace(',', '.');
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) ? Number(text) : NaN;
  }

  function parseDevice(config, key, value) {
    const text = String(value).trim();
    if (text === config.bindings[key].on.trim()) return true;
    if (text === config.bindings[key].off.trim()) return false;
    return null;
  }

  function validIrrigation(config) {
    return !!config && ['moisture', 'schedule'].includes(config.mode)
      && Array.isArray(config.days) && config.days.length > 0 && config.days.length <= 7
      && config.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      && new Set(config.days).size === config.days.length
      && Array.isArray(config.slots) && config.slots.length <= 32
      && (config.mode !== 'schedule' || config.slots.length > 0)
      && config.slots.every((slot) => slot && typeof slot.time === 'string'
        && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)
        && Number.isInteger(slot.seconds) && slot.seconds >= 1 && slot.seconds <= 3600)
      && new Set(config.slots.map((slot) => slot.time)).size === config.slots.length;
  }

  return { REGISTRY, clone, defaults, normalize, migrate, baseTopic, resolve, topics, active, routes, validate, parseNumber, parseDevice, validIrrigation };
});
