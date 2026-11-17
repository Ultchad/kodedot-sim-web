/**
 * "Make your own": import a .dotpart (picker or drop), the visitor's parts, the starter folder as a zip, the prompt for
 * an AI assistant with a copy button, and the manual. The texts come from templates/component-starter (three languages),
 * put under /starter/ at build time.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { SectionTitle } from './BenchPanel';
import { Icon } from './Glyphs';
import { ScrollArea } from './ui';

const BASE = `${import.meta.env.BASE_URL}starter/`;

/** Just enough Markdown for the manual: headings, paragraphs, lists, tables as rows, code. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const inline = (s: string, k: number): ReactNode => {
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
    return (
      <span key={k}>
        {parts.map((p, i) =>
          p.startsWith('`') ? <code key={i} className="rounded bg-soft px-1 font-mono text-[12.5px]">{p.slice(1, -1)}</code>
          : p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong>
          : p.startsWith('[') ? <span key={i}>{p.slice(1, p.indexOf(']'))}</span>
          : p,
        )}
      </span>
    );
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      out.push(<pre key={i} className="m-0 overflow-auto rounded-xl bg-soft p-2.5 font-mono text-[12px] leading-snug">{body.join('\n')}</pre>);
    } else if (/^#{1,4} /.test(l)) {
      const n = l.indexOf(' ');
      out.push(<h4 key={i} className={`m-0 mt-2 ${n <= 2 ? 'text-[16px]' : 'text-[14.5px]'}`}>{inline(l.slice(n + 1), 0)}</h4>);
    } else if (/^\|/.test(l)) {
      if (/^\|[-| :]+\|$/.test(l)) continue;
      const cells = l.split('|').slice(1, -1).map((c) => c.trim());
      out.push(
        <p key={i} className="m-0 border-b border-line py-1 text-[13px] leading-snug">
          {inline(cells[0], 0)}
          {cells.length > 1 && <span className="text-ink2"> · {cells.slice(1).map((c, j) => inline(c, j + 1))}</span>}
        </p>,
      );
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const depth = l.search(/\S/);
      out.push(
        <p key={i} className="m-0 text-[13.5px] leading-snug" style={{ paddingLeft: 12 + depth * 6, textIndent: -10 }}>
          {inline(l.trim().replace(/^[-*] /, '• '), 0)}
        </p>,
      );
    } else if (l.trim()) out.push(<p key={i} className="m-0 text-[13.5px] leading-snug">{inline(l, 0)}</p>);
  }
  return <div className="flex flex-col gap-1.5">{out}</div>;
}

export function MakePanel({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const { parts, select } = useHost();
  useSyncExternalStore(parts.subscribe, parts.getVersion);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lang = locale === 'pt-BR' || locale === 'es' ? locale : 'en';
  useEffect(() => void parts.loadUserParts(), [parts]);
  useEffect(() => {
    let live = true;
    const get = (name: string) => fetch(`${BASE}${name}.${lang}.md`).then((r) => (r.ok ? r.text() : ''));
    void get('prompt').then((x) => live && setPrompt(x));
    void get('manual').then((x) => live && setManual(x));
    return () => void (live = false);
  }, [lang]);
  const take = async (files: FileList | null) => {
    for (const f of [...(files ?? [])]) {
      const r = await parts.importPart(new Uint8Array(await f.arrayBuffer()), f.name);
      setMsg(r.ok ? { ok: true, text: t('make.import.ok', { name: f.name }) } : { ok: false, text: t('make.import.bad'), errors: r.errors.slice(0, 6) });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid=make-prompt-text]');
      ta?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const mine = parts.userParts();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="make-panel">
      <SectionTitle title={t('make.title')} subtitle={t('make.subtitle')} compact={compact} />
      <ScrollArea className="-mx-2 min-h-0 flex-1 px-2 py-1" label={t('make.title')}>
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2" aria-label={t('make.import')}>
            <h3 className="tag m-0">{t('make.import')}</h3>
            <div
              className={`inner flex flex-col items-start gap-2 p-4 ${over ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void take(e.dataTransfer.files);
              }}
              data-testid="make-drop"
            >
              <p className="m-0 text-[14px] leading-snug text-ink2">{t('make.import.hint')}</p>
              <button type="button" className="btn btn-sm" onClick={() => input.current?.click()} data-testid="make-choose">
                <Icon name="folder" size={16} />
                {t('make.import.choose')}
              </button>
              <input ref={input} type="file" accept=".dotpart,application/zip" multiple className="sr-only" tabIndex={-1} onChange={(e) => (void take(e.target.files), (e.target.value = ''))} data-testid="make-file" />
              {msg && (
                <div className={`text-[13.5px] leading-snug ${msg.ok ? '' : 'text-[var(--red-text)]'}`} role="status" data-testid="make-message" data-ok={msg.ok}>
                  {msg.text}
                  {msg.errors && (
                    <ul className="m-0 mt-1 list-disc pl-5">
                      {msg.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>
          <section className="flex flex-col gap-2" aria-label={t('make.mine')}>
            <h3 className="tag m-0">{t('make.mine')}</h3>
            {mine.length === 0 ? (
              <p className="m-0 px-1 text-[13.5px] text-ink2">{t('make.mine.none')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="make-mine">
                {mine.map((p) => (
                  <li key={p.id} className="inner flex items-center gap-2 p-2 pl-3" data-testid="make-part" data-id={p.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                      <span className="block truncate font-mono text-[12px] text-ink2">{p.id}</span>
                    </span>
                    <button type="button" className="btn btn-sm" onClick={() => void parts.place(p.id, p.name).then((o) => o && select.only(o.id))} aria-label={t('make.mine.place', { name: p.name })} title={t('make.mine.place', { name: p.name })} data-testid="make-place">
                      +
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => void parts.removeUserPart(p.id)} aria-label={t('make.mine.remove', { name: p.name })} title={t('make.mine.remove', { name: p.name })} data-testid="make-remove">
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2" aria-label={t('make.starter')}>
            <h3 className="tag m-0">{t('make.starter')}</h3>
            <div className="inner flex flex-col items-start gap-2 p-4">
              <p className="m-0 text-[14px] leading-snug text-ink2">{t('make.starter.hint')}</p>
              <a className="btn btn-sm" href={`${BASE}component-starter.zip`} download="component-starter.zip" data-testid="make-starter">
                <Icon name="download" size={16} />
                {t('make.starter.download')}
              </a>
            </div>
          </section>
          <section className="flex flex-col gap-2" aria-label={t('make.prompt')}>
            <h3 className="tag m-0">{t('make.prompt')}</h3>
            <div className="inner flex flex-col items-start gap-2 p-4">
              <p className="m-0 text-[14px] leading-snug text-ink2">{t('make.prompt.hint')}</p>
              <textarea className="field-input h-36 w-full resize-y font-mono !text-[12px] leading-snug" readOnly value={prompt} aria-label={t('make.prompt')} data-testid="make-prompt-text" />
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy()} disabled={!prompt} data-testid="make-copy">
                <Icon name="copy" size={16} />
                {t(copied ? 'make.prompt.copied' : 'make.prompt.copy')}
              </button>
            </div>
          </section>
          <section className="flex flex-col gap-2" aria-label={t('make.manual')}>
            <h3 className="tag m-0">{t('make.manual')}</h3>
            <button type="button" className="btn btn-sm self-start" onClick={() => setShowManual((v) => !v)} aria-expanded={showManual} data-testid="make-manual-toggle">
              {t(showManual ? 'make.manual.hide' : 'make.manual.show')}
            </button>
            {showManual && (
              <div className="inner p-4" data-testid="make-manual">
                <Markdown text={manual} />
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
