// The agent editor: add an agent to the crew or change one. Suggests a legendary Pokémon for the kind of work (the
// name makes the handle easy to remember), the folder from recent projects, and shows whether the agent's toolbox
// (claude, ffmpeg, docker, strix…) is ready.
import { CREW_KINDS, CREW_LEGENDS, crewSlug, suggestLegend, type CrewAgent, type CrewAgentState, type CrewKind, type CrewPermissionMode, type CrewSession, type CrewToolCheck } from '../../../shared/crew';
import { h } from '../ui/dom';
import { ApiError, call } from './api';

const KIND_LABEL: Record<CrewKind, string> = {
  project: 'Project — owns one repository',
  video: 'Video — HyperFrames studio',
  security: 'Security — pentests with Strix',
  general: 'General — questions, research, planning',
  custom: 'Custom',
};

const MODE_LABEL: Record<CrewPermissionMode, string> = {
  ask: 'Ask me on the board (your Claude Code rules apply)',
  acceptEdits: 'Edit files freely, ask me for the rest',
  auto: 'Auto mode decides, asks me when unsure',
  bypassPermissions: 'Never ask (only for folders you fully trust)',
};

const KIND_DEFAULTS: Record<CrewKind, { role: string; description: string; mode: CrewPermissionMode }> = {
  project: { role: '', description: '', mode: 'acceptEdits' },
  video: { role: 'Video studio: videos and motion graphics with HyperFrames', description: 'Makes videos, promos, explainers, captions and motion graphics with HyperFrames.', mode: 'acceptEdits' },
  security: { role: 'Security tracker: penetration tests with Strix', description: 'Security reviews and authorised penetration tests with Strix.', mode: 'ask' },
  general: { role: 'Concierge: general questions, research and planning', description: 'General questions, research, writing and planning.', mode: 'ask' },
  custom: { role: '', description: '', mode: 'ask' },
};

interface Opts {
  agents: CrewAgent[];
  agent?: CrewAgent;
  state?: CrewAgentState;
}

