// JGENTS Crew: one chat for the whole crew. Left: the agents. Center: the conversation and the composer (requests
// are routed to the right agent; @mention or pick one to choose). Right: the Q&A board, where the agents' questions
// and approval requests wait for you.
import './crew.css';
import type { CrewAgent, CrewAgentState, CrewMessage, CrewQuestion, CrewSnapshot } from '../../../shared/crew';
import { h } from '../ui/dom';
import { renderMarkdown } from '../ui/markdown';
import { call, connect } from './api';
import { openEditor } from './editor';

// ---------------------------------------------------------------- state

const S = {
  snap: undefined as CrewSnapshot | undefined,
  agents: new Map<string, CrewAgent>(),
  states: new Map<string, CrewAgentState>(),
  messages: [] as CrewMessage[],
  questions: new Map<string, CrewQuestion>(),
  /** Composer target ('' = let the dispatcher decide). */
  picked: '',
  /** Conversation filter ('' = everyone). */
  filter: '',
  live: false,
  seenQuestions: new Set<string>(),
};

const PICK_KEY = 'jgents.crew.picked';
try {
  S.picked = localStorage.getItem(PICK_KEY) ?? '';
} catch {
  // private mode
}

// ---------------------------------------------------------------- helpers

function avatar(a: CrewAgent | undefined, status?: string, size: '' | 'sm' | 'xs' = ''): HTMLElement {
  return h(
    'span',
    { class: `avatar${size ? ` avatar--${size}` : ''}`, style: `--c:${a?.color ?? '#888'}`, attrs: { 'data-status': status, 'aria-hidden': 'true' } },
    a?.emoji ?? '🤖',
  );
}

function svg(path: string, size = 16): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = path;
  return s;
}

const ICON = {
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};

function fmtTime(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtTime(at);
}

function toast(text: string): void {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

async function act<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (err) {
    toast((err as Error).message);
    return undefined;
  }
}

function md(text: string): HTMLElement {
  const box = h('div', { class: 'md' });
  box.append(renderMarkdown(text));
  return box;
}

// ---------------------------------------------------------------- layout

const root = document.getElementById('crew')!;
const sideList = h('div', { class: 'side__list', role: 'list' });
const sideFoot = h('div', { class: 'side__foot' });
const side = h(
  'aside',
  { class: 'side', attrs: { 'aria-label': 'Crew' } },
  h(
    'div',
    { class: 'side__head' },
    h('img', { class: 'side__logo', attrs: { src: '/assets/brand/logo-mark.png', alt: '' } }),
    h('div', { class: 'side__brand' }, 'JGENTS Crew', h('small', {}, 'One chat, many agents')),
  ),
  h('button', { class: 'side__new', type: 'button', on: { click: () => newAgent() } }, svg(ICON.plus), 'New agent'),
  h('div', { class: 'side__label' }, 'Agents'),
  sideList,
  sideFoot,
);

const title = h('div', { class: 'main__title' });
const boardBtn = h('button', { class: 'icon-btn only-narrow', type: 'button', title: 'Questions for you', on: { click: () => toggle('show-board') } }, svg(ICON.inbox, 18));
const head = h(
  'header',
  { class: 'main__head' },
  h('button', { class: 'icon-btn only-narrow', type: 'button', title: 'Agents', on: { click: () => toggle('show-side') } }, svg(ICON.menu, 18)),
  title,
  h('button', { class: 'icon-btn', type: 'button', title: 'Clear the chat history', on: { click: () => clearChat() } }, svg(ICON.trash)),
  boardBtn,
);
const banner = h('div', { class: 'banner', hidden: true });
const thread = h('div', { class: 'thread', attrs: { 'aria-live': 'polite' } });
const scroller = h('div', { class: 'scroll' }, banner, thread);

