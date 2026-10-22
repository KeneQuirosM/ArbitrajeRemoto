// Netlify Function (v2 API) serving /api/v1/*.

import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createApp } from '../../server/app.ts';
import { BlobsStore } from '../../server/store.ts';

const STORE_NAME = 'arbitrajeremoto';

let app: ReturnType<typeof createApp> | null = null;

function getApp() {
  // Created lazily: the Blobs context is only available once the function runs.
  app ??= createApp({
    store: new BlobsStore(getStore({ name: STORE_NAME, consistency: 'strong' })),
    env: process.env,
    now: Date.now,
    uuid: randomUUID,
    secureCookies: true,
  });
  return app;
}

export default async (req: Request, context: Context) => getApp().handle(req, context.ip);

export const config: Config = {
  path: '/api/v1/*',
};
