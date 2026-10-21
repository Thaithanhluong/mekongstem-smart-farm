from lcd1602 import *
from relay_4chs import *
from mqtt_as import MQTTClient, config
from yolo_uno import *
from dht20 import *
from pins import *
import json
import time
import os

try:
  import ntptime
except ImportError:
  ntptime = None

cfg = config.copy()
lcd_dang_hien_thi_che_do = False
IRRIGATION_FILE = 'irrigation.json'
irrigation = {'mode': 'moisture', 'days': [0, 1, 2, 3, 4, 5, 6], 'slots': []}
clock_ready = False
watering_deadline = None
watering_mode = None
schedule_date = None
schedule_done = []

def validate_irrigation(value):
  if not isinstance(value, dict) or value.get('mode') not in ('moisture', 'schedule'):
    raise ValueError('Invalid watering mode')
  days = value.get('days', [])
  slots = value.get('slots', [])
  if not isinstance(days, list) or not days or any(type(day) != int or day < 0 or day > 6 for day in days):
    raise ValueError('Select watering days')
  if not isinstance(slots, list) or len(slots) > 32:
    raise ValueError('Maximum 32 watering times')
  result = []
  seen = []
  for slot in slots:
    hour = slot.get('time', '')
    seconds = slot.get('seconds')
    if not isinstance(hour, str) or len(hour) != 5 or hour[2] != ':' or not hour[:2].isdigit() or not hour[3:].isdigit():
      raise ValueError('Invalid watering time')
    if int(hour[:2]) > 23 or int(hour[3:]) > 59 or hour in seen:
      raise ValueError('Invalid or duplicate watering time')
    if type(seconds) != int or seconds < 1 or seconds > 3600:
      raise ValueError('Duration must be 1-3600 seconds')
    seen.append(hour)
    result.append({'time': hour, 'seconds': seconds})
  if value['mode'] == 'schedule' and not result:
    raise ValueError('Add a watering time')
  return {'mode': value['mode'], 'days': sorted(set(days)), 'slots': result}

def save_irrigation(value):
  # Write a complete replacement before replacing the previous configuration.
  with open(IRRIGATION_FILE + '.tmp', 'w') as target:
    target.write(json.dumps(value))
  os.rename(IRRIGATION_FILE + '.tmp', IRRIGATION_FILE)

def load_irrigation():
  global irrigation
  try:
    with open(IRRIGATION_FILE) as source:
      irrigation = validate_irrigation(json.loads(source.read()))
  except (OSError, ValueError, TypeError, AttributeError):
    pass

async def publish_irrigation_status(error=None):
  await mqtt_client.publish('V19', json.dumps({'config': irrigation, 'clock_ready': clock_ready, 'error': error}))

async def on_mqtt_msg_V20(topic, msg):
  global clock_ready
  try:
    import machine
    timestamp = int(msg)
    if timestamp < 1704067200 or timestamp > 4102444800:
      raise ValueError('Invalid clock')
    if time.gmtime(0)[0] == 2000:
      timestamp -= 946684800
    now = time.gmtime(timestamp)
    machine.RTC().datetime((now[0], now[1], now[2], now[6] + 1, now[3], now[4], now[5], 0))
    clock_ready = True
  except (ValueError, TypeError, ImportError) as error:
    print('Web clock:', error)
  await publish_irrigation_status()

async def on_mqtt_msg_V18(topic, msg):
  global irrigation
  try:
    updated = validate_irrigation(json.loads(msg))
    save_irrigation(updated)
    irrigation = updated
  except (OSError, ValueError, TypeError, AttributeError) as error:
    await publish_irrigation_status(str(error))
    return
  await publish_irrigation_status()

async def publish_pump_state():
  # Network delays must never delay the pump's stop deadline.
  try:
    await mqtt_client.publish('V7', bool_payload(bom_IoT))
  except Exception as error:
    print('Pump MQTT:', error)

def stop_automatic_watering():
  global watering_deadline, watering_mode, bom_IoT
  relay.set_relay(1, 0)
  bom_IoT = False
  watering_deadline = None
  watering_mode = None
  create_task(publish_pump_state())

def start_automatic_watering(seconds):
  global watering_deadline, watering_mode, bom_IoT
  watering_deadline = time.ticks_add(time.ticks_ms(), int(seconds * 1000))
  watering_mode = irrigation['mode']
  relay.set_relay(1, 1)
  bom_IoT = True
  create_task(publish_pump_state())

