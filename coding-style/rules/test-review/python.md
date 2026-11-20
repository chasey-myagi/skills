# test-review / python

Rules for this gate when the change includes python. These win over common where they say so. Repository policy wins over both.

### PY-14 · Parametrize and do not sleep

Fold repetitive cases into `pytest.mark.parametrize`. No `time.sleep` to order events; use `asyncio.Event`, barriers or fake clocks. Shared fixtures live in `conftest.py` or a fixtures module; a test file never imports another test file. Logic that can run in-process is not tested by spawning a subprocess.

### PY-15 · In-process tests stay in-process

Logic that can run inside the test process is not covered by spawning a subprocess. A subprocess is for a process boundary the product actually has.
