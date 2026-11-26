// The company: a CEO the user talks to and departments it briefs, created in one go on top of the crew (each one a
// Crew agent with its own workspace and session). They share one company folder (<dataDir>/company): profile.md, which
// the user fills in and everyone reads; outbox/, where finished work lands for the user; and log.jsonl, the record of
// every request, brief, report and answer (the CEO reads it for "daily report"). Departments draft; the user acts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppearanceParts } from '../../shared/appearance';
import type { CompanyEvent, CompanyEventType, CompanyFileText, CrewAgent } from '../../shared/crew';
import { workspacesDir } from './roster';

export function companyDir(dataDir: string): string {
  return join(dataDir, 'company');
}

interface Spec {
  id: string;
  name: string;
  role: string;
  description: string;
  keywords: string[];
  emoji: string;
  /** Department colour: the shirt and badge of its uniform, its accent in the chat. */
  color: string;
  /** The face in the office (character seed and look), the same as in the approved mockup. */
  seed: number;
  look: 'f' | 'm';
  /** Name tag in the office. */
  short: string;
}

export const CEO_SPEC: Spec = {
  id: 'ceo',
  name: 'CEO',
  role: 'Runs the company: takes your requests, briefs the departments, answers you',
  description: 'Every request to the company goes to the CEO, who plans it, briefs the right departments, checks and combines their work and answers once. Also gives reports on what the company did.',
  keywords: ['company', 'ceo', 'report', 'status', 'plan', 'delegate'],
  emoji: '👔',
  color: '#fac665',
  seed: 4021,
  look: 'm',
  short: 'CEO',
};

