# test-review / go

Rules for this gate when the change includes go. These win over common where they say so. Repository policy wins over both.

### GO-10 · Table tests, no sleeps

Table-driven cases with `t.Run`; `t.Fatalf` when continuing is meaningless. No `time.Sleep` for synchronization; use channels, `sync.WaitGroup` or a fake clock. Assertions on mock expectations alone fall under CS-TEST-1. Do not drop -race to make the suite faster.
