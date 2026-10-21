"""Exercise the real firmware functions without importing ESP32 hardware drivers."""
import ast
import asyncio
import copy
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'esp32_scratch_mqtt.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf-8'))
FUNCTIONS = ast.Module(body=[node for node in TREE.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))], type_ignores=[])
SCHEDULE = {'mode': 'schedule', 'days': [2], 'slots': [{'time': '08:00', 'seconds': 3}]}


class SimulatedTime:
    # Wednesday 2026-10-21, 07:59:59 in Vietnam.
    epoch = 1792544399
    ms = 0

    def ticks_ms(self): return self.ms
    def ticks_add(self, start, delta): return start + delta
    def ticks_diff(self, left, right): return left - right
    def time(self): return self.epoch + self.ms // 1000
    def gmtime(self, seconds=None): return time.gmtime(self.time() if seconds is None else seconds)


class EndSimulation(Exception):
    pass


class IrrigationTests(unittest.TestCase):
    def setUp(self):
        self.clock = SimulatedTime()
        self.events = []
        self.network_tasks = []
        self.published = []
        class MQTT:
            async def publish(_, topic, payload): self.published.append((topic, payload))
        class Relay:
            def set_relay(_, channel, value): self.events.append((self.clock.ms, channel, value))
        # Do not execute reporting coroutines: simulate an indefinitely delayed broker.
        def create_task(coroutine):
            self.network_tasks.append(coroutine)
        # MicroPython's filesystem rename replaces an existing file; Windows rename does not.
        filesystem = SimpleNamespace(rename=os.replace)
        self.ns = dict(json=json, os=filesystem, time=self.clock, relay=Relay(), mqtt_client=MQTT(), create_task=create_task,
                       irrigation=copy.deepcopy(SCHEDULE), clock_ready=True, manual_mode=False,
                       bom_IoT=False, watering_deadline=None, watering_mode=None,
                       lcd_dang_hien_thi_che_do=False,
                       schedule_date=None, schedule_done=[], Do_am_dat_1=20, Do_am_dat_2=70,
                       nguong_Do_Am=50, thoi_gian_tuoi_nuoc=3)
        exec(compile(FUNCTIONS, str(SOURCE), 'exec'), self.ns)

    def tearDown(self):
        for coroutine in self.network_tasks:
            coroutine.close()

    def run_loop(self, milliseconds, change=None):
        async def sleep(ms):
            self.clock.ms += ms
            if change:
                change(self.clock.ms)
            if self.clock.ms >= milliseconds:
                raise EndSimulation()
        self.ns['asleep_ms'] = sleep
        with self.assertRaises(EndSimulation):
            asyncio.run(self.ns['task_automatic_watering']())

    def test_schedule_runs_once_and_stops_with_blocked_mqtt(self):
        self.assertEqual(self.clock.gmtime()[6], 2)
        self.run_loop(65000)
        self.assertEqual(self.events, [(1000, 1, 1), (4000, 1, 0)])
        self.assertEqual(len(self.network_tasks), 2)

    def test_unselected_day_does_not_water(self):
        self.ns['irrigation']['days'] = [0, 1]
        self.run_loop(65000)
        self.assertEqual(self.events, [])

    def test_unsynchronized_clock_does_not_water(self):
        self.ns['clock_ready'] = False
        self.run_loop(65000)
        self.assertEqual(self.events, [])

    def test_moisture_works_without_clock_or_network(self):
        self.ns['irrigation']['mode'] = 'moisture'
        self.ns['clock_ready'] = False
        self.run_loop(15000)
        self.assertEqual(self.events, [(10000, 1, 1), (13000, 1, 0)])

    def test_moisture_is_ignored_in_schedule_mode(self):
        self.ns['irrigation']['slots'][0]['time'] = '17:00'
        self.run_loop(15000)
        self.assertEqual(self.events, [])

    def test_manual_switch_stops_automatic_cycle(self):
        def change(ms):
            if ms == 2000:
                self.ns['manual_mode'] = True
        self.run_loop(6000, change)
        self.assertEqual(self.events, [(1000, 1, 1), (2000, 1, 0)])

    def test_strategy_switch_stops_current_cycle(self):
        def change(ms):
            if ms == 2000:
                self.ns['irrigation']['mode'] = 'moisture'
        self.run_loop(6000, change)
        self.assertEqual(self.events, [(1000, 1, 1), (2000, 1, 0)])

    def test_entering_auto_stops_an_unlimited_manual_pump(self):
        self.ns['manual_mode'] = True
        self.ns['bom_IoT'] = True
        asyncio.run(self.ns['on_mqtt_msg_V9']('V9', '0'))
        self.assertFalse(self.ns['bom_IoT'])
        self.assertEqual(self.events, [(0, 1, 0)])

    def test_auto_ignores_echoed_pump_commands(self):
        self.ns['bom_IoT'] = True
        asyncio.run(self.ns['on_mqtt_msg_V7']('V7', '0'))
        self.assertTrue(self.ns['bom_IoT'])
        self.assertEqual(self.events, [])

    def test_mode_confirmation_comes_from_firmware_on_separate_channel(self):
        asyncio.run(self.ns['on_mqtt_msg_V9']('V9', '1'))
        topic, payload = self.published[-1]
        self.assertEqual(topic, 'V19')
        self.assertTrue(json.loads(payload)['manual_mode'])
        asyncio.run(self.ns['on_mqtt_msg_V9']('V9', '0'))
        topic, payload = self.published[-1]
        self.assertEqual(topic, 'V19')
        self.assertFalse(json.loads(payload)['manual_mode'])

    def test_schedule_repeats_next_day_and_never_catches_up(self):
        due = self.ns['scheduled_watering_seconds']
        today = (2026, 10, 21, 8, 0, 0, 2, 294)
        self.assertEqual(due(today), 3)
        self.assertIsNone(due(today))
        self.assertIsNone(due((2026, 10, 21, 8, 1, 0, 2, 294)))
        self.assertEqual(due((2026, 10, 28, 8, 0, 0, 2, 301)), 3)

    def test_persistence_and_invalid_commands(self):
        validate = self.ns['validate_irrigation']
        with tempfile.TemporaryDirectory() as directory:
            self.ns['IRRIGATION_FILE'] = str(Path(directory) / 'irrigation.json')
            self.ns['save_irrigation'](SCHEDULE)
            self.ns['save_irrigation'](dict(SCHEDULE, days=[0, 6]))
            self.ns['load_irrigation']()
            self.assertEqual(self.ns['irrigation']['days'], [0, 6])
        for update in ({'days': []}, {'days': [7]}, {'slots': []},
                       {'slots': [{'time': '25:00', 'seconds': 3}]},
                       {'slots': [{'time': '08:00', 'seconds': 0}]},
                       {'slots': SCHEDULE['slots'] * 2}):
            with self.assertRaises(ValueError):
                validate(dict(SCHEDULE, **update))


if __name__ == '__main__':
    unittest.main()
