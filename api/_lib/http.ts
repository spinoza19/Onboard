/** Request plumbing shared by the four endpoints. */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

/**
 * Same-origin by design: the functions are served from the same Vercel deployment
 * as the page, so there is no CORS to configure and no third-party origin to trust.
 * We only pin the method and turn thrown errors into honest JSON.
 */
export function route(method: 'GET' | 'POST', handler: Handler): Handler {
  return async (req, res) => {
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: `Use ${method}` });
    }
    try {
      return await handler(req, res);
    } catch (e) {
      const status = (e as { status?: number })?.status ?? 500;
      const message = e instanceof Error ? e.message : 'Unexpected issuer error';
      // Logged in full for us, summarised for the caller.
      console.error(`[${method} ${req.url}]`, e);
      return res.status(status).json({ error: message });
    }
  };
}

/** Read a JSON body whether or not the platform already parsed it. */
export function body<T = Record<string, unknown>>(req: VercelRequest): T {
  if (req.body && typeof req.body === 'object') return req.body as T;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      throw Object.assign(new Error('Body is not valid JSON'), { status: 400 });
    }
  }
  return {} as T;
}

export function bad(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}
