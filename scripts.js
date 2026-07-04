(() => {
  'use strict';

  const STORAGE_KEY = 'mekongstem.smart-farm.dashboard.v1';

  const CHANNELS = {
    temperature: 'V1',
    humidity: 'V2',
    soilOne: 'V3',
    soilTwo: 'V4',
    lightSensor: 'V5',
    light: 'V6',
    pump: 'V7',
    fan: 'V8',
    mode: 'V9',
    presence: 'V10',
  };

  const RULE_PARAMETER_CHANNELS = {
    // V11 matches the Scratch receiver; V12 keeps compatibility with esp32_scratch_mqtt.py.
    lightOn: ['V11', 'V12'],
    lightOff: ['V13'],
    soilDry: ['V14'],
    pumpDuration: ['V15'],
    fanOn: ['V16'],
    fanOff: ['V17'],
  };

  const SENSOR_BY_CHANNEL = {
    V1: 'temperature',
    V2: 'humidity',
    V3: 'soilOne',
    V4: 'soilTwo',
    V5: 'light',
  };

  const DEVICE_BY_CHANNEL = {
    V6: 'light',
    V7: 'pump',
    V8: 'fan',
  };

  const DEVICE_META = {
    light: {
      label: 'Đèn trồng cây',
      channel: CHANNELS.light,
      toggleId: 'lightToggle',
      statusId: 'lightControlStatus',
      rowSelector: '[data-device="light"]',
      icon: 'fa-lightbulb',
    },
    pump: {
      label: 'Bơm tưới nước',
      channel: CHANNELS.pump,
      toggleId: 'pumpToggle',
      statusId: 'pumpControlStatus',
      rowSelector: '[data-device="pump"]',
      icon: 'fa-faucet-drip',
    },
    fan: {
      label: 'Quạt điều hòa',
      channel: CHANNELS.fan,
      toggleId: 'fanToggle',
      statusId: 'fanControlStatus',
      rowSelector: '[data-device="fan"]',
      icon: 'fa-fan',
    },
  };

  const DEFAULT_STATE = {
    config: {
      url: 'wss://mqtt.ohstem.vn:8084/mqtt',
      username: 'greenhouse_BNG',
      password: '',
      baseTopic: 'greenhouse_BNG/feeds',
    },
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
    cameraUrl: 'http://192.168.1.4:81/stream',
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
  const SMART_FARM_HEARTBEAT_MS = 5000;
  const SMART_FARM_TIMEOUT_MS = 15000;
  const CAMERA_RETRY_DELAY_MS = 5000;

  let state = loadState();
  let elements = {};
  let mqttClient = null;
  let mqttConnected = false;
  let smartFarmConnected = false;
  let smartFarmLastSeenAt = 0;
  let smartFarmHeartbeatTimer = null;
  let pendingMessages = [];
  let alertThrottle = new Map();
  let autoPumpTimer = null;
  let autoPumpStarted = false;
  let lastPumpCycleAt = 0;
  let cameraRetryTimer = null;
  let cameraRefreshToken = Date.now();
  let appliedCameraUrl = '';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    hydrateInputs();
    bindEvents();
    renderAll();
    updateClock();
    connectMqtt();

    window.setInterval(updateClock, 1000);
    window.setInterval(() => runFrontendAutomation('timer'), 4000);
    window.addEventListener('resize', drawEnvironmentChart);
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
      'cameraUrlInput',
      'saveCameraUrlButton',
      'refreshCameraButton',
      'clearCameraUrlButton',
      'mqttUrlInput',
      'mqttUsernameInput',
      'mqttPasswordInput',
      'mqttBaseTopicInput',
      'saveMqttConfigButton',
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
    setInputValue('mqttUrlInput', state.config.url);
    setInputValue('mqttUsernameInput', state.config.username);
    setInputValue('mqttPasswordInput', state.config.password);
    setInputValue('mqttBaseTopicInput', state.config.baseTopic);

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
    setInputValue('cameraUrlInput', state.cameraUrl);
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

    elements.saveCameraUrlButton?.addEventListener('click', () => {
      state.cameraUrl = String(elements.cameraUrlInput?.value || '').trim();
      saveState();
      renderCamera({ forceReload: true });
      addAlert('Camera', state.cameraUrl ? 'Đã cập nhật luồng camera từ xa.' : 'Đang dùng khung mô phỏng camera.', 'info', 'fa-video');
    });

    elements.refreshCameraButton?.addEventListener('click', () => {
      refreshCameraStream({ notify: true });
    });

    elements.clearCameraUrlButton?.addEventListener('click', () => {
      state.cameraUrl = '';
      setInputValue('cameraUrlInput', '');
      saveState();
      renderCamera();
    });

    elements.cameraStream?.addEventListener('load', () => {
      clearCameraRetry();
      elements.cameraView?.classList.remove('is-loading', 'is-error');
      setCameraStatus('live');
    });

    elements.cameraStream?.addEventListener('error', () => {
      elements.cameraView?.classList.remove('is-loading');
      elements.cameraView?.classList.add('is-error');
      setCameraStatus('error');
      addAlertThrottled('camera-error', 'Camera', 'Không đọc được luồng camera đã nhập.', 'warning', 'fa-triangle-exclamation', 90_000);
      scheduleCameraRetry();
    });

    elements.saveMqttConfigButton?.addEventListener('click', () => {
      state.config = {
        url: String(elements.mqttUrlInput?.value || DEFAULT_STATE.config.url).trim(),
        username: String(elements.mqttUsernameInput?.value || '').trim(),
        password: String(elements.mqttPasswordInput?.value || ''),
        baseTopic: normalizeBaseTopic(elements.mqttBaseTopicInput?.value || ''),
      };
      saveState();
      reconnectMqtt();
    });

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
      publishRuleParameters();
    });

    input.addEventListener('change', () => {
      state.thresholds[key] = normalizeThreshold(key, input.value);
      syncThresholdBounds(state.thresholds);
      hydrateThresholdInputs();
      saveState();
      publishRuleParameters();
      renderSensorCards();
      runFrontendAutomation('threshold');
    });
  }

  function connectMqtt() {
    if (mqttClient || mqttConnected) return;

    if (typeof mqtt === 'undefined') {
      setMqttStatus('Thiếu thư viện MQTT', 'error');
      return;
    }

    setMqttStatus('Đang kết nối MQTT', 'connecting');

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

    mqttClient.on('connect', () => {
      mqttConnected = true;
      smartFarmConnected = false;
      smartFarmLastSeenAt = 0;
      setMqttStatus('MQTT OK - kiểm tra Smart Farm', 'warning');
      subscribeMqttTopics();
      flushPendingMessages();
      publishRuleParameters();
    });

    mqttClient.on('reconnect', () => {
      mqttConnected = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      setMqttStatus('Đang kết nối lại', 'connecting');
    });

    mqttClient.on('close', () => {
      mqttConnected = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      if (mqttClient) {
        setMqttStatus('MQTT ngắt kết nối', 'error');
      }
    });

    mqttClient.on('error', (error) => {
      setMqttStatus('Lỗi MQTT', 'error');
      addAlertThrottled('mqtt-error', 'MQTT', error.message || 'Broker trả về lỗi kết nối.', 'danger', 'fa-plug-circle-xmark', 60_000);
    });

    mqttClient.on('message', handleMqttMessage);
  }

  function reconnectMqtt() {
    if (mqttClient) {
      const client = mqttClient;
      mqttClient = null;
      mqttConnected = false;
      smartFarmConnected = false;
      stopSmartFarmHeartbeat();
      client.end(true);
    }

    window.setTimeout(connectMqtt, 120);
  }

  function subscribeMqttTopics() {
    if (!mqttClient || !mqttConnected) return;

    const topics = new Set();
    Object.values(CHANNELS).forEach((channel) => {
      topicCandidates(channel).forEach((topic) => topics.add(topic));
    });

    mqttClient.subscribe(Array.from(topics), { qos: 0 }, (error) => {
      if (error) {
        setMqttStatus('Lỗi nghe topic', 'error');
        addAlert('MQTT', error.message || 'Không thể subscribe topic.', 'danger', 'fa-triangle-exclamation');
        return;
      }

      updateMqttDetail();
      setMqttStatus('MQTT OK - chờ Smart Farm', 'warning');
      startSmartFarmHeartbeat();
      addAlertThrottled('mqtt-online', 'MQTT', 'Đã sẵn sàng nhận dữ liệu Smart Farm.', 'info', 'fa-wifi', 30_000);
    });
  }

  function handleMqttMessage(topic, payload) {
    const message = payload.toString().trim();
    const channel = extractChannel(topic);

    if (channel === CHANNELS.presence) {
      handleSmartFarmPresence(message);
      return;
    }

    if (SENSOR_BY_CHANNEL[channel]) {
      updateSensor(SENSOR_BY_CHANNEL[channel], parseNumericValue(message), { source: 'mqtt' });
      return;
    }

    if (DEVICE_BY_CHANNEL[channel]) {
      const stateValue = parseBinary(message);
      if (stateValue !== null) {
        setDevice(DEVICE_BY_CHANNEL[channel], stateValue, { source: 'mqtt', publish: false });
      }
      return;
    }

    if (channel === CHANNELS.mode) {
      const iotMode = parseBinary(message);
      if (iotMode !== null) {
        state.controls.iotMode = iotMode;
        saveState();
        renderMode();
      }
    }
  }

  function publishChannel(channel, payload) {
    const topic = mqttTopic(channel);
    const message = String(payload);

    if (!mqttClient || !mqttConnected) {
      pendingMessages = pendingMessages.filter((item) => item.channel !== channel);
      pendingMessages.push({ channel, topic, message });
      setMqttStatus('Đợi MQTT để gửi lệnh', 'connecting');
      return;
    }

    mqttClient.publish(topic, message, { qos: 0, retain: false }, (error) => {
      if (error) {
        addAlert('MQTT', `Không gửi được ${channel}: ${error.message}`, 'danger', 'fa-triangle-exclamation');
      }
    });
  }

  function flushPendingMessages() {
    const messages = pendingMessages.slice();
    pendingMessages = [];
    messages.forEach((item) => publishChannel(item.channel, item.message));
  }

  function publishRuleParameters() {
    Object.entries(RULE_PARAMETER_CHANNELS).forEach(([key, channels]) => {
      const value = normalizeThreshold(key, state.thresholds[key]);
      channels.forEach((channel) => publishChannel(channel, value));
    });
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
    if (!mqttClient || !mqttConnected) return;

    checkSmartFarmTimeout();
    if (!smartFarmConnected) {
      setMqttStatus(smartFarmLastSeenAt ? 'Mất kết nối Smart Farm' : 'MQTT OK - chờ Smart Farm', 'warning');
    }

    publishPresenceMessage(SMART_FARM_PING);
  }

  function publishPresenceMessage(payload) {
    if (!mqttClient || !mqttConnected) return;

    Array.from(new Set(topicCandidates(CHANNELS.presence))).forEach((topic) => {
      mqttClient.publish(topic, payload, { qos: 0, retain: false }, (error) => {
        if (error) {
          addAlertThrottled('smart-farm-ping-error', 'Smart Farm', `Không gửi được V10: ${error.message}`, 'warning', 'fa-triangle-exclamation', 60_000);
        }
      });
    });
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
    setMqttStatus('Đã kết nối Smart Farm', 'online');

    if (!wasConnected) {
      addAlertThrottled('smart-farm-online', 'Smart Farm', 'ESP32/Scratch đã phản hồi HERE qua V10.', 'info', 'fa-wifi', 30_000);
      publishRuleParameters();
    }
  }

  function checkSmartFarmTimeout() {
    if (!mqttConnected || !smartFarmLastSeenAt) return;

    if (Date.now() - smartFarmLastSeenAt <= SMART_FARM_TIMEOUT_MS) return;

    if (smartFarmConnected) {
      addAlertThrottled('smart-farm-offline', 'Smart Farm', 'Không nhận phản hồi HERE từ V10.', 'warning', 'fa-plug-circle-xmark', 60_000);
    }

    smartFarmConnected = false;
    setMqttStatus('Mất kết nối Smart Farm', 'warning');
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
    const base = normalizeBaseTopic(state.config.baseTopic) || '(raw V1-V10)';
    const prefix = label ? `${label} - ` : '';
    const farmSeen = smartFarmLastSeenAt ? ` - HERE lúc ${formatTime(smartFarmLastSeenAt)}` : '';
    elements.mqttDetail.textContent = `${prefix}${state.config.username || 'anonymous'} @ ${base}${farmSeen}`;
  }

  function setIotMode(isIotMode, options = {}) {
    const next = Boolean(isIotMode);
    const changed = state.controls.iotMode !== next;
    state.controls.iotMode = next;
    saveState();
    renderMode();

    if (options.publish !== false) {
      publishChannel(CHANNELS.mode, next ? '1' : '0');
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

    const next = Boolean(isOn);
    const changed = state.controls[device] !== next;
    state.controls[device] = next;
    saveState();
    renderControls();

    if (options.publish !== false) {
      publishChannel(meta.channel, next ? '1' : '0');
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
    if (!state.controls.iotMode) return;

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
    appliedCameraUrl = url;
    cameraRefreshToken = Date.now();
    elements.cameraView?.classList.add('has-stream', 'is-loading');
    elements.cameraView?.classList.remove('is-error');
    setCameraStatus('loading');

    if (elements.cameraStream) {
      const nextSrc = buildCameraStreamUrl(url, cameraRefreshToken);
      elements.cameraStream.removeAttribute('src');
      window.setTimeout(() => {
        if (String(state.cameraUrl || '').trim() === url) {
          elements.cameraStream.src = nextSrc;
        }
      }, 80);
    }

    if (options.notify) {
      addAlert('Camera', 'Đã làm mới luồng camera.', 'info', 'fa-rotate');
    }
  }

  function scheduleCameraRetry() {
    if (!state.cameraUrl || cameraRetryTimer) return;
    cameraRetryTimer = window.setTimeout(() => {
      cameraRetryTimer = null;
      refreshCameraStream();
    }, CAMERA_RETRY_DELAY_MS);
  }

  function clearCameraRetry() {
    if (!cameraRetryTimer) return;
    window.clearTimeout(cameraRetryTimer);
    cameraRetryTimer = null;
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

  function buildCameraStreamUrl(url, token) {
    try {
      const streamUrl = new URL(url, window.location.href);
      streamUrl.searchParams.set('_refresh', token);
      return streamUrl.toString();
    } catch (error) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}_refresh=${encodeURIComponent(token)}`;
    }
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
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      stored = null;
    }

    const next = deepMerge(DEFAULT_STATE, stored || {});
    next.config.baseTopic = normalizeBaseTopic(next.config.baseTopic);
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

    Object.keys(next.sensors).forEach((key) => {
      if (key === 'updatedAt') return;
      next.sensors[key] = normalizeNullableNumber(next.sensors[key]);
    });

    return next;
  }

  function saveState() {
    try {
      const compactState = {
        ...state,
        history: state.history.slice(-HISTORY_LIMIT),
        alerts: state.alerts.slice(0, ALERT_LIMIT),
        alertsByDate: compactAlertsByDate(state.alertsByDate),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
    } catch (error) {
      // Local storage can be unavailable in restricted browser contexts.
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
    const output = Array.isArray(base) ? base.slice() : { ...base };
    if (!patch || typeof patch !== 'object') return output;

    Object.entries(patch).forEach(([key, value]) => {
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

  function mqttTopic(channel) {
    const base = normalizeBaseTopic(state.config.baseTopic);
    return base ? `${base}/${channel}` : channel;
  }

  function topicCandidates(channel) {
    const primary = mqttTopic(channel);
    return primary === channel ? [channel] : [primary, channel];
  }

  function extractChannel(topic) {
    return String(topic || '').split('/').pop().toUpperCase();
  }

  function normalizeBaseTopic(topic) {
    return String(topic || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function parseNumericValue(value) {
    const normalized = String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
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