/** Every department a full company has, in the order the office and the console show them. */
export const DEPARTMENTS: readonly Spec[] = [
  { id: 'assistant', name: 'Executive Assistant', role: 'Calendar, follow-ups, meeting notes, the inbox', description: 'Schedules, reminders, follow-up lists, meeting agendas and notes, travel plans, tidy summaries of long threads, the CEO\'s to-do list.', keywords: ['schedule', 'calendar', 'meeting', 'agenda', 'reminder', 'follow-up', 'notes', 'travel'], emoji: '🗂️', color: '#f4f1ea', seed: 8812, look: 'f', short: 'Assistant' },
  { id: 'accounting', name: 'Finance & Accounting', role: 'Budgets, costs, invoices, pricing, cash flow', description: 'Budgets and forecasts, cost breakdowns, pricing and margins, invoice and quote drafts, cash-flow sheets, payroll figures, tax-time checklists (flags what a real accountant must check).', keywords: ['budget', 'cost', 'invoice', 'quote', 'price', 'pricing', 'margin', 'tax', 'payroll', 'cash', 'expense', 'salary'], emoji: '💰', color: '#4fd18b', seed: 1187, look: 'f', short: 'Finance' },
  { id: 'hr', name: 'HR & People', role: 'Hiring, onboarding, policies, people', description: 'Job descriptions, hiring steps and interview questions, onboarding checklists, contracts of employment drafts, policies, leave and benefits, team culture.', keywords: ['hire', 'hiring', 'job', 'recruit', 'interview', 'onboarding', 'policy', 'employee', 'leave', 'benefits'], emoji: '🧑‍🤝‍🧑', color: '#e0568f', seed: 2290, look: 'f', short: 'HR' },
  { id: 'legal', name: 'Legal & Compliance', role: 'Contracts, terms, privacy, regulations', description: 'Reads and drafts contracts, terms of service, privacy policies, NDAs; checks laws and regulations that apply; flags risks. Not a lawyer: says plainly what a real lawyer should review.', keywords: ['contract', 'legal', 'law', 'terms', 'privacy', 'nda', 'compliance', 'regulation', 'license', 'gdpr'], emoji: '⚖️', color: '#c9cdd6', seed: 7751, look: 'f', short: 'Legal' },
  { id: 'marketing', name: 'Marketing', role: 'Brand, campaigns, content, social', description: 'Positioning, campaigns, social posts, content calendars, landing page copy, ads drafts, newsletters, launch plans.', keywords: ['marketing', 'campaign', 'post', 'social', 'content', 'brand', 'ads', 'newsletter', 'launch', 'seo'], emoji: '📣', color: '#ff8a3d', seed: 3317, look: 'm', short: 'Marketing' },
  { id: 'comms', name: 'PR & Communications', role: 'Announcements, press, internal comms', description: 'Press releases, announcements, statements, internal memos, speaking notes, crisis replies.', keywords: ['press', 'announcement', 'statement', 'memo', 'communication', 'pr', 'speech'], emoji: '🎙️', color: '#e879f9', seed: 9123, look: 'f', short: 'PR' },
  { id: 'sales', name: 'Sales & Partnerships', role: 'Offers, proposals, leads, partners', description: 'Offers and proposals, outreach drafts, lead lists, follow-up sequences, partnership pitches, sales scripts.', keywords: ['sales', 'proposal', 'offer', 'lead', 'client', 'customer', 'pitch', 'partner', 'deal', 'outreach'], emoji: '🤝', color: '#7cc8ff', seed: 5530, look: 'f', short: 'Sales' },
  { id: 'support', name: 'Customer Support', role: 'FAQs, support replies, customer care', description: 'Support reply drafts, FAQs, help articles, complaint handling, customer onboarding guides.', keywords: ['support', 'faq', 'help', 'complaint', 'reply', 'ticket', 'customer service'], emoji: '🎧', color: '#3cd8d2', seed: 6120, look: 'm', short: 'Support' },
  { id: 'ops', name: 'Operations', role: 'Processes, checklists, logistics, vendors', description: 'Processes and SOPs, checklists, schedules, logistics, vendor coordination, workflows and how things run day to day.', keywords: ['process', 'operations', 'workflow', 'checklist', 'sop', 'logistics', 'schedule', 'vendor'], emoji: '⚙️', color: '#9b7cf0', seed: 6642, look: 'm', short: 'Operations' },
  { id: 'procurement', name: 'Procurement', role: 'Buying, quotes from suppliers, comparisons', description: 'Compares products and suppliers, gathers quotes, buying checklists, total cost comparisons. Never buys anything: recommends.', keywords: ['buy', 'purchase', 'supplier', 'vendor', 'compare', 'quote', 'procurement'], emoji: '🛒', color: '#c9a06a', seed: 2741, look: 'm', short: 'Procurement' },
  { id: 'product', name: 'Product', role: 'Roadmap, specs, user research', description: 'Product ideas, roadmaps, feature specs, user stories, priorities, user research questions and summaries.', keywords: ['product', 'feature', 'roadmap', 'spec', 'requirement', 'user story', 'mvp'], emoji: '🧭', color: '#5b8def', seed: 3908, look: 'f', short: 'Product' },
  { id: 'engineering', name: 'Engineering & IT', role: 'Tech plans, tools, IT setup, security basics', description: 'Technical plans and estimates, tool choices, IT setup, accounts and devices, security basics. Hands real code changes to the project agents.', keywords: ['tech', 'engineering', 'it', 'software', 'tool', 'setup', 'server', 'website', 'app'], emoji: '🛠️', color: '#6aa8ff', seed: 4475, look: 'm', short: 'IT' },
  { id: 'design', name: 'Design & Creative', role: 'Visuals, brand assets, layouts', description: 'Visual concepts, brand guidelines, layout and slide ideas, image prompts, mood boards, design feedback.', keywords: ['design', 'logo', 'visual', 'brand', 'layout', 'image', 'creative', 'mockup', 'slides'], emoji: '🎨', color: '#ff6b9d', seed: 5013, look: 'f', short: 'Design' },
  { id: 'data', name: 'Data & Analytics', role: 'Reports, numbers, dashboards', description: 'Reports from numbers, spreadsheets and dashboards, KPIs, charts, cleaning and analysing data the user provides.', keywords: ['data', 'report', 'analytics', 'kpi', 'chart', 'spreadsheet', 'numbers', 'metrics', 'dashboard'], emoji: '📊', color: '#ffd166', seed: 5891, look: 'm', short: 'Data' },
  { id: 'research', name: 'Research & Strategy', role: 'Market research, competitors, strategy', description: 'Market and competitor research, trends, opportunities, business strategy, SWOT, decision memos with sources.', keywords: ['research', 'market', 'competitor', 'strategy', 'trend', 'analysis', 'swot'], emoji: '🔭', color: '#a3e635', seed: 7064, look: 'm', short: 'Research' },
  { id: 'training', name: 'Knowledge & Training', role: 'SOPs, guides, internal knowledge', description: 'Internal guides and how-tos, training material, onboarding docs, keeping the company knowledge tidy.', keywords: ['guide', 'training', 'docs', 'documentation', 'how-to', 'knowledge', 'manual'], emoji: '📚', color: '#94a3b8', seed: 8277, look: 'f', short: 'Training' },
];

/** The company uniform: a navy blazer over a shirt in the department's colour, dark trousers and shoes. */
export function uniform(color: string): AppearanceParts {
  return { topStyle: 'jacket', top: '#2c3a57', topAccent: color, bottomStyle: 'pants', bottom: '#272c38', shoes: '#1b1d24', accessory: 'none' };
}

/** Who a company member is in the office (its face and name tag), by Crew id. */
export function memberLook(id: string): Pick<Spec, 'seed' | 'look' | 'short'> | undefined {
  return [CEO_SPEC, ...DEPARTMENTS].find((s) => s.id === id);
}