const input = h('textarea', { attrs: { rows: 1, placeholder: 'Ask your crew anything… (type @ to pick an agent)', 'aria-label': 'Message the crew' } });
const targetBtn = h('button', { class: 'target', type: 'button', title: 'Who gets this message', on: { click: (e) => openTargetMenu(e) } });
const sendBtn = h('button', { class: 'send', type: 'submit', title: 'Send (Enter)', attrs: { 'aria-label': 'Send' } }, svg(ICON.send, 18));
const composer = h(
  'form',
  { class: 'composer', on: { submit: (e) => (e.preventDefault(), void send()) } },
  input,
  h('div', { class: 'composer__row' }, targetBtn, h('span', { class: 'composer__hint' }, 'Enter to send · Shift+Enter for a new line'), sendBtn),
);
const main = h('main', { class: 'main' }, head, scroller, h('div', { class: 'composer-wrap' }, composer));

const boardList = h('div', { class: 'board__list' });
const boardCount = h('span', { class: 'pill', hidden: true });
const bellBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Notify me when an agent asks something', on: { click: () => askNotify() } }, svg(ICON.bell));
const board = h(
  'aside',
  { class: 'board', attrs: { 'aria-label': 'Questions for you' } },
  h('div', { class: 'board__head' }, h('h2', {}, 'Questions for you'), boardCount, bellBtn),
  boardList,
);
const scrim = h('div', { class: 'scrim', on: { click: () => root.classList.remove('show-side', 'show-board') } });

root.append(side, main, board, scrim);
root.removeAttribute('aria-busy');

function toggle(cls: 'show-side' | 'show-board'): void {
  const on = !root.classList.contains(cls);
  root.classList.remove('show-side', 'show-board');
  if (on) root.classList.add(cls);
}

scroller.addEventListener('scroll', () => head.classList.toggle('is-scrolled', scroller.scrollTop > 4));

// ---------------------------------------------------------------- agents (left)

function renderSide(): void {
  sideList.replaceChildren();
  for (const a of S.agents.values()) {
    const st = S.states.get(a.id);
    const open = [...S.questions.values()].filter((q) => q.agentId === a.id && q.status === 'open').length;
    const busy = st?.status === 'working' && st.activity;
    const meta = h('span', { class: 'agent__meta' });
    if (open) meta.append(h('span', { class: 'pill pill--warn', title: 'Waiting for you' }, `${open} ?`));
    else if (st?.queued) meta.append(h('span', { class: 'pill', title: 'Requests waiting' }, `+${st.queued}`));
    meta.append(
      h(
        'button',
        {
          class: 'agent__edit',
          type: 'button',
          title: `Settings of ${a.name}`,
          on: {
            click: (e) => {
              e.stopPropagation();
              editAgent(a.id);
            },
          },
        },
        svg(ICON.gear, 15),
      ),
    );
    const row = h(
      'div',
      {
        class: `agent${S.filter === a.id ? ' is-active' : ''}`,
        role: 'listitem',
        tabIndex: 0,
        title: a.description || a.role,
        on: {
          click: () => setFilter(S.filter === a.id ? '' : a.id),
          keydown: (e) => {
            if (e.key === 'Enter') setFilter(S.filter === a.id ? '' : a.id);
          },
        },
      },
      avatar(a, st?.status ?? 'idle'),
      h(
        'div',
        { style: 'min-width:0' },
        h('div', { class: 'agent__name' }, a.name, h('span', { class: 'agent__handle' }, `@${a.id}`)),
        h('div', { class: `agent__role${busy ? ' is-busy' : ''}` }, busy ? st!.activity! : st?.status === 'error' ? `⚠ ${st.lastError ?? 'last turn failed'}` : a.role || a.kind),
      ),
      meta,
    );
    sideList.append(row);
  }
  const working = [...S.states.values()].filter((s) => s.status === 'working').length;
  const cost = [...S.states.values()].reduce((n, s) => n + (s.costUsd || 0), 0);
  sideFoot.replaceChildren(
    h('a', { attrs: { href: '/' }, title: 'Back to the pixel office' }, '← Office'),
    h('span', { title: `Router: ${S.snap?.routerModel ?? ''} · ${S.live ? 'live' : 'reconnecting…'}` }, `${S.live ? '●' : '○'} ${working} working${cost ? ` · $${cost.toFixed(2)}` : ''}`),
  );
}