def scheduled_watering_seconds(now):
  global schedule_date, schedule_done
  date = (now[0], now[1], now[2])
  if schedule_date != date:
    schedule_date = date
    schedule_done = []
  if now[6] not in irrigation['days']:
    return None
  current = '%02d:%02d' % (now[3], now[4])
  for slot in irrigation['slots']:
    if slot['time'] == current and current not in schedule_done:
      schedule_done.append(current)
      return slot['seconds']
  return None

async def task_automatic_watering():
  # Runs independently from MQTT publishing, LCD updates, fan and light control.
  last_moisture_check = time.ticks_ms()
  while True:
    if watering_deadline is not None:
      if manual_mode or watering_mode != irrigation['mode'] or time.ticks_diff(time.ticks_ms(), watering_deadline) >= 0:
        stop_automatic_watering()
    if not manual_mode:
      if irrigation['mode'] == 'schedule' and clock_ready:
        seconds = scheduled_watering_seconds(time.gmtime(time.time() + 7 * 3600))
        if seconds is not None and watering_deadline is None and not bom_IoT:
          start_automatic_watering(seconds)
      elif irrigation['mode'] == 'moisture' and time.ticks_diff(time.ticks_ms(), last_moisture_check) >= 10000:
        last_moisture_check = time.ticks_ms()
        if watering_deadline is None and not bom_IoT and Do_am_dat_1 is not None and Do_am_dat_2 is not None:
          if Do_am_dat_1 <= nguong_Do_Am or Do_am_dat_2 <= nguong_Do_Am:
            start_automatic_watering(thoi_gian_tuoi_nuoc)
    await asleep_ms(200)

async def task_sync_clock():
  global clock_ready
  while True:
    if not bom_IoT and ntptime is not None:
      try:
        ntptime.timeout = 2
        ntptime.settime()
        clock_ready = time.gmtime()[0] >= 2024
        create_task(report_clock_status())
      except Exception as error:
        print('Clock sync:', error)
    # Retry after a minute; after success resync every six hours.
    for _ in range(21600 if clock_ready else 60):
      await asleep_ms(1000)

async def report_clock_status():
  try:
    await publish_irrigation_status()
  except Exception as error:
    print('Clock MQTT:', error)

async def LCD_hien_thi_che_do():
  global lcd_dang_hien_thi_che_do
  lcd_dang_hien_thi_che_do = True
  lcd1602.clear()
  lcd1602.show('Che do hien tai:', 0, 0)
  che_do = 'Thu Cong' if manual_mode else 'Tu Dong'
  lcd1602.show(che_do, 1, 0)

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B_nhi_E1_BB_87t__C4_91_E1_BB_99():
  global lcd_dang_hien_thi_che_do
  lcd_dang_hien_thi_che_do = False
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  lcd1602.show(str((''.join([str(x) for x in ['T:', Nhiet_do, '*C']]))), 1 - 1, 1 - 1)

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m_kk():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  lcd1602.show(str((''.join([str(x2) for x2 in ['H:', Do_am_kk, '%']]))), 1 - 1, 11 - 1)

