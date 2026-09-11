/**
 * GET /api/ping — does a function run here at all?
 *
 * Imports nothing. When something answers `FUNCTION_INVOCATION_FAILED`, this
 * separates "the runtime cannot load my modules" from "the runtime is fine and my
 * code threw": if ping answers and the others do not, the fault is an import.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkMnemonic } from './_lib/config.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    node: process.version,
    region: process.env.VERCEL_REGION ?? null,
    // Which commit is actually serving. Without this, "the fix did not work" and
    // "the fix is not deployed yet" look identical from the outside, and every
    // diagnosis after that is guesswork.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    // Counts and positions only — never a value.
    mnemonic: checkMnemonic(),
    env: {
      MNEMONIC: Boolean(process.env.MNEMONIC),
      BOT_NAMETAG: process.env.BOT_NAMETAG ?? null,
      KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
      KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    },
  });
}
