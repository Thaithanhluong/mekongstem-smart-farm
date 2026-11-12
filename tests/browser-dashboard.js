// Run against a local HTTP server:
// playwright-cli -s=farm-config run-code --filename=tests/browser-dashboard.js
async (page) => {
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://unpkg.com/mqtt/dist/mqtt.min.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: `
      window.__mqttClients = [];
      window.mqtt = { connect(url, options) {
        const client = { url, options, connected: true, publications: [], handlers: {}, topics: [],
          on(name, fn) { (this.handlers[name] ||= []).push(fn); },
          emit(name, ...args) { (this.handlers[name] || []).forEach(fn => fn(...args)); },
          subscribe(topics, options, callback) { this.topics = topics; setTimeout(() => callback(null, topics.map(topic => ({ topic, qos: 0 }))), 0); },
          publish(topic, message, options, callback) { this.publications.push({ topic, message }); callback?.(null); },
          end() { this.connected = false; this.emit('close'); }
        };
        window.__mqttClients.push(client);
        setTimeout(() => client.emit('connect'), 0);
        return client;
      }};`,
  }));
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__mqttClients && !!document.querySelector('[data-settings="connection"]'));
  check(await page.evaluate(() => window.__mqttClients.length === 0), 'Fresh visit does not connect');
  const shortcut = page.locator('.header-status [data-settings="connection"]');
  const dialog = page.locator('#settingsDialog');
  const save = () => page.locator('#settingsForm button[type="submit"]').click();
  const cancel = () => page.locator('#cancelSettings').click();
  await shortcut.click();
  await page.locator('[data-config="username"]').fill('cancelled_farm');
  await cancel();
  await shortcut.click();
  check(await page.locator('[data-config="username"]').inputValue() === '', 'Cancel discards connection draft');
  await page.keyboard.press('Escape');
  check(!(await dialog.isVisible()), 'Escape closes modal');
  check(await shortcut.evaluate((el) => document.activeElement === el), 'Modal returns focus to trigger');
  await shortcut.click();
  await save();
  check(await page.locator('[data-config="username"]').getAttribute('aria-invalid') === 'true', 'Required username error appears at input');
  await page.locator('[data-config="username"]').fill('ui_farm');
  check(await page.locator('[data-config="baseTopic"]').inputValue() === 'ui_farm/feeds', 'OhStem base topic follows username');
  await save();
  await page.waitForFunction(() => window.__mqttClients.length === 1);
  check(await page.evaluate(() => window.__mqttClients[0].publications.length === 0), 'Basic Scratch sends no advanced protocol messages');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('mekongstem.smart-farm.dashboard.v2')).config.username === 'ui_farm'), 'Configuration persists');

  await page.locator('.sensors-panel > summary').click();
  await page.locator('[data-metric="temperature"] [data-settings]').click();
  check(await page.locator('.sensors-panel').evaluate((el) => el.open), 'Gear does not collapse details');
  await page.locator('[data-ref="temperature"] [data-ref-value]').fill('V2');
  await save();
  check(await page.locator('[data-error-for="bindings.temperature.0"]').textContent() !== '', 'Duplicate topic is rejected');
  await page.locator('[data-ref="temperature"] [data-ref-kind]').selectOption('topic');
  await page.locator('[data-ref="temperature"] [data-ref-value]').fill('Farm/Custom/TEMP');
  check((await page.locator('[data-preview="temperature"]').textContent()).includes('Farm/Custom/TEMP'), 'Full topic preview is exact');
  await save();
  await page.waitForFunction(() => window.__mqttClients.length === 2);
  await page.evaluate(() => {
    const old = window.__mqttClients[0], current = window.__mqttClients[1];
    old.emit('message', 'Farm/Custom/TEMP', '99');
    current.emit('message', 'Farm/Custom/TEMP', '27.5');
    current.emit('message', 'farm/custom/temp', '60');
    current.emit('message', 'other/feeds/V1', '70');
  });
  check((await page.locator('#temperatureValue').textContent()).includes('27,5'), 'Only matching full topic updates sensor');

  await page.locator('.environment-panel > summary').click();
  await page.locator('.sensor-row [data-settings="soilOne"]').click();
  await page.locator('[data-ref="soilOne"] [data-ref-value]').fill('V21');
  await save();
  await page.locator('[data-metric="soil"] [data-settings]').click();
  check(await page.locator('[data-ref="soilOne"] [data-ref-value]').inputValue() === 'V21', 'Soil and environment share a binding');
  await cancel();

  await page.locator('.controls-panel > summary').click();
  await page.locator('[data-device="pump"] [data-settings]').click();
  await page.locator('[data-payload="pump"][data-command="on"]').fill('RUN');
  await page.locator('[data-payload="pump"][data-command="off"]').fill('RUN');
  await save();
  check((await page.locator('[data-error-for="payload.pump"]').textContent()).length > 0, 'Identical command values are rejected');
  await page.locator('[data-payload="pump"][data-command="off"]').fill('STOP');
  await save();
  await page.locator('[data-device="pump"] .switch').click();
  check(await page.evaluate(() => window.__mqttClients.at(-1).publications.some((p) => p.topic === 'ui_farm/feeds/V7' && p.message === 'RUN')), 'Toggle sends configured RUN command');
  await shortcut.click();
  await page.locator('[data-config="username"]').fill('new_farm');
  await save();
  check((await page.locator('#settingsError').textContent()).includes('Tắt bơm'), 'Changing routes while web pump is on is blocked');
  await cancel();
  await page.locator('[data-device="pump"] .switch').click();
  check(await page.evaluate(() => window.__mqttClients.at(-1).publications.at(-1).message === 'STOP'), 'Pump stops through old topic');

  // All gear groups must open correctly and native dialog must contain keyboard focus.
  await page.evaluate(() => document.querySelectorAll('details').forEach((el) => { el.open = true; }));
  const groups = await page.locator('.dashboard-shell [data-settings]').evaluateAll((els) => [...new Set(els.map((el) => el.dataset.settings))]);
  for (const group of groups) {
    await page.locator(`.dashboard-shell [data-settings="${group}"]`).first().click();
    check(await dialog.isVisible(), `Settings group opens: ${group}`);
    await page.locator('#settingsForm button[type="submit"]').focus();
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.getElementById('settingsDialog').contains(document.activeElement)), `Focus remains inside: ${group}`);
    await cancel();
  }

  await page.locator('[data-settings="ruleLight"]').click();
  await page.locator('[data-add-alias="lightOn"]').click();
  await page.locator('[data-ref="lightOn"][data-index="1"] [data-ref-value]').fill('V11');
  await save();
  await page.waitForFunction(() => window.__mqttClients.at(-1).topics.includes('ui_farm/feeds/V11'));
  await page.locator('#lightOnThreshold').focus();
  await page.keyboard.press('ArrowLeft');
  check(await page.evaluate(() => ['ui_farm/feeds/V12', 'ui_farm/feeds/V11'].every((topic) => window.__mqttClients.at(-1).publications.some((p) => p.topic === topic))), 'Explicit compatibility alias sends both configured threshold topics');
  await page.locator('[data-settings="ruleLight"]').click();
  await page.locator('[data-remove-alias="lightOn"]').click();
  await save();
  await page.waitForFunction(() => !window.__mqttClients.at(-1).topics.includes('ui_farm/feeds/V11'));
  check(await page.evaluate(() => !JSON.parse(localStorage.getItem('mekongstem.smart-farm.dashboard.v2')).config.bindings.lightOn.aliases.length), 'Removing alias removes subscription and persisted mapping');

  await shortcut.click();
  await page.locator('[data-config="username"]').fill('must_not_apply');
  const clientsBeforeFailure = await page.evaluate(() => window.__mqttClients.length);
  await page.evaluate(() => {
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota simulation'); };
  });
  await save();
  check(await dialog.isVisible() && (await page.locator('#settingsError').textContent()).includes('Không lưu được'), 'Storage failure keeps draft open and reports error');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('mekongstem.smart-farm.dashboard.v2')).config.username) === 'ui_farm', 'Storage failure keeps old persisted configuration');
  check(await page.evaluate(() => window.__mqttClients.length) === clientsBeforeFailure, 'Storage failure leaves live connection unchanged');
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
  await cancel();

  await page.locator('.camera-panel [data-settings="camera"]').click();
  await page.locator('[data-camera]').fill('javascript:alert(1)');
  await save();
  check((await page.locator('[data-error-for="cameraUrl"]').textContent()).length > 0, 'Invalid camera URL is rejected');
  await cancel();

  await shortcut.click();
  await page.locator('[data-feature="heartbeat"]').check();
  await page.locator('[data-feature="sync"]').check();
  await page.locator('[data-feature="irrigation"]').check();
  await save();
  await page.waitForFunction(() => window.__mqttClients.at(-1).publications.some((p) => p.message === 'SYNC_REQUEST'));
  check(await page.locator('#irrigationForm button[type="submit"]').isEnabled(), 'Irrigation opt-in enables form');
  await page.locator('#irrigationForm button[type="submit"]').click();
  check(await page.evaluate(() => window.__mqttClients.at(-1).publications.some((p) => p.topic === 'ui_farm/feeds/V18')), 'Irrigation publishes configured JSON binding');
  await page.evaluate(() => {
    window.__mqttClients.at(-1).emit('message', 'ui_farm/feeds/V19', JSON.stringify({ config: { mode: 'schedule', days: [0], slots: [null] } }));
    const state = JSON.parse(localStorage.getItem('mekongstem.smart-farm.dashboard.v2'));
    window.__mqttClients.at(-1).emit('message', 'ui_farm/feeds/V19', JSON.stringify({ config: state.irrigation, manual_mode: false, clock_ready: true }));
  });
  check((await page.locator('#activateEspIrrigation').textContent()).includes('đã bật'), 'Board status confirms automatic irrigation');
  await shortcut.click();
  await page.locator('[data-feature="heartbeat"]').uncheck();
  await page.locator('[data-feature="sync"]').uncheck();
  await page.locator('[data-feature="irrigation"]').uncheck();
  await save();

  await page.setViewportSize({ width: 390, height: 844 });
  await shortcut.click();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page has no horizontal overflow');
  check(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Mobile modal has no horizontal overflow');
  check(await page.locator('#settingsForm button[type="submit"]').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }), 'Mobile save button stays fully visible');
  await page.screenshot({ path: '.playwright-cli/settings-mobile.png' });
  await cancel();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '.playwright-cli/dashboard-desktop.png', fullPage: true });
  await page.reload();
  await shortcut.click();
  check(await page.locator('[data-config="username"]').inputValue() === 'ui_farm', 'Reload restores saved connection');
  await cancel();
  check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
  return { passed: checks.length, checks };
}