async def on_mqtt_msg_V7(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  if not manual_mode:
    return
  if msg == '1':
    if manual_mode:
      relay.set_relay(1, 1)
      bom_IoT = True
  else:
    relay.set_relay(1, 0)
    bom_IoT = False

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C3_A1nh_s_C3_A1ng():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  lcd1602.show('LUX:' + str(Do_sang), 1, 0)

async def on_mqtt_msg_V8(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  if msg == '1':
    if manual_mode:
      relay.set_relay(2, 1)
      quat_IoT = True
  else:
    relay.set_relay(2, 0)
    quat_IoT = False

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_1():
  global lcd_dang_hien_thi_che_do
  lcd_dang_hien_thi_che_do = False
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  lcd1602.show(str(('Do am 1:' + str(Do_am_dat_1))), 1 - 1, 1 - 1)

async def on_mqtt_msg_V10(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  check_connect = msg
  if msg == 'ARE U HERE':
    await mqtt_client.publish('V10', 'HERE')
  elif msg == 'SYNC_REQUEST':
    await publish_current_state()

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_2():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  lcd1602.show('Do am 2:' + str(Do_am_dat_2), 1, 0)

async def on_mqtt_msg_V9(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  previous_manual_mode = manual_mode
  if msg == '1':
    manual_mode = True
  else:
    manual_mode = False
  if (manual_mode and watering_deadline is not None) or (previous_manual_mode and not manual_mode and bom_IoT):
    stop_automatic_watering()
  if lcd_dang_hien_thi_che_do:
    await LCD_hien_thi_che_do()

async def on_mqtt_msg_V12(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  nguong_Bat_Den = int((msg))

async def on_mqtt_msg_V13(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  nguong_Tat_Den = int((msg))

async def on_mqtt_msg_V6(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  if msg == '1':
    if manual_mode:
      relay.set_relay(3, 1)
      den_IoT = True
      neopix.show(0, hex_to_rgb('#ffa500'))
  else:
    relay.set_relay(3, 0)
    den_IoT = False
    neopix.show(0, hex_to_rgb('#0000ff'))

async def on_mqtt_msg_V14(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  nguong_Do_Am = int((msg))

async def on_mqtt_msg_V15(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  thoi_gian_tuoi_nuoc = int((msg))

async def on_mqtt_msg_V16(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  nguong_Bat_Quat = int((msg))

async def on_mqtt_msg_V17(topic, msg):
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  nguong_Tat_Quat = int((msg))

# Mô tả hàm này...
async def Hi_E1_BB_83n_th_E1_BB_8B_ban__C4_91_E1_BA_A7u():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  Nhiet_do = await dht20.atemperature()
  Do_am_kk = await dht20.ahumidity()
  Do_sang = light_A2.read_analog_percent()
  Do_am_dat_1 = 100 - (soil_A0.read_analog_percent())
  Do_am_dat_2 = 100 - (soil_A1.read_analog_percent())
  lcd1602.clear()
  await LCD_hi_E1_BB_83n_th_E1_BB_8B_nhi_E1_BB_87t__C4_91_E1_BB_99()
  await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m_kk()
  await LCD_hi_E1_BB_83n_th_E1_BB_8B__C3_A1nh_s_C3_A1ng()
  await asleep_ms(3000)
  lcd1602.clear()
  await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_1()
  await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_2()
  await asleep_ms(3000)
  await LCD_hien_thi_che_do()

# Mô tả hàm này...
async def update_sensor_values():
  global Nhiet_do, Do_am_kk, Do_sang, Do_am_dat_1, Do_am_dat_2
  Nhiet_do = await dht20.atemperature()
  Do_am_kk = await dht20.ahumidity()
  Do_sang = light_A2.read_analog_percent()
  Do_am_dat_1 = 100 - (soil_A0.read_analog_percent())
  Do_am_dat_2 = 100 - (soil_A1.read_analog_percent())

def bool_payload(value):
  if value:
    return '1'
  return '0'

async def publish_current_state():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, thoi_gian_tuoi_nuoc, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT
  await mqtt_client.publish('V10', 'HERE')
  await publish_irrigation_status()
  await update_sensor_values()
  snapshot = [
    ('V1', Nhiet_do),
    ('V2', Do_am_kk),
    ('V3', Do_am_dat_1),
    ('V4', Do_am_dat_2),
    ('V5', Do_sang),
    ('V6', bool_payload(den_IoT)),
    ('V7', bool_payload(bom_IoT)),
    ('V8', bool_payload(quat_IoT)),
    ('V9', bool_payload(manual_mode)),
    ('V12', nguong_Bat_Den),
    ('V13', nguong_Tat_Den),
    ('V14', nguong_Do_Am),
    ('V15', thoi_gian_tuoi_nuoc),
    ('V16', nguong_Bat_Quat),
    ('V17', nguong_Tat_Quat),
  ]
  for item in snapshot:
    if item[1] != None:
      await mqtt_client.publish(item[0], item[1])
      await asleep_ms(120)

Nhiet_do = None
check_connect = None
nguong_Bat_Den = None
nguong_Tat_Den = None
nguong_Do_Am = None
nguong_Bat_Quat = None
nguong_Tat_Quat = None
thoi_gian_tuoi_nuoc = None
Do_am_kk = None
manual_mode = None
bom_IoT = None
Do_sang = None
Do_am_dat_1 = None
Do_am_dat_2 = None
den_IoT = None
quat_IoT = None
snapshot = None
i = None
list2 = None
lcd1602 = LCD1602()
cfg['ssid'] = 'MEKONG STEM 5G'
cfg['wifi_pw'] = 'Mekong2025'
cfg['server'] = 'mqtt.ohstem.vn'
cfg['port'] = 1883
cfg['user'] = 'greenhouse_BNG'
cfg['password'] = ''
dht20 = DHT20()
light_A2 = Pins(A2_PIN)
soil_A0 = Pins(A0_PIN)
soil_A1 = Pins(A1_PIN)
cfg['topics'].append(('V7', on_mqtt_msg_V7))
cfg['topics'].append(('V8', on_mqtt_msg_V8))
cfg['topics'].append(('V10', on_mqtt_msg_V10))
cfg['topics'].append(('V9', on_mqtt_msg_V9))
cfg['topics'].append(('V12', on_mqtt_msg_V12))
cfg['topics'].append(('V13', on_mqtt_msg_V13))
cfg['topics'].append(('V6', on_mqtt_msg_V6))
cfg['topics'].append(('V14', on_mqtt_msg_V14))
cfg['topics'].append(('V15', on_mqtt_msg_V15))
cfg['topics'].append(('V16', on_mqtt_msg_V16))
cfg['topics'].append(('V17', on_mqtt_msg_V17))
cfg['topics'].append(('V18', on_mqtt_msg_V18))
cfg['topics'].append(('V20', on_mqtt_msg_V20))

def deinit():
  mqtt_client.close()

import yolo_uno
yolo_uno.deinit = deinit

mqtt_client = MQTTClient(cfg); MQTTClient.DEBUG = True

async def task_x_V_D_p():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  while True:
    await asleep_ms(10000)
    Nhiet_do = await dht20.atemperature()
    Do_am_kk = await dht20.ahumidity()
    Do_sang = light_A2.read_analog_percent()
    Do_am_dat_1 = 100 - (soil_A0.read_analog_percent())
    Do_am_dat_2 = 100 - (soil_A1.read_analog_percent())
    lcd1602.clear()
    await LCD_hi_E1_BB_83n_th_E1_BB_8B_nhi_E1_BB_87t__C4_91_E1_BB_99()
    await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m_kk()
    await LCD_hi_E1_BB_83n_th_E1_BB_8B__C3_A1nh_s_C3_A1ng()
    await asleep_ms(3000)
    lcd1602.clear()
    await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_1()
    await LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_2()
    await asleep_ms(3000)
    await LCD_hien_thi_che_do()
    await mqtt_client.publish('V1', Nhiet_do)
    await asleep_ms(200)
    await mqtt_client.publish('V2', Do_am_kk)
    await asleep_ms(200)
    await mqtt_client.publish('V5', Do_sang)
    await asleep_ms(200)
    await mqtt_client.publish('V3', Do_am_dat_1)
    await asleep_ms(200)
    await mqtt_client.publish('V4', Do_am_dat_2)

async def task_P_T_K_R():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  while True:
    await asleep_ms(10000)
    if not manual_mode:
      if Nhiet_do >= nguong_Bat_Quat:
        relay.set_relay(2, 1)
        quat_IoT = True
        await mqtt_client.publish('V8', '1')
      elif Nhiet_do <= nguong_Tat_Quat:
        relay.set_relay(2, 0)
        quat_IoT = False
        await mqtt_client.publish('V8', '0')
      if Do_sang <= nguong_Bat_Den:
        relay.set_relay(3, 1)
        den_IoT = True
        await mqtt_client.publish('V6', '1')
      elif Do_sang >= nguong_Tat_Den:
        relay.set_relay(3, 0)
        den_IoT = False
        await mqtt_client.publish('V6', '0')

async def setup():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, thoi_gian_tuoi_nuoc, Do_am_kk, manual_mode, bom_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, den_IoT, quat_IoT, snapshot, i, list2
  print('App started')
  lcd1602.clear()
  relay.set_relay(0, 0)
  bom_IoT = False
  den_IoT = False
  quat_IoT = False
  manual_mode = True
  nguong_Bat_Quat = 30
  nguong_Tat_Quat = 25
  nguong_Bat_Den = 50
  nguong_Tat_Den = 100
  nguong_Do_Am = 50
  thoi_gian_tuoi_nuoc = 5
  load_irrigation()
  neopix.show(0, hex_to_rgb('#ff0000'))
  lcd1602.show(str('Wifi...'), 1 - 1, 1 - 1)
  await mqtt_client.connect()
  lcd1602.show(str('Wifi connected'), 1 - 1, 1 - 1)
  neopix.show(0, hex_to_rgb('#00ff00'))
  await asleep_ms(1000)
  await Hi_E1_BB_83n_th_E1_BB_8B_ban__C4_91_E1_BA_A7u()

  create_task(task_x_V_D_p())
  create_task(task_P_T_K_R())
  create_task(task_automatic_watering())
  create_task(task_sync_clock())

async def main():
  await setup()
  while True:
    await asleep_ms(100)

run_loop(main())
