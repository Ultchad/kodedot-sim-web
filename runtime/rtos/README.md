# runtime/rtos: FreeRTOS on Emscripten pthreads

A FreeRTOS-compatible layer with ESP-IDF's flavour (`portMUX_TYPE`,
`taskENTER_CRITICAL(&mux)`, `xTaskCreatePinnedToCore`, `*WithCaps`,
`idf_additions.h`, `StackType_t` = byte, `configMAX_PRIORITIES` 25, tick 1000 Hz).
Headers are in `include/freertos/`, the implementation is `src/rtos.c`, unit tests are in
`test/` (`test/run.sh`: 85 checks under Node).

## Model

- One task = one detached pthread. Stack = max(4 x requested depth in bytes, 64 KB); static stacks handed in are ignored.
- A single global recursive mutex implements every critical section and `vTaskSuspendAll`.
- Blocking primitives (queues, semaphores, mutexes, event groups, notifications, delays) share one recursive kernel mutex with a per-object condition variable on `CLOCK_MONOTONIC`.
- The tick count is derived from `CLOCK_MONOTONIC` (1 tick = 1 ms), not counted by an interrupt.
- Queues, semaphores and mutexes are one `Queue_t` (semaphore = queue of item size 0), whose first three fields (`waiting`, `length`, `item_size`) match what QP/C's port reads through `StaticQueue_t.uxDummy4`.
- `StaticTask_t` is overlaid by the task control block; threads not created here (the Emscripten main thread, the page) are adopted on first use.
- Software timers run on a lazily started service thread; task-local storage supports delete callbacks.

## Deliberate differences from real FreeRTOS

- No priorities: the host scheduler decides; priorities are stored and reported only.
- `vTaskDelete(other)` is cooperative: it sets a kill flag and wakes the task, which exits at its next blocking call. `vTaskSuspend(other)` is likewise only flagged.
- `xPortCanYield()` is always true and `xPortInIsrContext()` false: there is no ISR context. "ISR" entry points (`*FromISR`) just call the task versions, so they are safe to call from the page's thread (the input hooks do).
- Giving a mutex you do not hold is lenient (accepted).
- `uxTaskGetStackHighWaterMark` reports the requested size.
