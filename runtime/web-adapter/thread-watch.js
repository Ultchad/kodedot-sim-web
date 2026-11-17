// SPDX-License-Identifier: GPL-3.0-or-later
// Counts thread creations that find the worker pool empty (a new Worker has to be made and loaded: that needs the creating side's event
// loop, which a firmware thread blocked on the page cannot count on) and the most threads ever running. The pool (tools/dblib/kodeos.py
// POOL, tools/dotbench --pool) is sized above the peak with margin; tests fail when a program exceeds it (docs/STATUS-panic.md).
/** @param {{PThread: any}} M the Emscripten module. @returns {{pool:number, peak:number, beyondPool:number}} live counters */
export function watchThreads(M) {
  const P = M.PThread;
  const st = { pool: P.unusedWorkers.length, peak: 0, beyondPool: 0, stopped: false };
  const get = P.getNewWorker.bind(P);
  P.getNewWorker = () => {
    if (P.unusedWorkers.length === 0 && !st.stopped) st.beyondPool++;
    st.peak = Math.max(st.peak, Object.keys(P.pthreads).length + 1);
    return get();
  };
  const stop = P.terminateAllThreads.bind(P);
  P.terminateAllThreads = () => { st.stopped = true; return stop(); };   // after a stop the pool is emptied on purpose
  return st;
}
