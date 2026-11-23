// Talking to /api/crew: JSON calls and the live stream.
import type { CrewEvents } from '../../../shared/crew';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `request failed (${res.status})`);
  return data as T;
}

type Handlers = { [K in keyof CrewEvents]: (data: CrewEvents[K]) => void };

/** Opens the SSE stream; reconnects on its own (EventSource). Returns a function that closes it. */
export function connect(handlers: Handlers, onState: (live: boolean) => void): () => void {
  const es = new EventSource('/api/crew/stream');
  for (const name of Object.keys(handlers) as (keyof CrewEvents)[]) {
    es.addEventListener(name, (ev) => {
      try {
        (handlers[name] as (d: unknown) => void)(JSON.parse((ev as MessageEvent<string>).data));
      } catch (err) {
        console.error('crew event', name, err);
      }
    });
  }
  es.onopen = () => onState(true);
  es.onerror = () => onState(false);
  return () => es.close();
}
