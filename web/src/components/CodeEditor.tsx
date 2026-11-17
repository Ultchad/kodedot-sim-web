/**
 * A board's own code: a real editor (CodeMirror) with a tab per file, the examples, Compile and upload (the compiler
 * runs in the browser and is fetched the first time, with its progress shown), problems inline and as a list, and the
 * board's serial monitor. The sketch is kept with the bench; uploading restarts only this board.
 */
import { cpp } from '@codemirror/lang-cpp';
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Sketch } from '../bench/store';
import { compiler, downloadSize, onProgress, type Diagnostic } from '../code/compiler';
import { EXAMPLES } from '../code/examples';
import { useI18n } from '../i18n';
import { text3 } from '../parts/service';
import { useBenchState } from '../state/bench';
import { useHost } from '../state/host';
import { Icon } from './Glyphs';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ink2)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--ink) 5%, transparent)' },
  '&.cm-focused': { outline: 'none' },
});

type Phase = { kind: 'idle' } | { kind: 'download'; loaded: number; total: number } | { kind: 'step'; step: string } | { kind: 'uploading' } | { kind: 'done'; ms: number } | { kind: 'failed' } | { kind: 'error'; text: string };

const FILE_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}\.(ino|h|hpp|cpp|c)$/;

export default function CodeEditor({ instance, onClose }: { instance: string; onClose: () => void }) {
  const { t, locale, fmt } = useI18n();
  const { bench, parts } = useHost();
  const state = useBenchState(bench);
  useSyncExternalStore(parts.subscribe, parts.getVersion);
  const obj = state.objects.find((o) => o.id === instance);
  const core = obj ? parts.coreOf(obj.kind) : null;
  const running = parts.sketchOf(instance);
  // the sketch being edited: the one kept with the bench, or the one the board runs
  const sketch: Sketch = useMemo(() => state.code[instance] ?? { files: [{ name: 'main.ino', text: running?.source ?? '' }] }, [state.code, instance, running?.source]);
  const [active, setActive] = useState('main.ino');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [problems, setProblems] = useState<Diagnostic[]>([]);
  const [size, setSize] = useState<number | null | undefined>(undefined);
  const [adding, setAdding] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const docs = useRef(new Map<string, EditorState>());
  const live = useRef({ sketch, active, problems });
  live.current = { sketch, active, problems };
  const file = sketch.files.find((f) => f.name === active) ?? sketch.files[0];

  useEffect(() => {
    if (core) void downloadSize(core).then(setSize);
  }, [core]);
  useEffect(() => onProgress((p) => {
    if (p.phase === 'download') setPhase({ kind: 'download', loaded: p.overallLoaded, total: p.overallTotal });
    else if (p.phase === 'step') setPhase({ kind: 'step', step: p.step });
  }), []);

  const save = useCallback(
    (name: string, text: string) => {
      const cur = live.current.sketch;
      if (cur.files.find((f) => f.name === name)?.text === text) return;
      bench.setCode(instance, { files: cur.files.map((f) => (f.name === name ? { ...f, text } : f)) });
    },
    [bench, instance],
  );
  const stateFor = useCallback(
    (name: string, text: string) =>
      EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          cpp(),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) save(name, u.state.doc.toString());
          }),
        ],
      }),
    [save],
  );
  const marks = useCallback((name: string, list: Diagnostic[]) => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const out: CmDiagnostic[] = [];
    for (const d of list) {
      if (d.file !== name && !(d.line === 0 && name === 'main.ino')) continue;
      const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
      const from = Math.min(line.to, line.from + Math.max(0, d.column - 1));
      out.push({ from, to: Math.max(from, line.to), severity: d.severity === 'warning' ? 'warning' : d.severity === 'note' ? 'info' : 'error', message: d.hint ? `${d.message}\n${d.hint}` : d.message });
    }
    v.dispatch(setDiagnostics(v.state, out));
  }, []);

  // one editor; each file keeps its own state (undo history, cursor)
  useEffect(() => {
    if (!holder.current || !file) return;
    const st = docs.current.get(file.name) ?? stateFor(file.name, file.text);
    docs.current.set(file.name, st);
    if (!view.current) {
      // in a shadow root: the editor's own styles are then constructed style sheets, which the site's CSP (style-src 'self') allows
      const root = holder.current.shadowRoot ?? holder.current.attachShadow({ mode: 'open' });
      view.current = new EditorView({ state: st, parent: root, root });
    }
    else view.current.setState(st);
    marks(file.name, live.current.problems);
    const v = view.current;
    return () => void docs.current.set(file.name, v.state);
  }, [file?.name, stateFor, marks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => view.current?.destroy(), []);
  // the sketch replaced from outside (an example, undo): the editors start again from it
  const replace = (next: Sketch) => {
    bench.checkpoint();
    bench.setCode(instance, next);
    docs.current.clear();
    setProblems([]);
    setActive(next.files[0].name);
    view.current?.setState(stateFor(next.files[0].name, next.files[0].text));
    docs.current.set(next.files[0].name, view.current!.state);
  };

  const run = async () => {
    if (!core) return;
    setPhase({ kind: 'step', step: 'start' });
    setProblems([]);
    marks(live.current.active, []);
    const files = Object.fromEntries(live.current.sketch.files.map((f) => [f.name, f.text]));
    try {
      const cc = await compiler();
      const t0 = performance.now();
      const r = await cc.compile({ board: core, files });
      setProblems(r.diagnostics);
      marks(live.current.active, r.diagnostics);
      if (!r.ok || !r.wasm) return setPhase({ kind: 'failed' });
      setPhase({ kind: 'uploading' });
      if (!state.code[instance]) bench.setCode(instance, live.current.sketch);
      await parts.upload(instance, files['main.ino'] ?? live.current.sketch.files[0].text, r.wasm);
      setSize(0);
      setPhase({ kind: 'done', ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setPhase({ kind: 'error', text: String((e as Error).message ?? e) });
    }
  };

  const addFile = () => {
    const name = (adding ?? '').trim();
    if (!FILE_RE.test(name) || sketch.files.some((f) => f.name === name)) return;
    bench.setCode(instance, { files: [...sketch.files, { name, text: name.endsWith('.h') || name.endsWith('.hpp') ? '#pragma once\n' : '' }] });
    setAdding(null);
    setActive(name);
  };
  const removeFile = (name: string) => {
    bench.checkpoint();
    bench.setCode(instance, { files: sketch.files.filter((f) => f.name !== name) });
    docs.current.delete(name);
    setActive('main.ino');
  };

  const busy = phase.kind === 'download' || phase.kind === 'step' || phase.kind === 'uploading';
  const mb = (n: number) => fmt.number(Math.max(0.1, Math.round(n / 104857.6) / 10));
  const status =
    phase.kind === 'download' ? t('code.downloading', { done: mb(phase.loaded), total: mb(phase.total) })
    : phase.kind === 'step' ? t(phase.step === 'link' || phase.step === 'linking' ? 'code.linking' : 'code.compiling')
    : phase.kind === 'uploading' ? t('code.uploading')
    : phase.kind === 'done' ? t('code.uploaded', { seconds: fmt.number(Math.round(phase.ms / 100) / 10) })
    : phase.kind === 'failed' ? t('code.failed', { count: problems.filter((p) => p.severity === 'error').length })
    : phase.kind === 'error' ? phase.text
    : size === null ? t('code.noCompiler')
    : size ? t('code.firstTime', { size: mb(size) })
    : '';
  const serial = parts.serial(instance);
  const serialBox = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = serialBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [serial.length]);
  const [typed, setTyped] = useState('');

  if (!obj || !core) return null;
  return (
    <section className="card anim-fade @container absolute inset-2 z-20 flex min-h-0 flex-col gap-2 !p-3" aria-label={t('code.title')} data-testid="code-editor" data-instance={instance} data-phase={phase.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 truncate text-[17px]">
          {obj.name} <span className="text-ink2">· {text3(parts.manifest(obj.kind)?.name, locale, obj.kind)}</span>
        </h3>
        <select
          className="field-input !w-auto"
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) replace({ files: ex.files.map((f) => ({ ...f })) });
          }}
          aria-label={t('code.examples')}
          data-testid="code-examples"
        >
          <option value="">{t('code.examples')}</option>
          {EXAMPLES.map((x) => (
            <option key={x.id} value={x.id}>
              {t(x.title)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void run()} disabled={busy || size === null} data-testid="code-upload">
          {t('code.upload')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label={t('code.close')} title={t('code.close')} data-testid="code-close">
          <Icon name="close" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('code.files')}>
        {sketch.files.map((f) => (
          <span key={f.name} className="inline-flex items-center">
            <button type="button" role="tab" aria-selected={f.name === file?.name} aria-pressed={f.name === file?.name} className="chip font-mono !text-[12.5px]" onClick={() => setActive(f.name)} data-testid={`code-tab-${f.name}`}>
              {f.name}
              {problems.some((p) => p.file === f.name && p.severity === 'error') && <span className="inline-block size-2 rounded-full bg-[var(--red)]" />}
            </button>
            {f.name !== 'main.ino' && f.name === file?.name && (
              <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => removeFile(f.name)} aria-label={t('code.removeFile', { name: f.name })} title={t('code.removeFile', { name: f.name })}>
                <Icon name="trash" />
              </button>
            )}
          </span>
        ))}
        {adding === null ? (
          <button type="button" className="chip" onClick={() => setAdding('')} aria-label={t('code.addFile')} title={t('code.addFile')} data-testid="code-add-file">
            +
          </button>
        ) : (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              addFile();
            }}
          >
            <input className="field-input !w-40 font-mono !text-[12.5px]" autoFocus placeholder="helper.h" value={adding} onChange={(e) => setAdding(e.target.value)} onBlur={() => !adding && setAdding(null)} aria-label={t('code.addFile')} data-testid="code-file-name" />
          </form>
        )}
        <span className="min-w-0 flex-1" />
        {running?.custom && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void parts.resetCode(instance).then(() => (bench.checkpoint(), bench.setCode(instance, null), docs.current.clear(), setProblems([])))} data-testid="code-reset">
            {t('code.reset')}
          </button>
        )}
      </div>
      {(status || busy) && (
        <div className="flex items-center gap-3 px-1 text-[13px] text-ink2" role="status" data-testid="code-status">
          {phase.kind === 'download' && (
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-soft" aria-hidden>
              <span className="block h-full rounded-full bg-[var(--amber)]" style={{ width: `${Math.round((100 * phase.loaded) / Math.max(1, phase.total))}%` }} data-testid="code-progress" />
            </span>
          )}
          <span className={phase.kind === 'failed' || phase.kind === 'error' ? 'text-[var(--red-text)]' : ''}>{status}</span>
        </div>
      )}
      <div ref={holder} className="inner min-h-0 flex-[3] overflow-hidden !p-0" data-testid="code-area" />
      <div className="grid min-h-0 flex-[2] grid-cols-1 gap-2 @[640px]:grid-cols-2">
        <div className="inner flex min-h-0 flex-col gap-1 !p-3" data-testid="code-problems">
          <span className="tag">
            {t('code.problems')} · {problems.length}
          </span>
          <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-0 text-[13px]">
            {problems.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full rounded-lg border-0 bg-transparent px-1.5 py-1 text-left hover:bg-soft"
                  onClick={() => {
                    if (sketch.files.some((f) => f.name === p.file)) setActive(p.file);
                    requestAnimationFrame(() => {
                      const v = view.current;
                      if (!v || p.line < 1) return;
                      const line = v.state.doc.line(Math.min(p.line, v.state.doc.lines));
                      v.dispatch({ selection: { anchor: line.from + Math.max(0, p.column - 1) }, scrollIntoView: true });
                      v.focus();
                    });
                  }}
                  data-testid="code-problem"
                  data-line={p.line}
                  data-file={p.file}
                  data-severity={p.severity}
                >
                  <span className={`font-mono font-semibold ${p.severity === 'error' ? 'text-[var(--red-text)]' : 'text-ink2'}`}>
                    {p.file}:{p.line}
                  </span>{' '}
                  {p.message}
                  {p.hint && <span className="block text-ink2">{p.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="on-dark flex min-h-0 flex-col gap-1.5 rounded-2xl bg-dark p-3 text-darktext" data-testid="code-serial">
          <div className="flex items-center gap-2">
            <span className="tag flex-1 !text-darktext">{t('code.serial')}</span>
            <button type="button" className="btn btn-sm btn-dark" onClick={() => parts.restart(instance)} data-testid="code-restart">
              {t('code.restart')}
            </button>
          </div>
          <pre ref={serialBox} className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[12.5px] leading-snug" data-testid="code-serial-log">
            {serial.slice(-400).join('\n')}
          </pre>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              parts.serialIn(instance, `${typed}\n`);
              setTyped('');
            }}
          >
            <input className="field-input is-dark min-w-0 flex-1 font-mono !text-[12.5px]" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('code.serial.type')} aria-label={t('code.serial.type')} data-testid="code-serial-input" />
            <button type="submit" className="btn btn-sm btn-dark" data-testid="code-serial-send">
              {t('code.serial.send')}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
