/* SPDX-License-Identifier: GPL-3.0-or-later
 * The rule for every page-facing export (docs/STATUS-panic.md): the page's thread never waits for a lock.
 *
 * In a browser the page's main thread that waits for a mutex spins inside wasm and never returns to the event loop, and a firmware thread
 * that creates a thread (pthread_create from a worker is proxied to the main thread's event loop, always) or was terminated while holding
 * that lock never releases it: the page freezes. So an export takes the firmware's lock with a bounded try. When the budget is spent it
 * does nothing, returns, and raises the "busy" flag; the glue (web-adapter ctx.call) sees the flag through dbpage_busy_take() and asks
 * again at its next poll (a write is queued in order, a read just answers "nothing yet").
 *
 *   DB_PAGE_LOCK(&g_mu, 0);      // inside an export returning int: busy -> return 0
 *   DB_PAGE_LOCK_V(&g_mu);       // inside a void export
 */
#ifndef DOTBENCH_PAGE_LOCK_H
#define DOTBENCH_PAGE_LOCK_H
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#ifndef DB_PAGE_BUDGET_MS
#define DB_PAGE_BUDGET_MS 5u
#endif

extern volatile uint32_t g_dbpage_busy;   /* bridge/kweb_bridge.c: counts refusals, cleared by dbpage_busy_take() */

static inline uint64_t db_page_now_us(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint64_t)t.tv_sec * 1000000u + (uint64_t)t.tv_nsec / 1000u;
}

static inline void db_page_note_busy(void) { __atomic_fetch_add(&g_dbpage_busy, 1u, __ATOMIC_RELAXED); }

/** True with the mutex held; false (busy noted) when it stayed taken for budget_ms. */
static inline bool db_page_trylock(pthread_mutex_t *m, uint32_t budget_ms)
{
    if (0 == pthread_mutex_trylock(m)) return true;
    uint64_t t0 = db_page_now_us();
    for (;;) {
        if (0 == pthread_mutex_trylock(m)) return true;
        if (db_page_now_us() - t0 >= (uint64_t)budget_ms * 1000u) { db_page_note_busy(); return false; }
    }
}

/** The same for a spin flag (0 free, nonzero taken): true with the flag set by us. */
static inline bool db_page_spin_take(volatile uint32_t *flag, uint32_t budget_ms)
{
    if (!__atomic_exchange_n(flag, 1u, __ATOMIC_ACQUIRE)) return true;
    uint64_t t0 = db_page_now_us();
    for (;;) {
        if (!__atomic_exchange_n(flag, 1u, __ATOMIC_ACQUIRE)) return true;
        if (db_page_now_us() - t0 >= (uint64_t)budget_ms * 1000u) { db_page_note_busy(); return false; }
    }
}

#define DB_PAGE_LOCK(m, busy_ret) do { if (!db_page_trylock((m), DB_PAGE_BUDGET_MS)) return busy_ret; } while (0)
#define DB_PAGE_LOCK_V(m)         do { if (!db_page_trylock((m), DB_PAGE_BUDGET_MS)) return; } while (0)

#endif
