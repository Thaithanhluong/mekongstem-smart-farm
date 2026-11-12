(() => {
  'use strict';

  const STORAGE_KEY = 'mekongstem.smart-farm.dashboard.v2';
  const LEGACY_STORAGE_KEY = 'mekongstem.smart-farm.dashboard.v1';
  const Config = window.SmartFarmConfig;
  const REGISTRY = Config.REGISTRY;

  const DEVICE_META = {
    light: {
      label: 'Đèn trồng cây',
      toggleId: 'lightToggle',
      statusId: 'lightControlStatus',
      rowSelector: '[data-device="light"]',
      icon: 'fa-lightbulb',
    },
    pump: {
      label: 'Bơm tưới nước',
      toggleId: 'pumpToggle',
      statusId: 'pumpControlStatus',
      rowSelector: '[data-device="pump"]',
      icon: 'fa-faucet-drip',
    },
    fan: {
      label: 'Quạt điều hòa',
      toggleId: 'fanToggle',
      statusId: 'fanControlStatus',
      rowSelector: '[data-device="fan"]',
      icon: 'fa-fan',
    },
  };

  const DEFAULT_STATE = {
    config: Config.defaults(),
    sensors: {
      temperature: null,
      humidity: null,
      light: null,
      soilOne: null,
      soilTwo: null,
      updatedAt: null,
    },
    controls: {
      iotMode: false,
      light: false,
      pump: false,
      fan: false,
      autoLight: false,
      autoPump: false,
      autoFan: false,
    },
    thresholds: {
      lightOn: 50,
      lightOff: 85,
      soilDry: 50,
      pumpDuration: 5,
      fanOn: 30,
      fanOff: 25,
    },
    irrigation: {
      mode: 'moisture',
      days: [0, 1, 2, 3, 4, 5, 6],
      slots: [{ time: '08:00', seconds: 5 }, { time: '17:00', seconds: 5 }],
    },
    cameraUrl: '',
    history: [],
    alerts: [],
    alertsByDate: {},
    ui: {
      alertDate: '',
    },
  };

  const CHART_SERIES = [
    { key: 'temperature', color: '#dc2626', normalize: (value) => clamp(((value - 10) / 35) * 100, 0, 100) },
    { key: 'humidity', color: '#2563eb', normalize: (value) => clamp(value, 0, 100) },
    { key: 'light', color: '#f59e0b', normalize: (value) => clamp(value, 0, 100) },
    { key: 'soilAverage', color: '#16a34a', normalize: (value) => clamp(value, 0, 100) },
  ];

  const HISTORY_LIMIT = 240;
  const ALERT_LIMIT = 36;
  const PUMP_COOLDOWN_MS = 60_000;
  const SENSOR_ALERT_COOLDOWN_MS = 75_000;
  const SMART_FARM_PING = 'ARE U HERE';
  const SMART_FARM_PONG = 'HERE';
  const SMART_FARM_SYNC_REQUEST = 'SYNC_REQUEST';
  const SMART_FARM_SYNC_GUARD_MS = 2500;
  const SMART_FARM_HEARTBEAT_MS = 5000;
  const SMART_FARM_TIMEOUT_MS = 15000;
  const MQTT_HEALTH_CHECK_MS = 3000;
  const CAMERA_RETRY_DELAY_MS = 5000;
  const CAMERA_MAX_AUTO_RETRIES = 2;

  let storageError = false;
  let state = loadState();
  let elements = {};
  let mqttClient = null;
  let mqttConnected = false;
  let mqttGeneration = 0;
  let mqttSubscribed = false;
  let subscriptionVersion = 0;
  let incomingRoutes = new Map();
  let webPumpOn = false;
  let settingsDraft = null;
  let settingsTrigger = null;
  let settingsGroup = null;
  let noticeTimer = null;
  let smartFarmConnected = false;
  let smartFarmLastSeenAt = 0;
  let smartFarmSyncRequestedAt = 0;
  let smartFarmHeartbeatTimer = null;
  let pendingMessages = [];
  let alertThrottle = new Map();
  let autoPumpTimer = null;
  let autoPumpStarted = false;
  let lastPumpCycleAt = 0;
  let cameraRetryTimer = null;
  let cameraRetryCount = 0;
  let cameraLiveAssumeTimer = null;
  let appliedCameraUrl = '';
  let irrigationDirty = false;
  let irrigationPending = null;
  let irrigationAckTimer = null;
  let espConfirmedManualMode = null;
  let espActivationState = 'idle';
  let espActivationTimer = null;
  let espIrrigationConfig = null;
  let espClockReady = false;

  const SENSOR_KEYS = Object.keys(REGISTRY).filter((key) => REGISTRY[key].sensor);
  const THRESHOLD_KEYS = Object.keys(REGISTRY).filter((key) => REGISTRY[key].type === 'threshold');
  const SETTINGS_GROUPS = {
    sensors: { title: 'Cảm biến', keys: SENSOR_KEYS },
    temperature: { title: 'Nhiệt độ', keys: ['temperature'] },
    humidity: { title: 'Độ ẩm không khí', keys: ['humidity'] },
    lightSensor: { title: 'Ánh sáng', keys: ['lightSensor'] },
    soil: { title: 'Độ ẩm đất', keys: ['soilOne', 'soilTwo'] },
    soilOne: { title: 'Đất khu A', keys: ['soilOne'] },
    soilTwo: { title: 'Đất khu B', keys: ['soilTwo'] },
    controls: { title: 'Điều khiển và chế độ', keys: ['mode', 'light', 'pump', 'fan'] },
    light: { title: 'Đèn trồng cây', keys: ['light'] },
    pump: { title: 'Bơm tưới nước', keys: ['pump'] },
    fan: { title: 'Quạt điều hòa', keys: ['fan'] },
    automation: { title: 'Luật vận hành', keys: THRESHOLD_KEYS },
    ruleLight: { title: 'Luật bật/tắt đèn', keys: ['lightOn', 'lightOff'] },
    rulePump: { title: 'Luật tưới nước', keys: ['soilDry', 'pumpDuration'] },
    ruleFan: { title: 'Luật bật/tắt quạt', keys: ['fanOn', 'fanOff'] },
    irrigation: { title: 'Tưới tự động trên ESP32', keys: ['irrigation', 'irrigationStatus', 'clock', 'mode', 'soilDry', 'pumpDuration'] },
    camera: { title: 'Luồng camera', keys: [] },
    connection: { title: 'Kết nối MQTT', keys: ['presence'] },
  };

  function initSettings() {
    function gear(target, group, header = false) {
      if (!target) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `icon-button settings-gear${header ? '' : ' settings-gear--corner'}`;
      button.dataset.settings = group;
      button.title = button.ariaLabel = `Cấu hình ${SETTINGS_GROUPS[group].title}`;
      button.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';
      if (header) {
        let actions = target.querySelector('.panel__header-actions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'panel__header-actions';
          const chevron = target.querySelector('.panel__chevron');
          if (chevron) actions.append(chevron);
          target.append(actions);
        }
        actions.insertBefore(button, actions.querySelector('.panel__chevron'));
      } else {
        target.classList.add('has-settings');
        target.append(button);
      }
    }
    const panels = { sensors: 'sensors', environment: 'sensors', controls: 'controls', automation: 'automation', irrigation: 'irrigation', camera: 'camera', iot: 'connection' };
    Object.entries(panels).forEach(([panel, group]) => gear(document.querySelector(`.${panel}-panel > summary`), group, true));
    const metrics = { temperature: 'temperature', humidity: 'humidity', light: 'lightSensor', soil: 'soil' };
    Object.entries(metrics).forEach(([metric, group]) => gear(document.querySelector(`[data-metric="${metric}"]`), group));
    ['light', 'pump', 'fan'].forEach((key) => gear(document.querySelector(`[data-device="${key}"]`), key));
    ['soilOne', 'soilTwo'].forEach((key) => gear(document.getElementById(`${key}Value`)?.closest('.sensor-row'), key));
    const toggles = [...document.querySelectorAll('.automation-toggle')];
    toggles.forEach((toggle, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'automation-rule';
      toggle.before(wrapper);
      let node = toggle;
      while (node && !wrapper.contains(node)) {
        const next = node.nextElementSibling;
        wrapper.append(node);
        if (!next || next.classList.contains('automation-toggle')) break;
        node = next;
      }
      gear(wrapper, ['ruleLight', 'rulePump', 'ruleFan'][index]);
    });
    const shortcut = document.createElement('button');
    shortcut.type = 'button';
    shortcut.className = 'icon-button';
    shortcut.dataset.settings = 'connection';
    shortcut.title = shortcut.ariaLabel = 'Cấu hình kết nối MQTT';
    shortcut.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';
    document.querySelector('.header-status')?.prepend(shortcut);

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-settings]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      openSettings(trigger.dataset.settings, trigger);
    });
    const dialog = document.getElementById('settingsDialog');
    const close = () => dialog.close();
    document.getElementById('closeSettings').addEventListener('click', close);
    document.getElementById('cancelSettings').addEventListener('click', close);
    dialog.addEventListener('close', () => {
      settingsDraft = null;
      document.body.classList.remove('settings-open');
      settingsTrigger?.focus();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    const fields = document.getElementById('settingsFields');
    fields.addEventListener('input', updateSettingsDraft);
    fields.addEventListener('change', updateSettingsDraft);
    fields.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-alias]');
      const remove = event.target.closest('[data-remove-alias]');
      if (add) {
        settingsDraft.config.bindings[add.dataset.addAlias].aliases.push({ kind: 'channel', value: '' });
        renderSettingsFields();
        fields.querySelector(`[data-binding="${add.dataset.addAlias}"] .binding-ref:last-of-type input`)?.focus();
      }
      if (remove) {
        settingsDraft.config.bindings[remove.dataset.removeAlias].aliases.splice(Number(remove.dataset.index), 1);
        renderSettingsFields();
        fields.querySelector(`[data-add-alias="${remove.dataset.removeAlias}"]`)?.focus();
      }
    });
  }

  function openSettings(group, trigger) {
    settingsGroup = group;
    settingsTrigger = trigger;
    settingsDraft = { config: Config.clone(state.config), cameraUrl: state.cameraUrl };
    document.getElementById('settingsTitle').textContent = `Cấu hình · ${SETTINGS_GROUPS[group].title}`;
    document.getElementById('settingsError').hidden = true;
    renderSettingsFields();
    document.body.classList.add('settings-open');
    document.getElementById('settingsDialog').showModal();
  }

  function settingsField(label, control, errorKey) {
    const id = `settings-error-${errorKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
    return `<div class="settings-field"><label>${escapeHtml(label)}${control.replace(/<(input|select|textarea)\b/, `<$1 aria-describedby="${id}"`)}</label><small id="${id}" class="settings-field-error" data-error-for="${errorKey}"></small></div>`;
  }

  function renderSettingsFields() {
    const config = settingsDraft.config;
    const html = [];
    if (settingsGroup === 'connection') {
      html.push(settingsField('Loại kết nối', `<select data-config="provider"><option value="ohstem" ${config.provider === 'ohstem' ? 'selected' : ''}>OhStem · username/feeds/channel</option><option value="custom" ${config.provider === 'custom' ? 'selected' : ''}>MQTT tùy chỉnh</option></select>`, 'provider'));
      [['url', 'URL WebSocket', 'url'], ['username', 'Username giống khối Scratch', 'text'], ['password', 'Mật khẩu MQTT', 'password'], ['baseTopic', 'Topic gốc', 'text']].forEach(([key, label, type]) => {
        html.push(settingsField(label, `<input type="${type}" data-config="${key}" value="${escapeHtml(key === 'baseTopic' ? Config.baseTopic(config) : config[key])}" ${key === 'baseTopic' && config.provider === 'ohstem' ? 'readonly' : ''} autocomplete="off">`, key));
      });
      html.push('<p class="configuration-hint">ESP32 dùng cổng TCP 1883; trình duyệt cần URL WebSocket. Username phải khớp khối kết nối trên bo mạch. Mật khẩu ở đây là MQTT, không phải mật khẩu WiFi.</p>');
    }
    if (settingsGroup === 'connection' || settingsGroup === 'irrigation') {
      const features = settingsGroup === 'irrigation' ? ['irrigation'] : ['heartbeat', 'sync', 'irrigation'];
      const labels = { heartbeat: 'Chương trình có phản hồi ARE U HERE / HERE', sync: 'Chương trình có xử lý SYNC_REQUEST', irrigation: 'Chương trình có cấu hình tưới, phản hồi và đồng bộ giờ' };
      html.push('<fieldset class="settings-features"><legend>Tính năng chương trình Scratch hỗ trợ</legend>');
      features.forEach((key) => html.push(`<label><input type="checkbox" data-feature="${key}" ${config.features[key] ? 'checked' : ''}> ${labels[key]}</label>`));
      html.push('</fieldset>');
    }
    if (settingsGroup === 'camera') {
      html.push(settingsField('URL luồng camera (để trống để dùng mô phỏng)', `<input type="url" data-camera value="${escapeHtml(settingsDraft.cameraUrl)}" placeholder="http://địa-chỉ-camera:81/stream" autocomplete="off">`, 'cameraUrl'));
    }
    SETTINGS_GROUPS[settingsGroup].keys.forEach((key) => {
      const meta = REGISTRY[key];
      const binding = config.bindings[key];
      const direction = { rx: 'Nhận', tx: 'Gửi', both: 'Gửi / nhận' }[meta.direction];
      html.push(`<fieldset class="binding-editor" data-binding="${key}"><legend>${escapeHtml(meta.label)} <span>${direction}</span></legend>`);
      [binding, ...binding.aliases].forEach((ref, index) => {
        html.push(`<div class="binding-ref" data-ref="${key}" data-index="${index}">`);
        html.push(settingsField(index ? 'Loại kênh phụ' : 'Loại địa chỉ', `<select data-ref-kind><option value="channel" ${ref.kind === 'channel' ? 'selected' : ''}>Channel theo topic gốc</option><option value="topic" ${ref.kind === 'topic' ? 'selected' : ''}>Topic đầy đủ</option></select>`, `kind.${key}.${index}`));
        html.push(settingsField(index ? 'Kênh phụ tương thích' : 'Channel / topic', `<input type="text" data-ref-value value="${escapeHtml(ref.value)}" autocomplete="off" spellcheck="false">`, `bindings.${key}.${index}`));
        if (index) html.push(`<button type="button" class="secondary-button" data-remove-alias="${key}" data-index="${index - 1}" aria-label="Xóa kênh phụ ${escapeHtml(meta.label)}">Xóa kênh phụ</button>`);
        html.push(`<p class="topic-preview" data-preview="${key}" data-index="${index}"></p></div>`);
      });
      if (meta.type === 'threshold') html.push(`<button type="button" class="settings-add-alias" data-add-alias="${key}">+ Thêm kênh phụ tương thích</button>`);
      if (meta.type === 'device') {
        html.push('<div class="payload-fields">');
        html.push(settingsField('Lệnh bật', `<input type="text" data-payload="${key}" data-command="on" value="${escapeHtml(binding.on)}" autocomplete="off">`, `payload.${key}`));
        html.push(settingsField('Lệnh tắt', `<input type="text" data-payload="${key}" data-command="off" value="${escapeHtml(binding.off)}" autocomplete="off">`, `off.${key}`));
        html.push('</div><p class="configuration-hint">Điền đúng chuỗi trong khối “nếu thông tin nhận được là…”.</p>');
      }
      html.push('</fieldset>');
    });
    document.getElementById('settingsFields').innerHTML = html.join('');
    renderTopicPreviews();
  }

  function updateSettingsDraft(event) {
    const input = event.target;
    const config = settingsDraft.config;
    if (input.dataset.config) {
      config[input.dataset.config] = input.value;
      if (config.provider === 'ohstem') config.baseTopic = Config.baseTopic(config);
      if (input.dataset.config === 'provider') {
        renderSettingsFields();
        document.querySelector('[data-config="provider"]')?.focus();
      } else if (config.provider === 'ohstem') document.querySelector('[data-config="baseTopic"]').value = Config.baseTopic(config);
    }
    if (input.dataset.feature) config.features[input.dataset.feature] = input.checked;
    if (input.hasAttribute('data-camera')) settingsDraft.cameraUrl = input.value;
    const row = input.closest('[data-ref]');
    if (row) {
      const binding = config.bindings[row.dataset.ref];
      const index = Number(row.dataset.index);
      const ref = index ? binding.aliases[index - 1] : binding;
      if (input.hasAttribute('data-ref-kind')) ref.kind = input.value;
      if (input.hasAttribute('data-ref-value')) ref.value = input.value;
    }
    if (input.dataset.payload) config.bindings[input.dataset.payload][input.dataset.command] = input.value;
    renderTopicPreviews();
  }

  function renderTopicPreviews() {
    document.querySelectorAll('[data-preview]').forEach((element) => {
      const binding = settingsDraft.config.bindings[element.dataset.preview];
      const index = Number(element.dataset.index);
      const ref = index ? binding.aliases[index - 1] : binding;
      element.textContent = `Topic thực tế: ${Config.resolve(settingsDraft.config, ref) || '—'}${ref.kind === 'channel' && settingsDraft.config.provider === 'ohstem' && !settingsDraft.config.username ? ' (nhập username trong Kết nối)' : ''}`;
    });
  }

  function showSettingsErrors(errors) {
    document.querySelectorAll('[data-error-for]').forEach((element) => { element.textContent = errors[element.dataset.errorFor] || ''; });
    document.querySelectorAll('#settingsFields [aria-describedby]').forEach((input) => {
      input.setAttribute('aria-invalid', String(Boolean(document.getElementById(input.getAttribute('aria-describedby'))?.textContent)));
    });
    const summary = document.getElementById('settingsError');
    summary.hidden = !Object.keys(errors).length;
    summary.textContent = Object.values(errors)[0] || '';
    document.querySelector('#settingsFields [aria-invalid="true"]')?.focus();
  }

  function saveSettings(event) {
    event.preventDefault();
    const draft = settingsDraft;
    const config = Config.normalize(draft.config);
    if (settingsGroup === 'connection') config.configured = true;
    const errors = settingsGroup === 'camera' ? {} : Config.validate(config);
    const cameraUrl = draft.cameraUrl.trim();
    if (settingsGroup === 'camera' && cameraUrl) {
      try {
        const url = new URL(cameraUrl);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
        if (location.protocol === 'https:' && url.protocol === 'http:') errors.cameraUrl = 'Trang HTTPS cần URL camera HTTPS hoặc mở dashboard qua HTTP trong mạng nội bộ.';
      } catch { errors.cameraUrl = 'Nhập URL camera http:// hoặc https:// hợp lệ.'; }
    }
    const mqttChanged = JSON.stringify(config) !== JSON.stringify(state.config);
    if (mqttChanged && (webPumpOn || autoPumpStarted)) errors.connection = 'Tắt bơm qua cấu hình hiện tại trước khi đổi kết nối hoặc channel.';
    if (Object.keys(errors).length) { showSettingsErrors(errors); return; }
    const candidate = { ...state, config, cameraUrl };
    if (mqttChanged) {
      candidate.sensors = Config.clone(DEFAULT_STATE.sensors);
      candidate.history = [];
      candidate.controls = { ...state.controls, iotMode: false, light: false, pump: false, fan: false, autoLight: false, autoPump: false, autoFan: false };
    }
    if (!persistState(candidate)) {
      showSettingsErrors({ storage: 'Không lưu được cấu hình. Kiểm tra bộ nhớ trình duyệt rồi thử lại.' });
      return;
    }
    if (mqttChanged) {
      disconnectMqtt();
      window.clearTimeout(autoPumpTimer);
      autoPumpTimer = null;
      autoPumpStarted = false;
      lastPumpCycleAt = 0;
      alertThrottle.clear();
    }
    const cameraChanged = state.cameraUrl !== candidate.cameraUrl;
    state = candidate;
    renderAll();
    renderConfiguration();
    if (cameraChanged) renderCamera({ forceReload: true });
    if (mqttChanged) connectMqtt();
    document.getElementById('settingsDialog').close();
    notifySettings('Đã lưu cấu hình trên trình duyệt này.');
  }

  function renderConfiguration() {
    const configured = state.config.configured;
    document.getElementById('connectionHint').textContent = configured
      ? `${state.config.url} · ${Config.baseTopic(state.config) || 'Topic đầy đủ'}`
      : 'Chọn bánh răng, nhập username giống khối kết nối OhStem và lưu để bắt đầu.';
    const map = document.getElementById('topicMap');
    map.replaceChildren();
    Object.entries(REGISTRY).forEach(([key, meta]) => {
      if (!Config.active(state.config, key)) return;
      const item = document.createElement('span');
      item.textContent = `${meta.label}: ${Config.topics(state.config, key).join(', ')}`;
      map.append(item);
    });
    document.querySelectorAll('.controls-panel input, .controls-panel [data-mode], .automation-list input').forEach((input) => { input.disabled = !configured; });
    const irrigationEnabled = configured && state.config.features.irrigation;
    document.querySelectorAll('#irrigationForm input, #irrigationForm button').forEach((input) => { input.disabled = !irrigationEnabled; });
    if (irrigationEnabled) renderIrrigation();
    else irrigationStatus('Chưa bật hỗ trợ tưới trên ESP32. Cấu hình bằng bánh răng của khối.');
    renderEspIrrigationMode();
  }

  function notifySettings(message, error = false) {
    const element = document.getElementById('settingsNotice');
    if (!element) return;
    element.hidden = false;
    element.classList.toggle('is-error', error);
    element.textContent = message;
    window.clearTimeout(noticeTimer);
    if (!error) noticeTimer = window.setTimeout(() => { element.hidden = true; }, 6000);
  }

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    hydrateInputs();
    bindEvents();
    bindIrrigation();
    initSettings();
    renderAll();
    renderConfiguration();
    updateClock();
    connectMqtt();
    if (storageError) notifySettings('Không đọc được cấu hình đã lưu. Kiểm tra bộ nhớ trình duyệt.', true);

    window.setInterval(updateClock, 1000);
    window.setInterval(() => runFrontendAutomation('timer'), 4000);
    window.setInterval(checkMqttConnectionHealth, MQTT_HEALTH_CHECK_MS);
    window.addEventListener('resize', drawEnvironmentChart);
    document.querySelector('.environment-panel')?.addEventListener('toggle', (event) => {
      if (event.currentTarget.open) drawEnvironmentChart();
    });
  }

  function bindElements() {
    [
      'mqttConnectionStatus',
      'mqttDetail',
      'clockValue',
      'temperatureValue',
      'temperatureGauge',
      'temperatureStatus',
      'humidityValue',
      'humidityGauge',
      'humidityStatus',
      'lightValue',
      'lightGauge',
      'lightStatus',
      'soilAverageValue',
      'soilGauge',
      'soilStatus',
      'soilOneValue',
      'soilTwoValue',
      'cropConditionValue',
      'lastUpdatedValue',
      'environmentChart',
      'simulateDataButton',
      'modeEspAuto',
      'modeIotManual',
      'lightToggle',
      'pumpToggle',
      'fanToggle',
      'lightControlStatus',
      'pumpControlStatus',
      'fanControlStatus',
      'autoLightToggle',
      'autoPumpToggle',
      'autoFanToggle',
      'lightOnThreshold',
      'lightOffThreshold',
      'soilDryThreshold',
      'pumpDurationSeconds',
      'fanOnThreshold',
      'fanOffThreshold',
      'lightOnThresholdValue',
      'lightOffThresholdValue',
      'soilDryThresholdValue',
      'fanOnThresholdValue',
      'fanOffThresholdValue',
      'cameraStream',
      'cameraPlaceholder',
      'cameraStatus',
      'cameraTimestamp',
      'refreshCameraButton',
      'reconnectMqttButton',
      'alertsList',
      'clearAlertsButton',
      'alertPrevDayButton',
      'alertDateInput',
      'alertTodayButton',
      'alertNextDayButton',
    ].forEach((id) => {
      elements[id] = document.getElementById(id);
    });

    elements.mqttStatusChip = document.querySelector('.status-chip--mqtt');
    elements.cameraView = document.querySelector('.camera-view');
  }

  function hydrateInputs() {

    setInputValue('lightOnThreshold', state.thresholds.lightOn);
    setInputValue('lightOffThreshold', state.thresholds.lightOff);
    setInputValue('soilDryThreshold', state.thresholds.soilDry);
    setInputValue('pumpDurationSeconds', state.thresholds.pumpDuration);
    setInputValue('fanOnThreshold', state.thresholds.fanOn);
    setInputValue('fanOffThreshold', state.thresholds.fanOff);

    setChecked('autoLightToggle', state.controls.autoLight);
    setChecked('autoPumpToggle', state.controls.autoPump);
    setChecked('autoFanToggle', state.controls.autoFan);
    setChecked('lightToggle', state.controls.light);
    setChecked('pumpToggle', state.controls.pump);
    setChecked('fanToggle', state.controls.fan);
  }

  function bindEvents() {
    elements.modeEspAuto?.addEventListener('click', () => setIotMode(false, { source: 'user' }));
    elements.modeIotManual?.addEventListener('click', () => setIotMode(true, { source: 'user' }));

    Object.keys(DEVICE_META).forEach((device) => {
      const meta = DEVICE_META[device];
      elements[meta.toggleId]?.addEventListener('change', (event) => {
        ensureIotMode('Điều khiển IoT');
        setDevice(device, event.target.checked, { source: 'user' });
      });
    });

    elements.autoLightToggle?.addEventListener('change', (event) => {
      setAutomationFlag('autoLight', event.target.checked);
    });

    elements.autoPumpToggle?.addEventListener('change', (event) => {
      setAutomationFlag('autoPump', event.target.checked);
      if (!event.target.checked) stopAutoPumpCycle();
    });

    elements.autoFanToggle?.addEventListener('change', (event) => {
      setAutomationFlag('autoFan', event.target.checked);
    });

    bindThreshold('lightOnThreshold', 'lightOn');
    bindThreshold('lightOffThreshold', 'lightOff');
    bindThreshold('soilDryThreshold', 'soilDry');
    bindThreshold('pumpDurationSeconds', 'pumpDuration');
    bindThreshold('fanOnThreshold', 'fanOn');
    bindThreshold('fanOffThreshold', 'fanOff');

    elements.refreshCameraButton?.addEventListener('click', () => {
      refreshCameraStream({ notify: true });
    });

    attachCameraStreamEvents();
    elements.reconnectMqttButton?.addEventListener('click', reconnectMqtt);
    elements.clearAlertsButton?.addEventListener('click', () => {
      const dateKey = getSelectedAlertDateKey();
      state.alertsByDate[dateKey] = [];
      state.alerts = [];
      saveState();
      renderAlerts();
    });

    elements.alertPrevDayButton?.addEventListener('click', () => {
      setAlertDate(shiftDateKey(getSelectedAlertDateKey(), -1));
    });

    elements.alertNextDayButton?.addEventListener('click', () => {
      setAlertDate(shiftDateKey(getSelectedAlertDateKey(), 1));
    });

    elements.alertTodayButton?.addEventListener('click', () => {
      setAlertDate(getDateKey());
    });

    elements.alertDateInput?.addEventListener('change', () => {
      setAlertDate(elements.alertDateInput.value);
    });

    elements.simulateDataButton?.addEventListener('click', simulateSensorData);
  }

  function bindThreshold(inputId, key) {
    const input = elements[inputId];
    if (!input) return;

    input.addEventListener('input', () => {
      state.thresholds[key] = normalizeThreshold(key, input.value);
      syncThresholdBounds(state.thresholds);
      renderThresholdLabels();
      publishRuleParameters(key);
    });

    input.addEventListener('change', () => {
      state.thresholds[key] = normalizeThreshold(key, input.value);
      syncThresholdBounds(state.thresholds);
      hydrateThresholdInputs();
      saveState();
      publishRuleParameters(key);
      renderSensorCards();
      runFrontendAutomation('threshold');
    });
  }

  function connectMqtt() {
    if (mqttClient || mqttConnected) return;
    if (!state.config.configured || Object.keys(Config.validate(state.config)).length) {
      setMqttStatus('Chưa cấu hình kết nối', 'warning');
      return;
    }

    if (typeof mqtt === 'undefined') {
      setMqttStatus('Thiếu thư viện MQTT', 'error');
      return;
    }

    setMqttStatus('Đang kết nối MQTT', 'connecting');

    const generation = ++mqttGeneration;
    try {
      mqttClient = mqtt.connect(state.config.url, {
        clientId: `mekongstem_farm_${Math.random().toString(16).slice(2, 10)}`,
        username: state.config.username,
        password: state.config.password,
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 2500,
      });
    } catch (error) {
      mqttClient = null;
      setMqttStatus('Lỗi MQTT', 'error');
      addAlert('MQTT', error.message || 'Không thể tạo kết nối MQTT.', 'danger', 'fa-plug-circle-xmark');
      return;
    }

    const client = mqttClient;
    const current = () => generation === mqttGeneration && mqttClient === client;
    client.on('connect', () => {
      if (!current()) return;
      mqttConnected = true;
      mqttSubscribed = false;
      smartFarmConnected = false;
      smartFarmLastSeenAt = 0;
      subscribeMqttTopics();
    });

    client.on('reconnect', () => {
      if (!current()) return;
      ++subscriptionVersion;
      invalidateEspModeConfirmation();
      mqttConnected = false;
      mqttSubscribed = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      setMqttStatus('Đang kết nối lại', 'connecting');
    });

    client.on('close', () => {
      if (!current()) return;
      ++subscriptionVersion;
      invalidateEspModeConfirmation();
      mqttConnected = false;
      mqttSubscribed = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      if (mqttClient) {
        setMqttStatus('MQTT ngắt kết nối', 'error');
      }
    });

    client.on('error', (error) => {
      if (!current()) return;
      setMqttStatus('Lỗi MQTT', 'error');
      addAlertThrottled('mqtt-error', 'MQTT', error.message || 'Broker trả về lỗi kết nối.', 'danger', 'fa-plug-circle-xmark', 60_000);
    });

    client.on('message', (topic, payload) => {
      if (current() && mqttConnected) handleMqttMessage(topic, payload);
    });
  }

  function reconnectMqtt() {
    const stopPending = webPumpOn && pendingMessages.some((item) => item.channel === 'pump' && item.message === state.config.bindings.pump.off);
    disconnectMqtt();
    connectMqtt();
    // A manual retry uses the same routes; retain only an explicit pending stop.
    if (stopPending && mqttClient) publishChannel('pump', state.config.bindings.pump.off);
  }

  function disconnectMqtt() {
    ++mqttGeneration;
    ++subscriptionVersion;
    const client = mqttClient;
    mqttClient = null;
    mqttConnected = false;
    mqttSubscribed = false;
    incomingRoutes.clear();
    pendingMessages = [];
    smartFarmConnected = false;
    smartFarmLastSeenAt = 0;
    smartFarmSyncRequestedAt = 0;
    stopSmartFarmHeartbeat();
    window.clearTimeout(irrigationAckTimer);
    window.clearTimeout(espActivationTimer);
    irrigationPending = null;
    espActivationState = 'idle';
    espConfirmedManualMode = null;
    espIrrigationConfig = null;
    espClockReady = false;
    irrigationDirty = false;
    irrigationStatus('Chưa nhận cấu hình từ ESP32 trên kết nối này.');
    renderEspIrrigationMode();
    client?.end(true);
  }

  function subscribeMqttTopics() {
    if (!mqttClient || !mqttConnected) return;

    incomingRoutes = Config.routes(state.config, true);
    const client = mqttClient;
    const generation = mqttGeneration;
    const subscription = ++subscriptionVersion;
    client.subscribe(Array.from(incomingRoutes.keys()), { qos: 0 }, (error, granted) => {
      if (client !== mqttClient || generation !== mqttGeneration || subscription !== subscriptionVersion || !mqttConnected) return;
      if (error || granted?.some((item) => item.qos === 128)) {
        setMqttStatus('Lỗi nghe topic', 'error');
        addAlert('MQTT', error?.message || 'Broker từ chối subscribe topic.', 'danger', 'fa-triangle-exclamation');
        return;
      }

      mqttSubscribed = true;
      updateMqttDetail();
      setMqttStatus(state.config.features.heartbeat ? 'MQTT OK - chờ Smart Farm' : 'MQTT đã kết nối', state.config.features.heartbeat ? 'warning' : 'online');
      if (state.config.features.irrigation) publishChannel('clock', Math.floor(Date.now() / 1000));
      if (state.config.features.heartbeat) startSmartFarmHeartbeat();
      if (state.config.features.sync) sendSmartFarmSyncRequest();
      flushPendingMessages();
      addAlertThrottled('mqtt-online', 'MQTT', 'Đã sẵn sàng nhận dữ liệu Smart Farm.', 'info', 'fa-wifi', 30_000);
    });
  }

  function handleMqttMessage(topic, payload) {
    const message = payload.toString().trim();
    const channel = incomingRoutes.get(String(topic));
    if (!channel) return;
    const meta = REGISTRY[channel];

    if (channel === 'irrigationStatus') {
      handleIrrigationStatus(message);
      return;
    }

    if (channel === 'presence') {
      handleSmartFarmPresence(message);
      return;
    }

    if (meta.sensor) {
      const value = parseNumericValue(message);
      if (!Number.isFinite(value)) return;
      markSmartFarmOnline();
      updateSensor(meta.sensor, value, { source: 'mqtt' });
      return;
    }

    if (meta.type === 'device') {
      const stateValue = Config.parseDevice(state.config, channel, message);
      if (stateValue !== null) {
        // A broker echo is not confirmation that the board executed a command.
        setDevice(channel, stateValue, { source: 'mqtt', publish: false });
      }
      return;
    }

    if (channel === 'mode') {
      const iotMode = parseBinary(message);
      if (iotMode !== null) {
        state.controls.iotMode = iotMode;
        saveState();
        renderMode();
      }
      return;
    }

    if (meta.type === 'threshold') {
      updateThresholdFromMqtt(channel, message);
    }
  }

  function publishChannel(channel, payload) {
    if (!state.config.configured || !REGISTRY[channel] || !Config.active(state.config, channel)) return;
    const message = String(payload);

    if (!mqttClient || !mqttConnected || !mqttSubscribed) {
      pendingMessages = pendingMessages.filter((item) => item.channel !== channel);
      pendingMessages.push({ channel, message, generation: mqttGeneration });
      setMqttStatus('Đợi MQTT để gửi lệnh', 'connecting');
      return;
    }

    const client = mqttClient;
    const generation = mqttGeneration;
    Config.topics(state.config, channel).forEach((topic) => {
      client.publish(topic, message, { qos: 0, retain: false }, (error) => {
        if (client !== mqttClient || generation !== mqttGeneration) return;
        if (error) {
          addAlert('MQTT', `Không gửi được ${topic}: ${error.message}`, 'danger', 'fa-triangle-exclamation');
        } else if (channel === 'pump' && message === state.config.bindings.pump.off) {
          webPumpOn = false;
        }
      });
    });
  }

  function flushPendingMessages() {
    const messages = pendingMessages.slice();
    pendingMessages = [];
    messages.filter((item) => item.generation === mqttGeneration).forEach((item) => publishChannel(item.channel, item.message));
  }

  function irrigationStatus(text) {
    document.getElementById('irrigationStatus').textContent = text;
  }

  function markIrrigationDirty() {
    irrigationDirty = true;
    irrigationStatus('Có thay đổi chưa lưu xuống ESP32.');
  }

  function renderIrrigation() {
    const config = state.irrigation;
    document.querySelectorAll('[data-irrigation-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.irrigationMode === config.mode));
    });
    document.querySelectorAll('[data-irrigation-day]').forEach((button) => {
      const selected = button.dataset.irrigationDay === 'all' ? config.days.length === 7 : config.days.includes(Number(button.dataset.irrigationDay));
      button.setAttribute('aria-pressed', String(selected));
    });
    const scheduled = config.mode === 'schedule';
    document.getElementById('irrigationScheduleFields').hidden = !scheduled;
    document.getElementById('irrigationMoistureHint').hidden = scheduled;
    const container = document.getElementById('irrigationSlots');
    container.replaceChildren();
    config.slots.forEach((slot, index) => {
      const row = document.createElement('div');
      row.className = 'irrigation-slot';
      const timeLabel = document.createElement('label');
      timeLabel.textContent = `Giờ tưới ${index + 1}`;
      const time = document.createElement('input');
      time.type = 'time';
      time.required = scheduled;
      time.disabled = !scheduled;
      time.value = slot.time;
      time.addEventListener('input', () => { slot.time = time.value; markIrrigationDirty(); });
      timeLabel.append(time);
      const secondsLabel = document.createElement('label');
      secondsLabel.textContent = 'Thời gian (giây)';
      const seconds = document.createElement('input');
      seconds.type = 'number';
      seconds.min = '1';
      seconds.max = '3600';
      seconds.step = '1';
      seconds.required = scheduled;
      seconds.disabled = !scheduled;
      seconds.value = slot.seconds;
      seconds.addEventListener('input', () => { slot.seconds = Number(seconds.value); markIrrigationDirty(); });
      secondsLabel.append(seconds);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Xóa';
      remove.setAttribute('aria-label', `Xóa mốc tưới ${index + 1}`);
      remove.addEventListener('click', () => {
        config.slots.splice(index, 1);
        markIrrigationDirty();
        renderIrrigation();
      });
      row.append(timeLabel, secondsLabel, remove);
      container.append(row);
    });
    document.getElementById('addIrrigationSlot').disabled = config.slots.length >= 32;
  }

  function bindIrrigation() {
    renderIrrigation();
    renderEspIrrigationMode();
    document.querySelectorAll('[data-irrigation-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.irrigation.mode = button.dataset.irrigationMode;
        markIrrigationDirty();
        renderIrrigation();
      });
    });
    document.querySelectorAll('[data-irrigation-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.irrigationDay;
        const days = state.irrigation.days;
        state.irrigation.days = day === 'all' ? [0, 1, 2, 3, 4, 5, 6]
          : days.includes(Number(day)) ? days.filter((item) => item !== Number(day)) : [...days, Number(day)].sort();
        markIrrigationDirty();
        renderIrrigation();
      });
    });
    document.getElementById('addIrrigationSlot').addEventListener('click', () => {
      if (state.irrigation.slots.length >= 32) return;
      state.irrigation.slots.push({ time: '', seconds: state.thresholds.pumpDuration });
      markIrrigationDirty();
      renderIrrigation();
      document.querySelector('.irrigation-slot:last-child input').focus();
    });
    document.getElementById('activateEspIrrigation').addEventListener('click', () => {
      setIotMode(false, { source: 'user' });
    });
    document.getElementById('irrigationForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.config.features.irrigation) return;
      const config = state.irrigation;
      const times = config.slots.map((slot) => slot.time);
      if (!config.days.length) { irrigationStatus('Chọn ít nhất một ngày tưới.'); return; }
      if (config.mode === 'schedule' && !config.slots.length) { irrigationStatus('Thêm ít nhất một mốc giờ.'); return; }
      if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || new Set(times).size !== times.length) {
        irrigationStatus('Mỗi mốc cần giờ hợp lệ và không trùng nhau.'); return;
      }
      if (config.slots.some((slot) => !Number.isInteger(slot.seconds) || slot.seconds < 1 || slot.seconds > 3600)) {
        irrigationStatus('Thời gian mỗi mốc cần từ 1 đến 3600 giây.'); return;
      }
      irrigationPending = JSON.stringify(config);
      saveState();
      irrigationStatus(mqttConnected ? 'Đang gửi, chờ ESP32 xác nhận…' : 'Đang chờ kết nối MQTT để gửi cấu hình…');
      publishChannel('irrigation', irrigationPending);
      publishChannel('clock', Math.floor(Date.now() / 1000));
      window.clearTimeout(irrigationAckTimer);
      irrigationAckTimer = window.setTimeout(() => {
        if (irrigationPending) irrigationStatus('Chưa có xác nhận từ ESP32. Kiểm tra kết nối và nạp chương trình ESP32 mới, rồi lưu lại.');
      }, 15000);
    });
  }

  function handleIrrigationStatus(message) {
    try {
      const status = JSON.parse(message);
      const config = status.config;
      if (!Config.validIrrigation(config)) return;
      if (typeof status.manual_mode === 'boolean') {
        espConfirmedManualMode = status.manual_mode;
        espIrrigationConfig = config;
        espClockReady = status.clock_ready === true;
        state.controls.iotMode = status.manual_mode;
        saveState();
        renderMode();
        if (!status.manual_mode || espActivationState !== 'pending') {
          window.clearTimeout(espActivationTimer);
          espActivationState = 'idle';
        }
        renderEspIrrigationMode();
      }
      if (status.error) { irrigationStatus(`ESP32 chưa lưu được: ${status.error}`); return; }
      const matchesPending = irrigationPending && sameIrrigation(config, JSON.parse(irrigationPending));
      if (irrigationPending && !matchesPending) return;
      if (matchesPending) {
        window.clearTimeout(irrigationAckTimer);
        irrigationPending = null;
        // Preserve any new edits made while waiting for the previous save.
        irrigationDirty = !sameIrrigation(state.irrigation, config);
      }
      if (irrigationDirty) {
        irrigationStatus(matchesPending ? 'ESP32 đã lưu cấu hình vừa gửi. Bạn còn thay đổi mới chưa lưu.' : 'Có thay đổi chưa lưu xuống ESP32.');
        return;
      }
      state.irrigation = config;
      saveState();
      renderIrrigation();
      const clock = config.mode === 'schedule' && !status.clock_ready ? ' Đang chờ đồng bộ giờ từ Internet hoặc web; lịch chưa chạy.' : '';
      irrigationStatus(`ESP32 đã xác nhận cấu hình.${clock} Chạy khi chọn “ESP tự động”.`);
    } catch (error) {
      // Ignore malformed status messages.
    }
  }

  function sameIrrigation(left, right) {
    const canonical = (config) => JSON.stringify({ mode: config.mode, days: [...config.days].sort(), slots: [...config.slots].sort((a, b) => a.time.localeCompare(b.time)).map((slot) => ({ time: slot.time, seconds: slot.seconds })) });
    return canonical(left) === canonical(right);
  }

  function renderEspIrrigationMode() {
    const button = document.getElementById('activateEspIrrigation');
    const status = document.getElementById('espIrrigationModeStatus');
    if (!state.config.features.irrigation) {
      button.disabled = true;
      button.textContent = 'Bật ESP tự động';
      button.classList.remove('is-confirmed');
      button.setAttribute('aria-busy', 'false');
      status.dataset.state = 'idle';
      status.textContent = 'Bật hỗ trợ lịch tưới trong cài đặt khi Scratch có xử lý cấu hình, phản hồi và đồng bộ giờ.';
      return;
    }
    const pending = espActivationState === 'pending';
    const active = espConfirmedManualMode === false && !pending;
    button.disabled = pending || active;
    button.setAttribute('aria-busy', String(pending));
    button.classList.toggle('is-confirmed', active);
    button.textContent = pending ? 'Đang bật…' : active ? '✓ ESP tự động đã bật' : espActivationState === 'timeout' ? 'Thử bật ESP tự động' : 'Bật ESP tự động';
    status.dataset.state = pending ? 'pending' : active ? 'active' : espActivationState;
    if (pending) {
      status.textContent = mqttConnected ? 'Đã gửi yêu cầu bật tự động. Đang chờ ESP32 xác nhận…' : 'Đang chờ kết nối MQTT để gửi yêu cầu bật tự động…';
    } else if (active) {
      status.textContent = espIrrigationConfig?.mode === 'schedule'
        ? espClockReady ? 'ESP32 đã bật tự động, chờ đến giờ tưới trong lịch đã lưu. Bạn có thể đóng web.' : 'ESP32 đã bật tự động. Đang chờ đồng bộ giờ để chạy lịch.'
        : 'ESP32 đã bật tự động, tưới khi độ ẩm đất chạm ngưỡng. Bạn có thể đóng web.';
    } else if (espActivationState === 'timeout') {
      status.textContent = 'Chưa nhận được xác nhận từ ESP32. Kiểm tra kết nối, nạp chương trình ESP32 mới rồi thử lại.';
    } else {
      status.textContent = espConfirmedManualMode === true ? 'ESP32 đang ở chế độ thủ công. Bật ESP tự động để chạy cách tưới đã lưu.' : 'Chưa có xác nhận chế độ từ ESP32.';
    }
  }

  function invalidateEspModeConfirmation() {
    espConfirmedManualMode = null;
    renderEspIrrigationMode();
  }

  function publishRuleParameters(key) {
    if (REGISTRY[key]?.type !== 'threshold') return;
    publishChannel(key, normalizeThreshold(key, state.thresholds[key]));
  }

  function updateThresholdFromMqtt(key, value) {
    const number = parseNumericValue(value);
    if (!Number.isFinite(number)) return;
    state.thresholds[key] = normalizeThreshold(key, number);
    syncThresholdBounds(state.thresholds);
    hydrateThresholdInputs();
    saveState();
    renderThresholdLabels();
    renderSensorCards();
    runFrontendAutomation('threshold');
  }

  function sendSmartFarmSyncRequest() {
    if (!state.config.features.sync) return;
    smartFarmSyncRequestedAt = Date.now();
    publishPresenceMessage(SMART_FARM_SYNC_REQUEST);
  }

  function startSmartFarmHeartbeat() {
    stopSmartFarmHeartbeat();
    sendSmartFarmHeartbeat();
    smartFarmHeartbeatTimer = window.setInterval(sendSmartFarmHeartbeat, SMART_FARM_HEARTBEAT_MS);
  }

  function stopSmartFarmHeartbeat() {
    if (!smartFarmHeartbeatTimer) return;
    window.clearInterval(smartFarmHeartbeatTimer);
    smartFarmHeartbeatTimer = null;
  }

  function sendSmartFarmHeartbeat() {
    if (!mqttClient || !mqttConnected || !state.config.features.heartbeat) return;

    checkSmartFarmTimeout();
    if (!smartFarmConnected) {
      setMqttStatus(smartFarmLastSeenAt ? 'Mất kết nối Smart Farm' : 'MQTT OK - chờ Smart Farm', 'warning');
    }

    publishPresenceMessage(SMART_FARM_PING);
  }

  function checkMqttConnectionHealth() {
    if (!state.config.configured) return;
    const clientIsConnected = Boolean(mqttClient?.connected);
    const clientIsReconnecting = Boolean(mqttClient?.reconnecting);

    if (!mqttClient) {
      mqttConnected = false;
      smartFarmConnected = false;
      setMqttStatus('MQTT ngắt kết nối', 'error');
      connectMqtt();
      return;
    }

    if (!clientIsConnected) {
      mqttConnected = false;
      mqttSubscribed = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      setMqttStatus(clientIsReconnecting ? 'Đang kết nối lại' : 'MQTT ngắt kết nối', clientIsReconnecting ? 'connecting' : 'error');
      return;
    }

    if (!mqttConnected) {
      mqttConnected = true;
      subscribeMqttTopics();
    }

    if (!mqttSubscribed) return;
    if (!state.config.features.heartbeat) {
      setMqttStatus('MQTT đã kết nối', 'online');
      return;
    }
    checkSmartFarmTimeout();

    if (!smartFarmConnected) {
      setMqttStatus(smartFarmLastSeenAt ? 'Mất kết nối Smart Farm' : 'MQTT OK - chờ Smart Farm', 'warning');
    }
  }

  function publishPresenceMessage(payload) {
    if (!mqttClient || !mqttConnected || !mqttSubscribed) return;
    publishChannel('presence', payload);
  }

  function handleSmartFarmPresence(message) {
    const normalized = String(message || '').trim().toUpperCase();

    if (normalized === SMART_FARM_PONG) {
      markSmartFarmOnline();
      return;
    }

    if (normalized === SMART_FARM_PING) {
      return;
    }
  }

  function markSmartFarmOnline() {
    const wasConnected = smartFarmConnected;
    smartFarmConnected = true;
    smartFarmLastSeenAt = Date.now();
    setMqttStatus(state.config.features.heartbeat ? 'Đã kết nối Smart Farm' : 'MQTT đã kết nối', 'online');

    if (!wasConnected) {
      addAlertThrottled('smart-farm-online', 'Smart Farm', 'Đã nhận dữ liệu từ nguồn đã cấu hình.', 'info', 'fa-wifi', 30_000);
      if (Date.now() - smartFarmSyncRequestedAt > SMART_FARM_SYNC_GUARD_MS) {
        sendSmartFarmSyncRequest();
      }
    }
  }

  function checkSmartFarmTimeout() {
    if (!state.config.features.heartbeat || !mqttConnected || !smartFarmLastSeenAt) return;

    if (Date.now() - smartFarmLastSeenAt <= SMART_FARM_TIMEOUT_MS) return;

    if (smartFarmConnected) {
      addAlertThrottled('smart-farm-offline', 'Smart Farm', `Không nhận phản hồi từ ${Config.topics(state.config, 'presence').join(', ')} hoặc dữ liệu cảm biến.`, 'warning', 'fa-plug-circle-xmark', 60_000);
    }

    smartFarmConnected = false;
    setMqttStatus('Mất kết nối Smart Farm', 'warning');
    invalidateEspModeConfirmation();
  }

  function setMqttStatus(label, tone) {
    if (elements.mqttConnectionStatus) {
      elements.mqttConnectionStatus.textContent = label;
    }

    if (elements.mqttStatusChip) {
      elements.mqttStatusChip.classList.toggle('is-online', tone === 'online');
      elements.mqttStatusChip.classList.toggle('is-warning', tone === 'warning');
      elements.mqttStatusChip.classList.toggle('is-error', tone === 'error');
    }

    updateMqttDetail(label);
  }

  function updateMqttDetail(label = '') {
    if (!elements.mqttDetail) return;
    const base = Config.baseTopic(state.config) || '(topic đầy đủ)';
    const prefix = label ? `${label} - ` : '';
    const farmSeen = smartFarmLastSeenAt ? ` - Nhận dữ liệu lúc ${formatTime(smartFarmLastSeenAt)}` : '';
    elements.mqttDetail.textContent = `${prefix}${state.config.username || 'anonymous'} @ ${base}${farmSeen}`;
  }

  function setIotMode(isIotMode, options = {}) {
    if (options.publish !== false && !state.config.configured) return;
    const next = Boolean(isIotMode);
    const changed = state.controls.iotMode !== next;
    state.controls.iotMode = next;
    saveState();
    renderMode();

    if (options.publish !== false) {
      espConfirmedManualMode = null;
      window.clearTimeout(espActivationTimer);
      espActivationState = next || !state.config.features.irrigation ? 'idle' : 'pending';
      renderEspIrrigationMode();
      if (!next && state.config.features.irrigation) {
        espActivationTimer = window.setTimeout(() => {
          if (espActivationState !== 'pending') return;
          espActivationState = 'timeout';
          renderEspIrrigationMode();
        }, 15000);
      }
      publishChannel('mode', next ? '1' : '0');
    }

    if (changed && options.source === 'user') {
      addAlert('Chế độ vận hành', next ? 'Đã chuyển sang IoT thủ công.' : 'Đã chuyển sang ESP tự động.', 'info', 'fa-sliders');
    }
  }

  function ensureIotMode(reason) {
    if (state.controls.iotMode) return;
    setIotMode(true, { source: 'auto' });
    addAlert('Chế độ vận hành', `${reason} cần chế độ IoT thủ công.`, 'warning', 'fa-sliders');
  }

  function setDevice(device, isOn, options = {}) {
    const meta = DEVICE_META[device];
    if (!meta) return;
    if (options.publish !== false && !state.config.configured) return;

    const next = Boolean(isOn);
    const changed = state.controls[device] !== next;
    state.controls[device] = next;
    saveState();
    renderControls();

    if (options.publish !== false) {
      if (device === 'pump' && !next && options.source === 'user') {
        window.clearTimeout(autoPumpTimer);
        autoPumpTimer = null;
        autoPumpStarted = false;
      }
      if (device === 'pump' && next) webPumpOn = true;
      publishChannel(device, next ? state.config.bindings[device].on : state.config.bindings[device].off);
    }

    if (changed) {
      const title = getDeviceActionTitle(device, next);
      const sourceLabel = getDeviceSourceLabel(options.source);
      const timeText = formatTime(new Date());
      addAlert(title, `Lúc ${timeText} qua ${sourceLabel}.`, 'info', meta.icon);
    }
  }

  function setAutomationFlag(key, isEnabled) {
    state.controls[key] = Boolean(isEnabled);
    if (isEnabled) ensureIotMode('Tự động hóa web');
    saveState();
    renderAutomation();
    addAlert('Tự động hóa', `${automationLabel(key)}: ${isEnabled ? 'bật' : 'tắt'}.`, 'info', 'fa-gears');
    runFrontendAutomation('toggle');
  }

  function runFrontendAutomation(source) {
    if (!state.config.configured || !mqttConnected || !mqttSubscribed || !state.controls.iotMode) return;

    const sensors = state.sensors;
    const thresholds = state.thresholds;
    const soilAverage = getSoilAverage();

    if (state.controls.autoLight && Number.isFinite(sensors.light)) {
      if (sensors.light <= thresholds.lightOn && !state.controls.light) {
        setDevice('light', true, { source: 'auto' });
      } else if (sensors.light >= thresholds.lightOff && state.controls.light) {
        setDevice('light', false, { source: 'auto' });
      }
    }

    if (state.controls.autoFan && Number.isFinite(sensors.temperature)) {
      if (sensors.temperature >= thresholds.fanOn && !state.controls.fan) {
        setDevice('fan', true, { source: 'auto' });
      } else if (sensors.temperature <= thresholds.fanOff && state.controls.fan) {
        setDevice('fan', false, { source: 'auto' });
      }
    }

    if (state.controls.autoPump && Number.isFinite(soilAverage)) {
      const now = Date.now();
      if (soilAverage <= thresholds.soilDry && !state.controls.pump && now - lastPumpCycleAt >= PUMP_COOLDOWN_MS) {
        autoPumpStarted = true;
        lastPumpCycleAt = now;
        setDevice('pump', true, { source: 'auto' });

        if (autoPumpTimer) window.clearTimeout(autoPumpTimer);
        autoPumpTimer = window.setTimeout(() => {
          if (autoPumpStarted) {
            setDevice('pump', false, { source: 'auto' });
            autoPumpStarted = false;
          }
          autoPumpTimer = null;
        }, clamp(thresholds.pumpDuration, 1, 60) * 1000);
      }

      if (source !== 'timer' && autoPumpStarted && soilAverage >= thresholds.soilDry + 12) {
        stopAutoPumpCycle();
      }
    }
  }

  function stopAutoPumpCycle() {
    if (autoPumpTimer) {
      window.clearTimeout(autoPumpTimer);
      autoPumpTimer = null;
    }

    if (autoPumpStarted && state.controls.pump) {
      setDevice('pump', false, { source: 'auto' });
    }

    autoPumpStarted = false;
  }

  function updateSensor(name, value, options = {}) {
    if (!Number.isFinite(value)) return;

    state.sensors[name] = normalizeSensorValue(name, value);
    state.sensors.updatedAt = Date.now();
    appendHistoryPoint();
    evaluateSensorAlerts();
    saveState();
    renderSensorCards();
    drawEnvironmentChart();

    if (options.source === 'mqtt') {
      updateMqttDetail('Đã nhận dữ liệu');
    }

    runFrontendAutomation('sensor');
  }

  function evaluateSensorAlerts() {
    const sensors = state.sensors;
    const thresholds = state.thresholds;
    const soilAverage = getSoilAverage();

    if (Number.isFinite(sensors.temperature) && sensors.temperature >= thresholds.fanOn) {
      addAlertThrottled('temp-high', 'Nhiệt độ cao', `Đang ở ${formatNumber(sensors.temperature, 1)}°C.`, 'warning', 'fa-temperature-high');
    }

    if (Number.isFinite(sensors.light) && sensors.light <= thresholds.lightOn) {
      addAlertThrottled('light-low', 'Thiếu ánh sáng', `Cường độ còn ${formatNumber(sensors.light, 0)}%.`, 'warning', 'fa-sun');
    }

    if (Number.isFinite(soilAverage) && soilAverage <= thresholds.soilDry) {
      addAlertThrottled('soil-dry', 'Đất khô', `Độ ẩm đất trung bình ${formatNumber(soilAverage, 0)}%.`, 'warning', 'fa-seedling');
    }
  }

  function appendHistoryPoint() {
    const point = {
      t: Date.now(),
      temperature: state.sensors.temperature,
      humidity: state.sensors.humidity,
      light: state.sensors.light,
      soilAverage: getSoilAverage(),
    };

    const latest = state.history[state.history.length - 1];
    if (latest && point.t - latest.t < 8000) {
      Object.assign(latest, point);
    } else {
      state.history.push(point);
      state.history = state.history.slice(-HISTORY_LIMIT);
    }
  }

  function renderAll() {
    renderSensorCards();
    renderControls();
    renderMode();
    renderAutomation();
    renderThresholdLabels();
    renderCamera();
    renderAlertDateControls();
    renderAlerts();
    drawEnvironmentChart();
    updateMqttDetail();
  }

  function renderSensorCards() {
    const sensors = state.sensors;
    const soilAverage = getSoilAverage();

    renderMetric({
      key: 'temperature',
      valueElement: 'temperatureValue',
      gaugeElement: 'temperatureGauge',
      statusElement: 'temperatureStatus',
      value: sensors.temperature,
      unit: '°C',
      decimals: 1,
      gauge: Number.isFinite(sensors.temperature) ? clamp(((sensors.temperature - 10) / 35) * 100, 0, 100) : 0,
      status: getTemperatureStatus(sensors.temperature),
    });

    renderMetric({
      key: 'humidity',
      valueElement: 'humidityValue',
      gaugeElement: 'humidityGauge',
      statusElement: 'humidityStatus',
      value: sensors.humidity,
      unit: '%',
      decimals: 0,
      gauge: sensors.humidity,
      status: getHumidityStatus(sensors.humidity),
    });

    renderMetric({
      key: 'light',
      valueElement: 'lightValue',
      gaugeElement: 'lightGauge',
      statusElement: 'lightStatus',
      value: sensors.light,
      unit: '%',
      decimals: 0,
      gauge: sensors.light,
      status: getLightStatus(sensors.light),
    });

    renderMetric({
      key: 'soil',
      valueElement: 'soilAverageValue',
      gaugeElement: 'soilGauge',
      statusElement: 'soilStatus',
      value: soilAverage,
      unit: '%',
      decimals: 0,
      gauge: soilAverage,
      status: getSoilStatus(soilAverage),
    });

    setText('soilOneValue', Number.isFinite(sensors.soilOne) ? `${formatNumber(sensors.soilOne, 0)}%` : '--%');
    setText('soilTwoValue', Number.isFinite(sensors.soilTwo) ? `${formatNumber(sensors.soilTwo, 0)}%` : '--%');
    setText('lastUpdatedValue', sensors.updatedAt ? formatRelativeTime(sensors.updatedAt) : '--');
    setText('cropConditionValue', getCropCondition());
  }

  function renderMetric(config) {
    const valueElement = elements[config.valueElement];
    const gaugeElement = elements[config.gaugeElement];
    const statusElement = elements[config.statusElement];
    const card = document.querySelector(`[data-metric="${config.key}"]`);

    if (valueElement) {
      valueElement.innerHTML = Number.isFinite(config.value)
        ? `${formatNumber(config.value, config.decimals)}<span>${config.unit}</span>`
        : `--<span>${config.unit}</span>`;
    }

    if (gaugeElement) {
      gaugeElement.style.width = `${clamp(config.gauge || 0, 0, 100)}%`;
    }

    if (statusElement) {
      statusElement.textContent = config.status.label;
    }

    if (card) {
      card.classList.remove('is-good', 'is-watch', 'is-alert');
      card.classList.add(`is-${config.status.tone}`);
    }
  }

  function renderMode() {
    elements.modeEspAuto?.classList.toggle('is-active', !state.controls.iotMode);
    elements.modeIotManual?.classList.toggle('is-active', state.controls.iotMode);
  }

  function renderControls() {
    Object.entries(DEVICE_META).forEach(([device, meta]) => {
      const isOn = Boolean(state.controls[device]);
      const toggle = elements[meta.toggleId];
      const status = elements[meta.statusId];
      const row = document.querySelector(meta.rowSelector);

      if (toggle && toggle.checked !== isOn) toggle.checked = isOn;
      if (status) status.textContent = isOn ? 'Bật' : 'Tắt';
      row?.classList.toggle('is-on', isOn);
    });
  }

  function renderAutomation() {
    setChecked('autoLightToggle', state.controls.autoLight);
    setChecked('autoPumpToggle', state.controls.autoPump);
    setChecked('autoFanToggle', state.controls.autoFan);
  }

  function renderThresholdLabels() {
    setText('lightOnThresholdValue', `${state.thresholds.lightOn}%`);
    setText('lightOffThresholdValue', `${state.thresholds.lightOff}%`);
    setText('soilDryThresholdValue', `${state.thresholds.soilDry}%`);
    setText('fanOnThresholdValue', `${state.thresholds.fanOn}°C`);
    setText('fanOffThresholdValue', `${state.thresholds.fanOff}°C`);
  }

  function renderCamera(options = {}) {
    const url = String(state.cameraUrl || '').trim();
    const hasUrl = Boolean(url);

    elements.cameraView?.classList.toggle('has-stream', hasUrl);
    if (elements.refreshCameraButton) elements.refreshCameraButton.disabled = !hasUrl;

    if (!hasUrl) {
      clearCameraRetry();
      clearCameraLiveAssume();
      cameraRetryCount = 0;
      appliedCameraUrl = '';
      elements.cameraStream?.removeAttribute('src');
      elements.cameraView?.classList.remove('is-loading', 'is-error');
      setCameraStatus('mock');
      return;
    }

    if (options.forceReload || appliedCameraUrl !== url || !elements.cameraStream?.getAttribute('src')) {
      refreshCameraStream();
      return;
    }

    if (!elements.cameraView?.classList.contains('is-error') && !elements.cameraView?.classList.contains('is-loading')) {
      setCameraStatus('live');
    }
  }

  function refreshCameraStream(options = {}) {
    const url = String(state.cameraUrl || '').trim();
    if (!url) {
      renderCamera();
      return;
    }

    clearCameraRetry();
    clearCameraLiveAssume();
    if (!options.autoRetry) cameraRetryCount = 0;
    appliedCameraUrl = url;
    elements.cameraView?.classList.add('has-stream', 'is-loading');
    elements.cameraView?.classList.remove('is-error');
    setCameraStatus('loading');

    replaceCameraStreamElement(url);
    cameraLiveAssumeTimer = window.setTimeout(() => {
      if (String(state.cameraUrl || '').trim() !== url) return;
      elements.cameraView?.classList.remove('is-loading');
      if (!elements.cameraView?.classList.contains('is-error')) setCameraStatus('live');
    }, 2500);

    if (options.notify) {
      addAlert('Camera', 'Đã làm mới luồng camera.', 'info', 'fa-rotate');
    }
  }

  function scheduleCameraRetry() {
    if (!state.cameraUrl || cameraRetryTimer) return;
    if (cameraRetryCount >= CAMERA_MAX_AUTO_RETRIES) {
      setCameraStatus('error');
      addAlertThrottled('camera-retry-stop', 'Camera', 'Camera vẫn lỗi sau nhiều lần thử lại. Hãy bấm làm mới hoặc tải lại trang nếu cần.', 'warning', 'fa-circle-exclamation', 90_000);
      return;
    }

    cameraRetryCount += 1;
    cameraRetryTimer = window.setTimeout(() => {
      cameraRetryTimer = null;
      refreshCameraStream({ autoRetry: true });
    }, CAMERA_RETRY_DELAY_MS);
  }

  function clearCameraRetry() {
    if (!cameraRetryTimer) return;
    window.clearTimeout(cameraRetryTimer);
    cameraRetryTimer = null;
  }

  function clearCameraLiveAssume() {
    if (!cameraLiveAssumeTimer) return;
    window.clearTimeout(cameraLiveAssumeTimer);
    cameraLiveAssumeTimer = null;
  }

  function replaceCameraStreamElement(url) {
    const currentImage = elements.cameraStream;
    if (!currentImage || !currentImage.parentElement) return;

    const nextImage = document.createElement('img');
    nextImage.id = 'cameraStream';
    nextImage.alt = currentImage.alt || 'Luồng camera nhà vườn';

    currentImage.removeAttribute('src');
    currentImage.replaceWith(nextImage);
    elements.cameraStream = nextImage;
    attachCameraStreamEvents();

    window.setTimeout(() => {
      if (String(state.cameraUrl || '').trim() === url && elements.cameraStream === nextImage) {
        nextImage.src = url;
      }
    }, 80);
  }

  function attachCameraStreamEvents() {
    if (!elements.cameraStream) return;

    elements.cameraStream.addEventListener('load', () => {
      clearCameraRetry();
      clearCameraLiveAssume();
      cameraRetryCount = 0;
      elements.cameraView?.classList.remove('is-loading', 'is-error');
      setCameraStatus('live');
    });

    elements.cameraStream.addEventListener('error', () => {
      clearCameraLiveAssume();
      elements.cameraView?.classList.remove('is-loading');
      elements.cameraView?.classList.add('is-error');
      setCameraStatus('error');
      addAlertThrottled('camera-error', 'Camera', 'Không đọc được luồng camera đã nhập.', 'warning', 'fa-triangle-exclamation', 90_000);
      scheduleCameraRetry();
    });
  }

  function setCameraStatus(status) {
    if (!elements.cameraStatus) return;

    elements.cameraStatus.classList.toggle('is-live', status === 'live' || status === 'loading');
    elements.cameraStatus.classList.toggle('is-error', status === 'error');
    elements.cameraStatus.classList.toggle('is-loading', status === 'loading');

    const labels = {
      mock: 'Mô phỏng',
      loading: 'Đang tải',
      live: 'Đang phát',
      error: 'Lỗi camera',
    };

    setText('cameraStatus', labels[status] || labels.mock);
  }

  function renderAlertDateControls() {
    const dateKey = getSelectedAlertDateKey();
    const todayKey = getDateKey();
    const dayAlerts = getAlertsForDate(dateKey);

    setInputValue('alertDateInput', dateKey);
    if (elements.alertDateInput) {
      elements.alertDateInput.max = todayKey;
    }

    if (elements.alertTodayButton) {
      elements.alertTodayButton.disabled = dateKey === todayKey;
      elements.alertTodayButton.title = `${dayAlerts.length} sự kiện trong ngày đang xem`;
    }

    if (elements.alertNextDayButton) {
      elements.alertNextDayButton.disabled = dateKey >= todayKey;
    }
  }

  function renderAlerts() {
    if (!elements.alertsList) return;

    state.alerts = getAlertsForDate(getSelectedAlertDateKey());
    renderAlertDateControls();

    if (!state.alerts.length) {
      elements.alertsList.innerHTML = '<div class="alert-empty">Không có cảnh báo trong ngày này</div>';
      return;
    }

    elements.alertsList.innerHTML = state.alerts.map((alert) => {
      const alertDateKey = getDateKey(new Date(normalizeTimestamp(alert.t)));
      const ageText = alertDateKey === getDateKey() ? ` · ${formatRelativeTime(alert.t)}` : '';

      return `
        <article class="alert-item" data-level="${escapeHtml(alert.level)}">
          <div class="alert-item__icon"><i class="fa-solid ${escapeHtml(alert.icon)}"></i></div>
          <div>
            <h3>${escapeHtml(alert.title)}</h3>
            <p>${escapeHtml(formatAlertTimestamp(alert.t))} · ${escapeHtml(alert.message)}${escapeHtml(ageText)}</p>
          </div>
        </article>
      `;
    }).join('');
  }

  function drawEnvironmentChart() {
    const canvas = elements.environmentChart;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 640));
    const height = Math.max(210, Math.floor(rect.height || 210));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 20, right: 18, bottom: 30, left: 36 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.fillStyle = '#fbfdfc';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#64748b';

    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(`${100 - i * 25}`, 8, y + 4);
    }

    const points = state.history.filter((point) => point && Number.isFinite(point.t)).slice(-HISTORY_LIMIT);
    if (!points.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chưa có dữ liệu biểu đồ', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }

    const xForIndex = (index) => {
      if (points.length === 1) return padding.left + chartWidth / 2;
      return padding.left + (chartWidth / (points.length - 1)) * index;
    };

    const yForValue = (value) => padding.top + chartHeight - (clamp(value, 0, 100) / 100) * chartHeight;

    CHART_SERIES.forEach((series) => {
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let hasStarted = false;

      points.forEach((point, index) => {
        const raw = point[series.key];
        if (!Number.isFinite(raw)) return;

        const x = xForIndex(index);
        const y = yForValue(series.normalize(raw));
        if (!hasStarted) {
          ctx.moveTo(x, y);
          hasStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      if (hasStarted) ctx.stroke();
    });

    const first = new Date(points[0].t);
    const last = new Date(points[points.length - 1].t);
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(first), padding.left, height - 10);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(last), width - padding.right, height - 10);
    ctx.textAlign = 'left';
  }

  function addAlert(title, message, level = 'info', icon = 'fa-circle-info') {
    const alert = {
      title,
      message,
      level,
      icon,
      t: Date.now(),
    };
    const dateKey = getDateKey(new Date(alert.t));
    const dayAlerts = [alert, ...getAlertsForDate(dateKey)].slice(0, ALERT_LIMIT);

    state.alertsByDate[dateKey] = dayAlerts;
    if (getSelectedAlertDateKey() === dateKey) {
      state.alerts = dayAlerts;
    }

    saveState();
    renderAlerts();
  }

  function addAlertThrottled(key, title, message, level = 'info', icon = 'fa-circle-info', cooldown = SENSOR_ALERT_COOLDOWN_MS) {
    const now = Date.now();
    const last = alertThrottle.get(key) || 0;
    if (now - last < cooldown) return;
    alertThrottle.set(key, now);
    addAlert(title, message, level, icon);
  }

  function simulateSensorData() {
    const previous = state.sensors;
    const next = {
      temperature: randomAround(Number.isFinite(previous.temperature) ? previous.temperature : 28, 2.8, 18, 38),
      humidity: randomAround(Number.isFinite(previous.humidity) ? previous.humidity : 68, 8, 35, 95),
      light: randomAround(Number.isFinite(previous.light) ? previous.light : 56, 18, 5, 100),
      soilOne: randomAround(Number.isFinite(previous.soilOne) ? previous.soilOne : 58, 11, 15, 96),
      soilTwo: randomAround(Number.isFinite(previous.soilTwo) ? previous.soilTwo : 61, 11, 15, 96),
    };

    updateSensor('temperature', next.temperature);
    updateSensor('humidity', next.humidity);
    updateSensor('light', next.light);
    updateSensor('soilOne', next.soilOne);
    updateSensor('soilTwo', next.soilTwo);
  }

  function loadState() {
    let stored = null;
    try {
      const current = window.localStorage.getItem(STORAGE_KEY);
      if (current) {
        stored = JSON.parse(current);
      } else {
        const legacy = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
        if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
          stored = { ...legacy, config: Config.migrate(legacy) };
          // Keep the legacy entry intact; the first successful save persists v2.
        }
      }
    } catch (error) {
      stored = null;
      storageError = true;
    }

    const next = deepMerge(DEFAULT_STATE, stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
    for (const key of ['thresholds', 'controls', 'ui', 'irrigation']) {
      if (!next[key] || typeof next[key] !== 'object' || Array.isArray(next[key])) next[key] = Config.clone(DEFAULT_STATE[key]);
    }
    if (!['moisture', 'schedule'].includes(next.irrigation.mode)
      || !Array.isArray(next.irrigation.days) || !Array.isArray(next.irrigation.slots)
      || next.irrigation.slots.some((slot) => !slot || typeof slot.time !== 'string' || !Number.isInteger(slot.seconds))) {
      next.irrigation = Config.clone(DEFAULT_STATE.irrigation);
    }
    next.config = Config.normalize(next.config);
    if (Object.keys(Config.validate(next.config)).length) next.config.configured = false;
    next.history = Array.isArray(next.history)
      ? next.history.filter((item) => item && Number.isFinite(item.t)).slice(-HISTORY_LIMIT)
      : [];
    const legacyAlerts = normalizeAlertItems(next.alerts);
    next.alertsByDate = normalizeAlertsByDate(next.alertsByDate);
    mergeAlertsIntoDateMap(next.alertsByDate, legacyAlerts);

    next.ui = next.ui && typeof next.ui === 'object' ? next.ui : {};
    next.ui.alertDate = getDateKey();
    next.alerts = getAlertsForDateFromMap(next.alertsByDate, next.ui.alertDate);

    Object.keys(next.thresholds).forEach((key) => {
      next.thresholds[key] = normalizeThreshold(key, next.thresholds[key]);
    });
    syncThresholdBounds(next.thresholds);

    // Persisted readings and switch positions are not live board state.
    next.sensors = Config.clone(DEFAULT_STATE.sensors);
    next.controls.light = next.controls.pump = next.controls.fan = false;
    next.controls.iotMode = false;
    if (typeof next.cameraUrl !== 'string') next.cameraUrl = '';

    return next;
  }

  function saveState() {
    return persistState(state);
  }

  function persistState(candidate) {
    try {
      const compactState = {
        ...candidate,
        history: candidate.history.slice(-HISTORY_LIMIT),
        alerts: candidate.alerts.slice(0, ALERT_LIMIT),
        alertsByDate: compactAlertsByDate(candidate.alertsByDate),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
      return true;
    } catch (error) {
      notifySettings('Không lưu được trên trình duyệt. Kiểm tra quyền lưu trữ hoặc dung lượng bộ nhớ.', true);
      return false;
    }
  }

  function setAlertDate(dateKey) {
    state.ui = state.ui && typeof state.ui === 'object' ? state.ui : {};
    const todayKey = getDateKey();
    const normalized = normalizeDateKey(dateKey) || todayKey;
    state.ui.alertDate = normalized > todayKey ? todayKey : normalized;
    state.alerts = getAlertsForDate(state.ui.alertDate);
    saveState();
    renderAlerts();
  }

  function getSelectedAlertDateKey() {
    state.ui = state.ui && typeof state.ui === 'object' ? state.ui : {};
    if (!normalizeDateKey(state.ui.alertDate)) {
      state.ui.alertDate = getDateKey();
    }
    return state.ui.alertDate;
  }

  function getAlertsForDate(dateKey) {
    return getAlertsForDateFromMap(state.alertsByDate, dateKey);
  }

  function getAlertsForDateFromMap(alertsByDate, dateKey) {
    const key = normalizeDateKey(dateKey) || getDateKey();
    const source = alertsByDate && typeof alertsByDate === 'object' ? alertsByDate[key] : [];
    return normalizeAlertItems(source).slice(0, ALERT_LIMIT);
  }

  function normalizeAlertItems(alerts) {
    if (!Array.isArray(alerts)) return [];

    return alerts
      .filter((alert) => alert && alert.title)
      .map((alert) => ({
        title: String(alert.title || 'Cảnh báo'),
        message: String(alert.message || ''),
        level: String(alert.level || 'info'),
        icon: String(alert.icon || 'fa-circle-info'),
        t: normalizeTimestamp(alert.t),
      }))
      .sort((a, b) => b.t - a.t)
      .slice(0, ALERT_LIMIT);
  }

  function normalizeAlertsByDate(alertsByDate) {
    const output = {};
    if (!alertsByDate || typeof alertsByDate !== 'object' || Array.isArray(alertsByDate)) return output;

    Object.entries(alertsByDate).forEach(([dateKey, alerts]) => {
      const key = normalizeDateKey(dateKey);
      if (!key) return;
      output[key] = normalizeAlertItems(alerts).slice(0, ALERT_LIMIT);
    });

    return output;
  }

  function mergeAlertsIntoDateMap(alertsByDate, alerts) {
    normalizeAlertItems(alerts).forEach((alert) => {
      const dateKey = getDateKey(new Date(alert.t));
      const current = Array.isArray(alertsByDate[dateKey]) ? alertsByDate[dateKey] : [];
      const exists = current.some((item) => (
        item.t === alert.t
        && item.title === alert.title
        && item.message === alert.message
      ));
      if (exists) return;
      alertsByDate[dateKey] = normalizeAlertItems([alert, ...current]).slice(0, ALERT_LIMIT);
    });
  }

  function compactAlertsByDate(alertsByDate) {
    return normalizeAlertsByDate(alertsByDate);
  }

  function normalizeTimestamp(value) {
    if (Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function deepMerge(base, patch) {
    const output = Config.clone(base);
    if (!patch || typeof patch !== 'object') return output;

    Object.entries(patch).forEach(([key, value]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return;
      if (Array.isArray(value)) {
        output[key] = value.slice();
      } else if (value && typeof value === 'object' && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        output[key] = deepMerge(base[key], value);
      } else {
        output[key] = value;
      }
    });

    return output;
  }

  function parseNumericValue(value) {
    return Config.parseNumber(value);
  }

  function parseBinary(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (['1', 'ON', 'TRUE', 'YES', 'BẬT', 'BAT'].includes(normalized)) return true;
    if (['0', 'OFF', 'FALSE', 'NO', 'TẮT', 'TAT'].includes(normalized)) return false;
    return null;
  }

  function normalizeSensorValue(name, value) {
    if (name === 'humidity' || name === 'light' || name === 'soilOne' || name === 'soilTwo') {
      return clamp(value, 0, 100);
    }

    if (name === 'temperature') {
      return clamp(value, -20, 80);
    }

    return value;
  }

  function normalizeThreshold(key, value) {
    const number = Number.parseFloat(value);
    const fallback = DEFAULT_STATE.thresholds[key];
    const next = Number.isFinite(number) ? number : fallback;

    if (key === 'pumpDuration') return Math.round(clamp(next, 1, 60));
    if (key === 'fanOn') return Math.round(clamp(next, 15, 45));
    if (key === 'fanOff') return Math.round(clamp(next, 10, 40));
    return Math.round(clamp(next, 0, 100));
  }

  function syncThresholdBounds(thresholds) {
    if (thresholds.lightOff <= thresholds.lightOn) {
      thresholds.lightOff = Math.min(100, thresholds.lightOn + 5);
      if (thresholds.lightOff === thresholds.lightOn) {
        thresholds.lightOn = Math.max(0, thresholds.lightOff - 5);
      }
    }

    if (thresholds.fanOff >= thresholds.fanOn) {
      thresholds.fanOff = Math.max(10, thresholds.fanOn - 1);
      if (thresholds.fanOff === thresholds.fanOn) {
        thresholds.fanOn = Math.min(45, thresholds.fanOff + 1);
      }
    }
  }

  function hydrateThresholdInputs() {
    setInputValue('lightOnThreshold', state.thresholds.lightOn);
    setInputValue('lightOffThreshold', state.thresholds.lightOff);
    setInputValue('soilDryThreshold', state.thresholds.soilDry);
    setInputValue('pumpDurationSeconds', state.thresholds.pumpDuration);
    setInputValue('fanOnThreshold', state.thresholds.fanOn);
    setInputValue('fanOffThreshold', state.thresholds.fanOff);
    renderThresholdLabels();
  }

  function normalizeNullableNumber(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
  }

  function getSoilAverage() {
    const values = [state.sensors.soilOne, state.sensors.soilTwo].filter(Number.isFinite);
    if (!values.length) return NaN;
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function getTemperatureStatus(value) {
    if (!Number.isFinite(value)) return { label: 'Chưa có dữ liệu', tone: 'watch' };
    if (value >= state.thresholds.fanOn) return { label: 'Nhiệt độ cao', tone: 'alert' };
    if (value <= state.thresholds.fanOff) return { label: 'Đang mát', tone: 'watch' };
    return { label: 'Ổn định', tone: 'good' };
  }

  function getHumidityStatus(value) {
    if (!Number.isFinite(value)) return { label: 'Chưa có dữ liệu', tone: 'watch' };
    if (value < 45) return { label: 'Không khí khô', tone: 'watch' };
    if (value > 85) return { label: 'Độ ẩm cao', tone: 'watch' };
    return { label: 'Phù hợp', tone: 'good' };
  }

  function getLightStatus(value) {
    if (!Number.isFinite(value)) return { label: 'Chưa có dữ liệu', tone: 'watch' };
    if (value <= state.thresholds.lightOn) return { label: 'Thiếu sáng', tone: 'alert' };
    if (value >= state.thresholds.lightOff) return { label: 'Ánh sáng mạnh', tone: 'good' };
    return { label: 'Trung bình', tone: 'good' };
  }

  function getSoilStatus(value) {
    if (!Number.isFinite(value)) return { label: 'Chưa có dữ liệu', tone: 'watch' };
    if (value <= state.thresholds.soilDry) return { label: 'Đất khô', tone: 'alert' };
    if (value >= 82) return { label: 'Đất ẩm nhiều', tone: 'watch' };
    return { label: 'Đủ ẩm', tone: 'good' };
  }

  function getCropCondition() {
    const temp = getTemperatureStatus(state.sensors.temperature);
    const light = getLightStatus(state.sensors.light);
    const soil = getSoilStatus(getSoilAverage());

    if (soil.tone === 'alert') return 'Cần tưới nước';
    if (light.tone === 'alert') return 'Cần bổ sung ánh sáng';
    if (temp.tone === 'alert') return 'Cần làm mát';
    if (temp.label === 'Chưa có dữ liệu' && light.label === 'Chưa có dữ liệu' && soil.label === 'Chưa có dữ liệu') {
      return 'Đang chờ dữ liệu';
    }
    return 'Ổn định';
  }

  function getDeviceActionTitle(device, isOn) {
    const action = isOn ? 'Bật' : 'Tắt';
    const names = {
      light: 'đèn trồng cây',
      pump: 'máy bơm',
      fan: 'quạt điều hòa',
    };
    return `${action} ${names[device] || 'thiết bị'}`;
  }

  function getDeviceSourceLabel(source) {
    if (source === 'auto') return 'tự động hóa web';
    if (source === 'mqtt') return 'ESP32/MQTT';
    return 'IoT';
  }

  function automationLabel(key) {
    return {
      autoLight: 'Đèn theo ánh sáng',
      autoPump: 'Tưới theo độ ẩm đất',
      autoFan: 'Quạt theo nhiệt độ',
    }[key] || key;
  }

  function randomAround(center, spread, min, max) {
    return clamp(center + (Math.random() - 0.5) * spread * 2, min, max);
  }

  function clamp(value, min, max) {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function formatNumber(value, decimals = 0) {
    if (!Number.isFinite(value)) return '--';
    return new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  }

  function formatAlertTimestamp(timestamp) {
    const date = new Date(normalizeTimestamp(timestamp));
    const prefix = getDateKey(date) === getDateKey()
      ? 'Hôm nay'
      : formatDateLabel(date);
    return `${prefix} lúc ${formatTime(date)}`;
  }

  function formatDateLabel(date) {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function getDateKey(dateInput = new Date()) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (!Number.isFinite(date.getTime())) return getDateKey(new Date());

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeDateKey(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const date = parseDateKey(text);
      return Number.isFinite(date.getTime()) && getDateKey(date) === text ? text : '';
    }

    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? getDateKey(parsed) : '';
  }

  function parseDateKey(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) return new Date(Number.NaN);
    return new Date(year, month - 1, day);
  }

  function shiftDateKey(dateKey, days) {
    const date = parseDateKey(normalizeDateKey(dateKey) || getDateKey());
    date.setDate(date.getDate() + days);
    return getDateKey(date);
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '--';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 5) return 'vừa xong';
    if (seconds < 60) return `${seconds} giây trước`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;
    return formatTime(new Date(timestamp));
  }

  function updateClock() {
    const now = new Date();
    const time = formatTime(now);
    setText('clockValue', time);
    setText('cameraTimestamp', time);
    if (state.sensors.updatedAt) {
      setText('lastUpdatedValue', formatRelativeTime(state.sensors.updatedAt));
    }
    renderAlerts();
  }

  function setInputValue(id, value) {
    if (elements[id]) elements[id].value = value ?? '';
  }

  function setChecked(id, checked) {
    if (elements[id]) elements[id].checked = Boolean(checked);
  }

  function setText(id, value) {
    if (elements[id]) elements[id].textContent = value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
