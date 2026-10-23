// Vercel Function serving the whole API (/api/v1/*, see the rewrite in vercel.json).

import { clientIp, getApp, misconfigured, originalRequest } from '../server/runtime.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    const app = getApp();
    if (!app) return misconfigured();
    return app.handle(originalRequest(request), clientIp(request));
  },
};