function field(label: string, control: HTMLElement, hint?: string, wide = false): HTMLElement {
  return h('label', { class: `field${wide ? ' field--wide' : ''}` }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
}

export function openEditor(opts: Opts): Promise<CrewAgent | undefined> {
  const editing = opts.agent;
  const taken = opts.agents.filter((a) => a.id !== editing?.id).map((a) => a.name);
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'editor', attrs: { 'aria-label': editing ? `Settings of ${editing.name}` : 'New agent' } });
    const kind = h('select', {}, ...CREW_KINDS.map((k) => h('option', { attrs: { value: k } }, KIND_LABEL[k])));
    const name = h('input', { attrs: { required: true, maxlength: 40, placeholder: 'Dialga' } });
    const handle = h('input', { attrs: { maxlength: 24, placeholder: 'dialga', pattern: '[a-z0-9][a-z0-9-]*' } });
    const emoji = h('input', { attrs: { maxlength: 8 } });
    const color = h('input', { type: 'color' });
    const role = h('input', { attrs: { maxlength: 80, placeholder: 'IBC Auto: API (.NET) + UI (Angular)' } });
    const description = h('textarea', { attrs: { rows: 2, maxlength: 1200, placeholder: 'What this agent handles — the dispatcher reads this to route requests. E.g. "Everything about IBC Auto: the API, payments, account summary and the Monalisa UI."' } });
    const keywords = h('input', { attrs: { placeholder: 'ibc, ibcauto, monalisa, payments' } });
    const folder = h('input', { attrs: { required: true, list: 'crew-folders', placeholder: 'C:\\Projects\\REVAMP\\IBCAuto.Api' } });
    const folders = h('datalist', { attrs: { id: 'crew-folders' } });
    const extra = h('textarea', { attrs: { rows: 2, placeholder: 'One folder per line, e.g. the UI next to the API:\nC:\\Projects\\IBC\\Project.Monalisa' } });
    const sessionPick = h('select', {});
    const sessionMode = h(
      'select',
      {},
      h('option', { attrs: { value: 'resume' } }, 'Take over: continue that conversation'),
      h('option', { attrs: { value: 'fork' } }, 'Fork: start from a copy (original untouched)'),
    );
    const sessionNote = h('small', {});
    const instructions = h('textarea', { attrs: { rows: 3, placeholder: 'Standing instructions (optional): conventions, what never to touch, how to test…' } });
    const model = h('input', { attrs: { list: 'crew-models', placeholder: 'Default' } });
    const models = h('datalist', { attrs: { id: 'crew-models' } }, ...['opus', 'sonnet', 'haiku'].map((m) => h('option', { attrs: { value: m } })));
    const mode = h('select', {}, ...(Object.keys(MODE_LABEL) as CrewPermissionMode[]).map((m) => h('option', { attrs: { value: m } }, MODE_LABEL[m])));
    const allowed = h('textarea', { attrs: { rows: 2, placeholder: 'One rule per line, e.g. Bash(npm test:*)' } });
    const legends = h('div', { class: 'legends' });
    const tools = h('div', { class: 'tools', hidden: true });
    const error = h('div', { class: 'form-error', role: 'alert' });

    const a = editing;
    kind.value = a?.kind ?? 'project';
    name.value = a?.name ?? '';
    handle.value = a?.id ?? '';
    handle.disabled = !!a;
    emoji.value = a?.emoji ?? '';
    color.value = a?.color ?? '#0f766e';
    role.value = a?.role ?? '';
    description.value = a?.description ?? '';
    keywords.value = a?.keywords.join(', ') ?? '';
    folder.value = a?.folder ?? '';
    extra.value = a?.extraFolders.join('\n') ?? '';
    instructions.value = a?.instructions ?? '';
    model.value = a?.model ?? '';
    mode.value = a?.permissionMode ?? 'acceptEdits';
    allowed.value = a?.allowedTools.join('\n') ?? '';

    let handleTouched = !!a;
    handle.addEventListener('input', () => (handleTouched = true));
    name.addEventListener('input', () => {
      if (!handleTouched) handle.value = crewSlug(name.value);
      drawLegends();
    });

    const applyLegend = (n: string) => {
      const l = CREW_LEGENDS.find((x) => x.name === n);
      if (!l) return;
      name.value = l.name;
      if (!handleTouched) handle.value = crewSlug(l.name);
      emoji.value = l.emoji;
      color.value = l.color;
      drawLegends();
    };
    function drawLegends(): void {
      legends.replaceChildren(
        h('span', { style: 'font-size:12.5px;color:var(--muted);font-weight:600;align-self:center' }, 'Legendaries:'),
        ...CREW_LEGENDS.map((l) =>
          h(
            'button',
            {
              class: `legend${name.value === l.name ? ' is-on' : ''}`,
              type: 'button',
              title: `${l.why} — fits ${l.fits.join(', ')}`,
              attrs: { disabled: taken.includes(l.name) },
              on: { click: () => applyLegend(l.name) },
            },
            l.emoji,
            l.name,
          ),
        ),
      );
    }
    kind.addEventListener('change', () => {
      const k = kind.value as CrewKind;
      const d = KIND_DEFAULTS[k];
      if (!a) {
        mode.value = d.mode;
        if (d.role && !role.value) role.value = d.role;
        if (d.description && !description.value) description.value = d.description;
        const isLegend = !name.value || CREW_LEGENDS.some((l) => l.name === name.value);
        const s = suggestLegend(k, taken);
        if (isLegend && s) applyLegend(s.name);
      }
    });
    if (!a) {
      const s = suggestLegend('project', taken);
      if (s) applyLegend(s.name);
    }
    drawLegends();

    void call<{ folders: string[] }>('GET', '/api/crew/folders')
      .then((r) => folders.replaceChildren(...r.folders.map((f) => h('option', { attrs: { value: f } }))))
      .catch(() => undefined);

    // Sessions in the main folder: start the agent from one of yours (Claude Code desktop, terminal or IDE).
    let sessions: CrewSession[] = [];
    const tail = (f: string) => f.split(/[\\/]/).filter(Boolean).pop() ?? f;
    const describe = (x: CrewSession) =>
      `${new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${x.title} · ${tail(x.folder)}${x.current ? ' (current)' : ''}${x.open ? ' · open now' : ''}`;
    const updateNote = () => {
      const x = sessions.find((y) => y.id === sessionPick.value);
      sessionMode.disabled = !x;
      if (x?.open && sessionMode.value === 'resume') sessionMode.value = 'fork';
      sessionNote.textContent = !x
        ? a
          ? 'Keeps the conversation it has now.'
          : 'Starts a new conversation on its first request.'
        : x.folder !== folder.value.trim() && x.folder.toLowerCase() !== folder.value.trim().toLowerCase()
          ? `This session lives in ${tail(x.folder)}: that folder becomes the agent's working folder, the others stay as extra folders.`
          : x.open
          ? 'Open in Claude Code right now: only a fork is possible until you close it there.'
          : sessionMode.value === 'resume'
            ? 'The agent continues this conversation with everything in it. Don’t keep it open in Claude Code while the agent works.'
            : 'The agent starts from a copy; you can keep using the original in Claude Code.';
    };
    const loadSessions = async () => {
      const f = folder.value.trim();
      sessions = [];
      if (f) {
        const q = new URLSearchParams(a ? { agent: a.id } : {});
        for (const d of [f, ...extra.value.split('\n')].map((x) => x.trim()).filter(Boolean)) q.append('folder', d);
        sessions = (await call<{ sessions: CrewSession[] }>('GET', `/api/crew/sessions?${q}`).catch(() => ({ sessions: [] as CrewSession[] }))).sessions;
      }
      sessionPick.replaceChildren(
        h('option', { attrs: { value: '' } }, a ? 'Keep its current conversation' : 'New conversation'),
        ...sessions.map((x) => h('option', { attrs: { value: x.id, disabled: !!x.current } }, describe(x))),
      );
      sessionPick.disabled = !sessions.length;
      updateNote();
    };
    let folderTimer: ReturnType<typeof setTimeout> | undefined;
    for (const el of [folder, extra]) {
      el.addEventListener('input', () => {
        clearTimeout(folderTimer);
        folderTimer = setTimeout(() => void loadSessions(), 400);
      });
    }
    sessionPick.addEventListener('change', updateNote);
    sessionMode.addEventListener('change', updateNote);
    void loadSessions();

    if (a) {
      void call<{ tools: CrewToolCheck[] }>('GET', `/api/crew/agents/${a.id}/tools`)
        .then((r) => {
          tools.hidden = false;
          tools.replaceChildren(
            h('b', {}, 'Toolbox'),
            ...r.tools.map((t) => h('div', { class: 'tool' }, h('span', { class: t.found ? 'ok' : 'no' }, t.found ? '✓' : '✗'), h('span', {}, t.name), h('small', {}, t.found ? (t.path ?? 'set') : t.hint))),
          );
        })
        .catch(() => undefined);
    }

    const close = (result?: CrewAgent) => {
      dlg.close();
      dlg.remove();
      resolve(result);
    };

    const save = async () => {
      error.textContent = '';
      const body = {
        ...(a ? {} : { id: handle.value.trim() || undefined }),
        kind: kind.value,
        name: name.value,
        emoji: emoji.value,
        color: color.value,
        role: role.value,
        description: description.value,
        keywords: keywords.value,
        folder: folder.value,
        extraFolders: extra.value.split('\n'),
        instructions: instructions.value,
        model: model.value,
        permissionMode: mode.value,
        allowedTools: allowed.value.split('\n'),
      };
      try {
        const r = a ? await call<CrewAgent>('PUT', `/api/crew/agents/${a.id}`, body) : await call<CrewAgent>('POST', '/api/crew/agents', body);
        if (sessionPick.value) {
          try {
            await call('POST', `/api/crew/agents/${r.id}/session`, { sessionId: sessionPick.value, mode: sessionMode.value });
          } catch (err) {
            // The agent is saved, but the session was refused (e.g. open in Claude Code): say so where it shows.
            const why = err instanceof ApiError ? err.message : String(err);
            if (a) {
              error.textContent = `Saved, but the session was not set: ${why}`;
              return;
            }
            alert(`${r.name} was added, but the session was not set: ${why}`);
          }
        }
        close(r);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : String(err);
      }
    };

    const foot = h('div', { class: 'editor__foot' });
    if (a) {
      foot.append(
        h(
          'button',
          {
            class: 'btn btn--ghost',
            type: 'button',
            title: 'Forget the conversation: the next request starts a new Claude Code session (files stay)',
            on: {
              click: async () => {
                await call('POST', `/api/crew/agents/${a.id}/reset`).catch(() => undefined);
                close();
              },
            },
          },
          '🧹 Fresh start',
        ),
        h(
          'button',
          {
            class: 'btn btn--danger',
            type: 'button',
            on: {
              click: async () => {
                if (!confirm(`Remove ${a.name} from the crew? Its folder and Claude Code sessions stay on disk.`)) return;
                await call('DELETE', `/api/crew/agents/${a.id}`).catch(() => undefined);
                close();
              },
            },
          },
          'Remove',
        ),
      );
    }
    foot.append(h('span', { class: 'grow' }), error, h('button', { class: 'btn', type: 'button', on: { click: () => close() } }, 'Cancel'), h('button', { class: 'btn btn--primary', type: 'submit' }, a ? 'Save' : 'Add to the crew'));

    const session = a && opts.state?.sessionId ? h('div', { class: 'session' }, 'Session:', h('code', {}, `claude --resume ${opts.state.sessionId}`), `· ${opts.state.turns} turns · $${opts.state.costUsd.toFixed(2)}`) : null;

    const form = h(
      'form',
      {
        on: {
          submit: (e) => {
            e.preventDefault();
            void save();
          },
        },
      },
      h('div', { class: 'editor__head' }, h('h2', {}, a ? `${a.emoji} ${a.name}` : 'New agent'), h('button', { class: 'btn btn--ghost', type: 'button', attrs: { 'aria-label': 'Close' }, on: { click: () => close() } }, '✕')),
      h(
        'div',
        { class: 'editor__body' },
        field('Kind of work', kind, undefined, true),
        legends,
        field('Name', name),
        field('Handle', handle, a ? 'Used in @mentions; fixed once created.' : 'For @mentions: lowercase, digits, dashes.'),
        h('div', { class: 'row2' }, field('Icon', emoji), field('Colour', color)),
        field('Role (one line)', role),
        field('What it handles', description, 'The dispatcher reads this to decide who gets a request.', true),
        field('Keywords', keywords, 'Comma separated: product names, modules, tools.', true),
        field('Working folder', folder, 'The agent works here and reads its CLAUDE.md. Its conversation lives in this folder.', true),
        folders,
        field('Also works in', extra, 'Other folders of the same product (e.g. the UI next to the API).', true),
        field('Start from a session', sessionPick, 'Your recent Claude Code sessions in these folders.', true),
        h('label', { class: 'field field--wide' }, sessionMode, sessionNote),
        field('Standing instructions', instructions, undefined, true),
        field('Model', model, 'Empty = your Claude Code default.'),
        models,
        field('Permissions', mode),
        field('Always allowed tools', allowed, '“Always allow” on the board adds rules here.', true),
        tools,
        session,
      ),
      foot,
    );
    dlg.append(form);
    dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
    document.body.append(dlg);
    dlg.showModal();
    (a ? role : folder).focus();
  });
}