/** Is `path` the folder or inside it? Windows paths compare without case. */
export function insideFolder(path: string, folder: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '');
  let a = norm(path);
  let b = norm(folder);
  if (/^[a-z]:/i.test(a) || process.platform === 'win32') {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}\\`);
}

/** The CEO and every department as Crew agents (workspaces under <dataDir>/crew/workspaces, the company folder shared). */
export function companyAgents(dataDir: string): CrewAgent[] {
  const ws = workspacesDir(dataDir);
  const shared = companyDir(dataDir);
  const base = { instructions: '', allowedTools: [] as string[], extraFolders: [shared] };
  return [
    { ...base, ...CEO_SPEC, kind: 'ceo', folder: join(ws, CEO_SPEC.id), model: 'opus', permissionMode: 'acceptEdits' },
    ...DEPARTMENTS.map((d): CrewAgent => ({ ...base, ...d, kind: 'department', folder: join(ws, d.id), model: 'sonnet', permissionMode: 'acceptEdits' })),
  ];
}

const PROFILE = `# Company profile

Every department reads this before it works. Fill it in and keep it current.

- Company name:
- What we do:
- Our customers:
- Country, currency and tax rules that apply:
- Tone of voice:
- Brand colours and fonts:
- Things we never do:
`;

/** Creates the company folder (profile, outbox) the first time; returns it. */
export function ensureCompanyFolder(dataDir: string): string {
  const dir = companyDir(dataDir);
  mkdirSync(join(dir, 'outbox'), { recursive: true });
  const profile = join(dir, 'profile.md');
  if (!existsSync(profile)) writeFileSync(profile, PROFILE);
  return dir;
}

export type { CompanyEvent, CompanyEventType } from '../../shared/crew';

const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_TEXT = 400;
/** Events kept in memory (and read back from the file at start). */
const LOG_KEEP = 500;
const EVENT_TYPES: ReadonlySet<string> = new Set<CompanyEventType>(['request', 'brief', 'report', 'answer']);

/** The last `n` well-formed events of a log file (a torn or foreign line is skipped, never fatal). */
export function readLogTail(file: string, n: number): CompanyEvent[] {
  let raw: string;
  try {
    if (!existsSync(file) || statSync(file).size > LOG_MAX_BYTES * 2) return [];
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: CompanyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<CompanyEvent>;
      if (typeof e.at === 'number' && typeof e.type === 'string' && EVENT_TYPES.has(e.type) && typeof e.agent === 'string' && typeof e.text === 'string') out.push(e as CompanyEvent);
    } catch {
      // a torn line (the process died mid-write)
    }
  }
  return out.slice(-n);
}

/**
 * A finished piece of work in the outbox, by its file name only (no folders, no dot files): its text, or undefined
 * if there is no such file. Larger files come back cut, with `truncated`.
 */
export function readOutboxFile(dataDir: string, name: string): CompanyFileText | undefined {
  if (!/^[^\\/:*?"<>|\0]+$/.test(name) || name.startsWith('.') || name.includes('..')) return undefined;
  const file = join(companyDir(dataDir), 'outbox', name);
  try {
    const st = statSync(file);
    if (!st.isFile()) return undefined;
    const max = 512 * 1024;
    const buf = readFileSync(file);
    return { name, text: buf.subarray(0, max).toString('utf8'), bytes: st.size, at: st.mtimeMs, truncated: st.size > max };
  } catch {
    return undefined;
  }
}

/** The company log: one JSON line per event in <company>/log.jsonl; a full log is moved aside as log-<time>.jsonl. */
export class CompanyLog {
  private readonly memory: CompanyEvent[] = [];

  /** With a file: picks up where the last run left off (its latest events), so a restart keeps the history. */
  constructor(private readonly file?: string) {
    if (file) this.memory.push(...readLogTail(file, LOG_KEEP));
  }

  append(e: Omit<CompanyEvent, 'at' | 'text'> & { text: string }): CompanyEvent {
    const event: CompanyEvent = { ...e, at: Date.now(), text: e.text.replace(/\s+/g, ' ').trim().slice(0, LOG_TEXT) };
    this.memory.push(event);
    if (this.memory.length > LOG_KEEP) this.memory.splice(0, this.memory.length - LOG_KEEP);
    if (this.file) {
      try {
        if (existsSync(this.file) && statSync(this.file).size > LOG_MAX_BYTES) renameSync(this.file, this.file.replace(/\.jsonl$/, `-${event.at}.jsonl`));
        appendFileSync(this.file, `${JSON.stringify(event)}\n`);
      } catch {
        // the log is a record, never a reason to fail a turn
      }
    }
    return event;
  }

  /** The latest events this run (newest last). */
  recent(n = 100): CompanyEvent[] {
    return this.memory.slice(-n);
  }
}
