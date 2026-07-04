from lcd1602 import *
from relay_4chs import *
from mqtt_as import MQTTClient, config
from yolo_uno import *
from dht20 import *
from pins import *

cfg = config.copy()

def mqtt_text(msg):
  try:
    return msg.decode()
  except:
    return str(msg)

def mqtt_number(msg, fallback):
  try:
    return int(float(mqtt_text(msg).strip()))
  except:
    return fallback

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B_nhi_E1_BB_87t__C4_91_E1_BB_99():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
  lcd1602.show(str((''.join([str(x) for x in ['T:', Nhiet_do, '*C']]))), 1 - 1, 1 - 1)

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m_kk():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
  lcd1602.show(str((''.join([str(x2) for x2 in ['H:', Do_am_kk, '%']]))), 1 - 1, 11 - 1)

async def on_mqtt_msg_V7(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  if mqtt_text(msg).strip() == '1':
    if manual_mode:
      relay.set_relay(1, 1)
  else:
    relay.set_relay(1, 0)

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C3_A1nh_s_C3_A1ng():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
  lcd1602.show(str(('LUX:' + str(Do_sang))), 2 - 1, 1 - 1)

async def on_mqtt_msg_V8(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  if mqtt_text(msg).strip() == '1':
    if manual_mode:
      relay.set_relay(2, 1)
  else:
    relay.set_relay(2, 0)

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_1():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
  lcd1602.show(str(('Do am 1:' + str(Do_am_dat_1))), 1 - 1, 1 - 1)

async def on_mqtt_msg_V10(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  check_connect = mqtt_text(msg).strip()
  if check_connect == 'ARE U HERE':
    await mqtt_client.publish('V10', 'HERE')

# Mô tả hàm này...
async def LCD_hi_E1_BB_83n_th_E1_BB_8B__C4_91_E1_BB_99__E1_BA_A9m__C4_91_E1_BA_A5t_2():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
  lcd1602.show(str(('Do am 2:' + str(Do_am_dat_2))), 2 - 1, 1 - 1)

async def on_mqtt_msg_V9(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  if mqtt_text(msg).strip() == '1':
    manual_mode = True
  else:
    manual_mode = False

async def on_mqtt_msg_V11(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Bat_Den = mqtt_number(msg, nguong_Bat_Den)

async def on_mqtt_msg_V12(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Bat_Den = mqtt_number(msg, nguong_Bat_Den)

async def on_mqtt_msg_V13(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Tat_Den = mqtt_number(msg, nguong_Tat_Den)

async def on_mqtt_msg_V14(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Do_Am = mqtt_number(msg, nguong_Do_Am)

async def on_mqtt_msg_V6(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  if mqtt_text(msg).strip() == '1':
    if manual_mode:
      relay.set_relay(3, 1)
      neopix.show(0, hex_to_rgb('#ffa500'))
  else:
    relay.set_relay(3, 0)
    neopix.show(0, hex_to_rgb('#0000ff'))

async def on_mqtt_msg_V15(topic, msg):
  global thoi_gian_tuoi
  thoi_gian_tuoi = max(1, min(60, mqtt_number(msg, thoi_gian_tuoi)))

async def on_mqtt_msg_V16(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Bat_Quat = mqtt_number(msg, nguong_Bat_Quat)

async def on_mqtt_msg_V17(topic, msg):
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  nguong_Tat_Quat = mqtt_number(msg, nguong_Tat_Quat)

# Mô tả hàm này...
async def Hi_E1_BB_83n_th_E1_BB_8B_ban__C4_91_E1_BA_A7u():
  global Nhiet_do, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT
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

Nhiet_do = None
Do_am_kk = None
manual_mode = None
b_C6_A1m_IoT = None
Do_sang = None
Do_am_dat_1 = None
Do_am_dat_2 = None
_C4_91_C3_A8n_IoT = None
qu_E1_BA_A1t_IoT = None
check_connect = None
nguong_Bat_Den = None
nguong_Tat_Den = None
nguong_Do_Am = None
nguong_Bat_Quat = None
nguong_Tat_Quat = None
thoi_gian_tuoi = 5
lcd1602 = LCD1602()
cfg['ssid'] = 'BNG Tech'
cfg['wifi_pw'] = 'bng@2025'
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
cfg['topics'].append(('V11', on_mqtt_msg_V11))
cfg['topics'].append(('V12', on_mqtt_msg_V12))
cfg['topics'].append(('V13', on_mqtt_msg_V13))
cfg['topics'].append(('V14', on_mqtt_msg_V14))
cfg['topics'].append(('V15', on_mqtt_msg_V15))
cfg['topics'].append(('V6', on_mqtt_msg_V6))
cfg['topics'].append(('V16', on_mqtt_msg_V16))
cfg['topics'].append(('V17', on_mqtt_msg_V17))

def deinit():
  mqtt_client.close()

import yolo_uno
yolo_uno.deinit = deinit

mqtt_client = MQTTClient(cfg); MQTTClient.DEBUG = True

async def task_x_V_D_p():
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
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
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  while True:
    await asleep_ms(10000)
    if not manual_mode:
      if Nhiet_do >= nguong_Bat_Quat:
        relay.set_relay(2, 1)
        await mqtt_client.publish('V8', '1')
      elif Nhiet_do <= nguong_Tat_Quat:
        relay.set_relay(2, 0)
        await mqtt_client.publish('V8', '0')
      if Do_sang <= nguong_Bat_Den:
        relay.set_relay(3, 1)
        await mqtt_client.publish('V6', '1')
      elif Do_sang >= nguong_Tat_Den:
        relay.set_relay(3, 0)
        await mqtt_client.publish('V6', '0')
      if Do_am_dat_1 <= nguong_Do_Am or Do_am_dat_2 <= nguong_Do_Am:
        relay.set_relay(1, 1)
        await mqtt_client.publish('V7', '1')
        await asleep_ms(thoi_gian_tuoi * 1000)
        relay.set_relay(1, 0)
        await mqtt_client.publish('V7', '0')

async def setup():
  global Nhiet_do, Do_am_kk, manual_mode, b_C6_A1m_IoT, Do_sang, Do_am_dat_1, Do_am_dat_2, _C4_91_C3_A8n_IoT, qu_E1_BA_A1t_IoT, check_connect, nguong_Bat_Den, nguong_Tat_Den, nguong_Do_Am, nguong_Bat_Quat, nguong_Tat_Quat
  print('App started')
  lcd1602.clear()
  relay.set_relay(0, 0)
  b_C6_A1m_IoT = False
  _C4_91_C3_A8n_IoT = False
  qu_E1_BA_A1t_IoT = False
  manual_mode = True
  nguong_Bat_Quat = 30
  nguong_Tat_Quat = 25
  nguong_Bat_Den = 50
  nguong_Tat_Den = 100
  nguong_Do_Am = 50
  neopix.show(0, hex_to_rgb('#ff0000'))
  lcd1602.show(str('Wifi...'), 1 - 1, 1 - 1)
  await mqtt_client.connect()
  lcd1602.show(str('Wifi connected'), 1 - 1, 1 - 1)
  neopix.show(0, hex_to_rgb('#00ff00'))
  await asleep_ms(1000)
  await Hi_E1_BB_83n_th_E1_BB_8B_ban__C4_91_E1_BA_A7u()

  create_task(task_x_V_D_p())
  create_task(task_P_T_K_R())

async def main():
  await setup()
  while True:
    await asleep_ms(100)

run_loop(main())