function setFilter(id: string): void {
  S.filter = id;
  if (id) setPicked(id);
  root.classList.remove('show-side');
  renderSide();
  renderTitle();
  renderThread(true);
}

function renderTitle(): void {
  const a = S.agents.get(S.filter);
  title.replaceChildren();
  if (a) {
    title.append(
      h(
        'span',
        { class: 'filter' },
        `${a.emoji} ${a.name} only`,
        h('button', { type: 'button', title: 'Show everyone', attrs: { 'aria-label': 'Show everyone' }, on: { click: () => setFilter('') } }, '×'),
      ),
    );
  } else title.append('Crew chat');
}

async function newAgent(): Promise<void> {
  root.classList.remove('show-side');
  const created = await openEditor({ agents: [...S.agents.values()] });
  if (created) toast(`${created.emoji} ${created.name} joined the crew as @${created.id}`);
}

async function editAgent(id: string): Promise<void> {
  const a = S.agents.get(id);
  if (!a) return;
  await openEditor({ agents: [...S.agents.values()], agent: a, state: S.states.get(id) });
}

// ---------------------------------------------------------------- conversation (center)

const nodes = new Map<string, HTMLElement>();
let stickToBottom = true;
scroller.addEventListener('scroll', () => {
  stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
});

function visible(m: CrewMessage): boolean {
  if (!S.filter) return true;
  if (m.agentId === S.filter) return true;
  if (m.targets?.includes(S.filter)) return true;
  if (m.kind === 'user') return S.messages.some((x) => x.replyTo === m.id && (x.agentId === S.filter || x.targets?.includes(S.filter)));
  return false;
}

function welcome(): HTMLElement {
  const crew = h('div', { class: 'welcome__crew' });
  for (const a of S.agents.values()) {
    crew.append(
      h(
        'button',
        { class: 'crew-card', type: 'button', title: `Talk to ${a.name}`, on: { click: () => (setPicked(a.id), input.focus()) } },
        avatar(a, S.states.get(a.id)?.status, 'sm'),
        h('div', {}, h('b', {}, `${a.name} `, h('span', { style: 'display:inline;color:var(--faint)' }, `@${a.id}`)), h('span', {}, a.role)),
      ),
    );
  }
  const ids = [...S.agents.keys()];
  const tries = [
    ids.includes('ho-oh') ? 'Make a 15-second launch teaser for our new dashboard, 16:9, upbeat' : '',
    ids.includes('giratina') ? 'Run a quick security scan of the API in my project folder and summarise the findings' : '',
    'What changed in our projects this week?',
  ].filter(Boolean);
  return h(
    'div',
    { class: 'welcome' },
    h('img', { class: 'welcome__mark', attrs: { src: '/assets/brand/logo-mark@4x.png', alt: '' } }),
    h('h1', {}, 'What should the crew work on?'),
    h('p', {}, 'Write once. The dispatcher hands each request to the right agent — each one keeps its own session, folder and memory. Their questions land on the board on the right.'),
    crew,
    h('div', { class: 'welcome__tries' }, ...tries.map((t) => h('button', { class: 'try', type: 'button', on: { click: () => ((input.value = t), autosize(), input.focus()) } }, t))),
  );
}

function renderMessage(m: CrewMessage): HTMLElement {
  if (m.kind === 'user') {
    const to = m.agentId ? S.agents.get(m.agentId) : undefined;
    return h('div', { class: 'msg msg--user' }, h('div', {}, to ? h('div', { class: 'to' }, `to ${to.emoji} ${to.name}`) : null, h('div', { class: 'bubble' }, m.text)));
  }
  if (m.kind === 'router' || m.kind === 'system') {
    const note = h('div', { class: `note${m.status === 'streaming' ? ' is-working' : ''}`, title: m.origin ? `via ${m.origin}` : '' });
    note.append(renderMarkdown(m.text));
    return h('div', { class: `msg msg--note msg--${m.kind}` }, note);
  }
  const a = m.agentId ? S.agents.get(m.agentId) : undefined;
  const live = m.status === 'streaming' || m.status === 'queued';
  const st = a ? S.states.get(a.id) : undefined;
  const body = h('div', { class: 'msg__body' });
  const status =
    m.status === 'queued'
      ? h('span', { class: 'pill' }, 'Queued')
      : m.status === 'streaming'
        ? h('span', { class: 'pill pill--accent' }, st?.status === 'waiting' ? 'Waiting for you' : 'Working')
        : m.status === 'error'
          ? h('span', { class: 'pill pill--danger' }, 'Error')
          : m.status === 'stopped'
            ? h('span', { class: 'pill' }, 'Stopped')
            : null;
  body.append(
    h(
      'div',
      { class: 'msg__head' },
      h('span', { class: 'msg__who' }, a?.name ?? m.agentId ?? 'Agent'),
      a?.role ? h('span', { class: 'msg__role' }, a.role) : null,
      status,
      h('time', { class: 'msg__time', title: new Date(m.at).toLocaleString() }, fmtTime(m.at)),
    ),
  );
  if (m.origin) body.append(h('div', { class: 'msg__origin' }, `↪ ${m.origin}`));
  const steps = m.steps ?? [];
  const done = steps.filter((s) => s.status !== 'running');
  if (done.length) {
    const det = h('details', { class: 'steps' }, h('summary', {}, `${done.length} step${done.length === 1 ? '' : 's'}`));
    const ul = h('ul', {});
    for (const s of done) {
      const li = h('li', { attrs: { 'data-s': s.status } });
      li.append(renderInline(s.label));
      ul.append(li);
    }
    det.append(ul);
    body.append(det);
  }
  if (m.text) body.append(md(m.text));
  const running = steps.filter((s) => s.status === 'running').at(-1);
  if (running && live) body.append(h('div', { class: 'live-step' }, running.label.replace(/`/g, '')));
  if (live && !m.text && !running) body.append(h('div', { class: 'typing', attrs: { 'aria-label': 'Working' } }, h('i', {}), h('i', {}), h('i', {})));
  const foot = h('div', { class: `msg__foot${live ? ' is-live' : ''}` });
  if (live && a) foot.append(h('button', { type: 'button', on: { click: () => void act(call('POST', `/api/crew/agents/${a.id}/stop`)) } }, '■ Stop'));
  if (!live && a) {
    foot.append(h('button', { type: 'button', title: `Send the next message to ${a.name}`, on: { click: () => (setPicked(a.id), input.focus()) } }, '↩ Reply'));
    foot.append(
      h(
        'button',
        {
          type: 'button',
          on: {
            click: async () => {
              await navigator.clipboard?.writeText(m.text).catch(() => undefined);
              toast('Copied');
            },
          },
        },
        'Copy',
      ),
    );
  }
  foot.append(h('span', { class: 'sep' }));
  const facts = [m.durationMs ? `${Math.round(m.durationMs / 1000)} s` : '', m.costUsd ? `$${m.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ');
  if (facts) foot.append(h('span', {}, facts));
  if (m.sessionId && !live && a) foot.append(h('button', { type: 'button', title: `Open this conversation in a terminal: cd "${a.folder}" then claude --resume ${m.sessionId}`, on: { click: () => copyResume(a, m.sessionId!) } }, 'Terminal'));
  body.append(foot);
  return h('div', { class: `msg msg--agent${live ? ' is-live' : ''}`, attrs: { 'data-id': m.id } }, avatar(a, st?.status), body);
}

/** Inline markdown only (step labels with `code`). */
function renderInline(text: string): Node {
  const frag = renderMarkdown(text);
  const p = frag.firstElementChild;
  const span = document.createElement('span');
  if (p) span.append(...p.childNodes);
  else span.textContent = text;
  return span;
}

async function copyResume(a: CrewAgent, sessionId: string): Promise<void> {
  const cmd = `cd "${a.folder}"; claude --resume ${sessionId}`;
  await navigator.clipboard?.writeText(cmd).catch(() => undefined);
  toast('Copied: paste it in a terminal to open this conversation');
}

function renderThread(force = false): void {
  const list = S.messages.filter(visible);
  if (!list.length) {
    nodes.clear();
    thread.replaceChildren(welcome());
    return;
  }
  if (force || thread.querySelector('.welcome')) {
    nodes.clear();
    thread.replaceChildren();
  }
  // Keep order: rebuild the list cheaply by reusing nodes.
  const want = new Set(list.map((m) => m.id));
  for (const [id, el] of nodes) if (!want.has(id)) (el.remove(), nodes.delete(id));
  let prev: HTMLElement | null = null;
  for (const m of list) {
    let el = nodes.get(m.id);
    if (!el) {
      el = renderMessage(m);
      nodes.set(m.id, el);
    }
    if (prev ? prev.nextSibling !== el : thread.firstChild !== el) {
      if (prev) prev.after(el);
      else thread.prepend(el);
    }
    prev = el;
  }
  if (stickToBottom) requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
}

function upsertMessage(m: CrewMessage): void {
  const i = S.messages.findIndex((x) => x.id === m.id);
  if (i >= 0) S.messages[i] = m;
  else S.messages.push(m);
  const old = nodes.get(m.id);
  if (old && visible(m)) {
    const el = renderMessage(m);
    old.replaceWith(el);
    nodes.set(m.id, el);
    if (stickToBottom) requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  } else renderThread();
}

const pendingDelta = new Set<string>();
function applyDelta(id: string, text: string): void {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  m.text += text;
  if (pendingDelta.has(id)) return;
  pendingDelta.add(id);
  requestAnimationFrame(() => {
    pendingDelta.delete(id);
    const cur = S.messages.find((x) => x.id === id);
    if (cur) upsertMessage(cur);
  });
}

async function clearChat(): Promise<void> {
  if (!confirm('Clear the crew chat history? The agents keep their sessions and memory.')) return;
  await act(call('DELETE', '/api/crew/messages'));
}

// ---------------------------------------------------------------- composer

function setPicked(id: string): void {
  S.picked = S.agents.has(id) ? id : '';
  try {
    localStorage.setItem(PICK_KEY, S.picked);
  } catch {
    // ignore
  }
  renderTarget();
}

function renderTarget(): void {
  const a = S.agents.get(S.picked);
  targetBtn.replaceChildren();
  if (a) targetBtn.append(avatar(a, undefined, 'xs'), `${a.name}`, svg(ICON.down, 14));
  else targetBtn.append(h('span', { class: 'avatar avatar--xs', style: '--c:var(--accent)' }, '✦'), 'Auto-route', svg(ICON.down, 14));
  input.placeholder = a ? `Message ${a.name}…` : 'Ask your crew anything… (type @ to pick an agent)';
}

let menu: HTMLElement | undefined;
function closeMenu(): void {
  menu?.remove();
  menu = undefined;
}
document.addEventListener('click', (e) => {
  if (menu && !menu.contains(e.target as Node) && e.target !== targetBtn && !targetBtn.contains(e.target as Node)) closeMenu();
});

function openTargetMenu(e: Event): void {
  e.preventDefault();
  if (menu) return closeMenu();
  const item = (id: string, icon: Node, name: string, sub: string) =>
    h('button', { class: `menu__item${S.picked === id ? ' is-sel' : ''}`, type: 'button', on: { click: () => (setPicked(id), closeMenu(), input.focus()) } }, icon, h('div', {}, h('b', {}, name), h('span', {}, sub)));
  menu = h(
    'div',
    { class: 'menu', role: 'menu', style: 'left:12px;bottom:calc(100% + 6px)' },
    item('', h('span', { class: 'menu__auto' }, '✦'), 'Auto-route', 'The dispatcher picks the right agent'),
    ...[...S.agents.values()].map((a) => item(a.id, avatar(a, S.states.get(a.id)?.status, 'sm'), `${a.name}  @${a.id}`, a.role)),
  );
  composer.append(menu);
}

// @mention autocomplete
let mention: { start: number; items: CrewAgent[]; sel: number } | undefined;
function updateMention(): void {
  const pos = input.selectionStart ?? 0;
  const before = input.value.slice(0, pos);
  const m = /(^|\s)@([\w-]*)$/.exec(before);
  if (!m) {
    if (mention) (mention = undefined), closeMenu();
    return;
  }
  const q = m[2].toLowerCase();
  const items = [...S.agents.values()].filter((a) => a.id.startsWith(q) || a.name.toLowerCase().startsWith(q) || (q.length > 1 && a.role.toLowerCase().includes(q))).slice(0, 8);
  if (!items.length) {
    mention = undefined;
    closeMenu();
    return;
  }
  mention = { start: pos - m[2].length - 1, items, sel: Math.min(mention?.sel ?? 0, items.length - 1) };
  drawMention();
}

function drawMention(): void {
  if (!mention) return;
  closeMenu();
  const mm = mention;
  menu = h(
    'div',
    { class: 'menu', role: 'listbox', style: 'left:12px;bottom:calc(100% + 6px)' },
    ...mm.items.map((a, i) =>
      h(
        'button',
        { class: `menu__item${i === mm.sel ? ' is-sel' : ''}`, type: 'button', on: { mousedown: (e) => (e.preventDefault(), pickMention(i)) } },
        avatar(a, S.states.get(a.id)?.status, 'sm'),
        h('div', {}, h('b', {}, `@${a.id}`), h('span', {}, `${a.name} · ${a.role}`)),
      ),
    ),
  );
  composer.append(menu);
}

function pickMention(i: number): void {
  if (!mention) return;
  const a = mention.items[i];
  const pos = input.selectionStart ?? 0;
  input.value = `${input.value.slice(0, mention.start)}@${a.id} ${input.value.slice(pos)}`;
  const caret = mention.start + a.id.length + 2;
  input.setSelectionRange(caret, caret);
  mention = undefined;
  closeMenu();
  autosize();
}

function autosize(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
  sendBtn.disabled = !input.value.trim() || !S.snap?.enabled;
}

input.addEventListener('input', () => (autosize(), updateMention()));
input.addEventListener('click', updateMention);
input.addEventListener('keydown', (e) => {
  if (mention) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mention.sel = (mention.sel + (e.key === 'ArrowDown' ? 1 : -1) + mention.items.length) % mention.items.length;
      drawMention();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mention.sel);
      return;
    }
    if (e.key === 'Escape') {
      mention = undefined;
      closeMenu();
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
});

let sending = false;
async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  sendBtn.disabled = true;
  const r = await act(call<CrewMessage>('POST', '/api/crew/chat', { text, agent: S.picked || undefined }));
  sending = false;
  if (r) {
    input.value = '';
    stickToBottom = true;
  }
  autosize();
  input.focus();
}

// ---------------------------------------------------------------- Q&A board (right)

function renderBoard(): void {
  const all = [...S.questions.values()].sort((a, b) => a.at - b.at);
  const open = all.filter((q) => q.status === 'open');
  const closed = all.filter((q) => q.status !== 'open').reverse().slice(0, 30);
  boardCount.hidden = !open.length;
  boardCount.textContent = String(open.length);
  boardCount.className = `pill${open.length ? ' pill--warn' : ''}`;
  boardBtn.querySelector('.badge')?.remove();
  if (open.length) boardBtn.append(h('span', { class: 'badge' }, String(open.length)));
  document.title = open.length ? `(${open.length}) Crew · JGENTS` : 'Crew · JGENTS';
  // Keep what the user is typing in an open card.
  const drafts = new Map<string, string>();
  for (const ta of boardList.querySelectorAll<HTMLTextAreaElement>('textarea[data-q]')) drafts.set(ta.dataset.q!, ta.value);
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.q;
  boardList.replaceChildren();
  if (!open.length) {
    boardList.append(h('div', { class: 'board__empty' }, h('b', {}, 'Nothing needs you'), 'When an agent needs a decision, a detail or your OK to run something, it shows up here.'));
  }
  for (const q of open) boardList.append(questionCard(q, drafts.get(q.id)));
  if (closed.length) {
    const det = h('details', { class: 'board__history' }, h('summary', {}, `Answered (${closed.length})`));
    for (const q of closed) det.append(questionCard(q));
    boardList.append(det);
  }
  if (focused) boardList.querySelector<HTMLTextAreaElement>(`textarea[data-q="${focused}"]`)?.focus();
}

function questionCard(q: CrewQuestion, draft?: string): HTMLElement {
  const a = S.agents.get(q.agentId);
  const card = h('div', { class: `q q--${q.kind}${q.status === 'open' ? ' is-open' : ''}` });
  card.append(
    h(
      'div',
      { class: 'q__head' },
      avatar(a, undefined, 'sm'),
      h('b', {}, a?.name ?? q.agentId),
      q.kind === 'approval' ? 'wants to' : 'asks',
      h('time', { title: new Date(q.at).toLocaleString() }, ago(q.at)),
    ),
  );
  card.append(h('div', { class: 'q__text' }, q.text));
  if (q.context) card.append(h('div', { class: 'q__context' }, q.context));
  if (q.preview) card.append(h('pre', { class: 'q__preview' }, q.preview));
  if (q.status !== 'open') {
    const label =
      q.status === 'answered' ? h('span', {}, 'You answered: ', h('b', {}, q.answer ?? '')) : q.status === 'allowed' ? 'Allowed' : q.status === 'denied' ? `Denied${q.answer ? `: ${q.answer}` : ''}` : q.status === 'expired' ? 'Expired (the turn ended)' : 'Dismissed';
    card.append(h('div', { class: 'q__result' }, label));
    return card;
  }
  const answer = (body: Record<string, unknown>) => void act(call('POST', `/api/crew/questions/${q.id}`, body));
  if (q.kind === 'question') {
    if (q.options?.length) card.append(h('div', { class: 'q__opts' }, ...q.options.map((o) => h('button', { class: 'q__opt', type: 'button', on: { click: () => answer({ action: 'answer', answer: o }) } }, o))));
    const ta = h('textarea', { attrs: { rows: 1, placeholder: q.options?.length ? 'Or write your own answer…' : 'Your answer…', 'data-q': q.id } });
    ta.value = draft ?? '';
    const submit = () => ta.value.trim() && answer({ action: 'answer', answer: ta.value.trim() });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    ta.addEventListener('input', () => ((ta.style.height = 'auto'), (ta.style.height = `${ta.scrollHeight}px`)));
    card.append(h('div', { class: 'q__answer' }, ta, h('button', { class: 'btn btn--primary', type: 'button', on: { click: submit } }, 'Answer')));
    card.append(h('div', { class: 'q__actions' }, h('button', { class: 'btn btn--ghost', type: 'button', on: { click: () => answer({ action: 'dismiss' }) } }, 'Dismiss')));
  } else {
    const note = h('textarea', { attrs: { rows: 1, placeholder: 'Note for the agent if you deny (optional)', 'data-q': q.id } });
    note.value = draft ?? '';
    card.append(
      h(
        'div',
        { class: 'q__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', on: { click: () => answer({ action: 'allow' }) } }, 'Allow'),
        h('button', { class: 'btn', type: 'button', title: `Allow this and similar calls for ${a?.name ?? 'this agent'} from now on`, on: { click: () => answer({ action: 'allow', always: true }) } }, 'Always allow'),
        h('button', { class: 'btn btn--danger', type: 'button', on: { click: () => answer({ action: 'deny', answer: note.value.trim() || undefined }) } }, 'Deny'),
      ),
      h('div', { class: 'q__answer' }, note),
    );
  }
  return card;
}

function askNotify(): void {
  if (!('Notification' in window)) return toast('This browser has no notifications');
  if (Notification.permission === 'granted') return toast('Notifications are on');
  void Notification.requestPermission().then((p) => toast(p === 'granted' ? 'You will be notified when an agent asks something' : 'Notifications are blocked'));
}

function notifyNew(q: CrewQuestion): void {
  if (S.seenQuestions.has(q.id)) return;
  S.seenQuestions.add(q.id);
  if (q.status !== 'open' || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const a = S.agents.get(q.agentId);
  try {
    const n = new Notification(`${a?.emoji ?? ''} ${a?.name ?? q.agentId} ${q.kind === 'approval' ? 'needs your OK' : 'asks'}`, { body: q.text, tag: q.id, icon: '/assets/brand/icon-192.png' });
    n.onclick = () => (window.focus(), n.close());
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- data

function applySnapshot(s: CrewSnapshot): void {
  S.snap = s;
  S.agents = new Map(s.agents.map((a) => [a.id, a]));
  S.states = new Map(s.states.map((x) => [x.id, x]));
  S.messages = [...s.messages];
  S.questions = new Map(s.questions.map((q) => [q.id, q]));
  for (const q of s.questions) S.seenQuestions.add(q.id);
  if (S.picked && !S.agents.has(S.picked)) setPicked('');
  if (S.filter && !S.agents.has(S.filter)) S.filter = '';
  banner.hidden = s.enabled;
  if (!s.enabled) banner.textContent = `The crew is off: ${s.reason ?? 'unknown reason'}.`;
  input.disabled = !s.enabled;
  renderSide();
  renderTitle();
  renderTarget();
  renderThread(true);
  renderBoard();
  autosize();
}

async function start(): Promise<void> {
  try {
    applySnapshot(await call<CrewSnapshot>('GET', '/api/crew'));
  } catch (err) {
    banner.hidden = false;
    banner.textContent = `Could not load the crew: ${(err as Error).message}`;
  }
  connect(
    {
      snapshot: applySnapshot,
      message: (m) => upsertMessage(m),
      delta: (d) => applyDelta(d.id, d.text),
      state: (st) => {
        S.states.set(st.id, st);
        renderSide();
        for (const m of S.messages) if (m.agentId === st.id && (m.status === 'streaming' || m.status === 'queued')) upsertMessage(m);
      },
      question: (q) => {
        S.questions.set(q.id, q);
        notifyNew(q);
        renderBoard();
        renderSide();
      },
      agents: (list) => {
        S.agents = new Map(list.map((a) => [a.id, a]));
        renderSide();
        renderTarget();
        renderThread(true);
      },
      cleared: () => undefined,
    },
    (live) => {
      S.live = live;
      renderSide();
    },
  );
  input.focus();
}

// Refresh the "x min ago" on the board (not while you are typing an answer).
setInterval(() => {
  if (!(document.activeElement instanceof HTMLTextAreaElement && boardList.contains(document.activeElement))) renderBoard();
}, 60_000);

void start();
