import { describe, expect, it } from 'vitest';
import { connectionUrl } from '../server/db.ts';

describe('connectionUrl', () => {
  it('drops channel_binding (added by Neon) and keeps the other options', () => {
    const url = 'postgresql://arbitraje_app:secret@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
    const cleaned = new URL(connectionUrl(url));
    expect(cleaned.searchParams.has('channel_binding')).toBe(false);
    expect(cleaned.searchParams.get('sslmode')).toBe('require');
    expect(cleaned.username).toBe('arbitraje_app');
    expect(cleaned.password).toBe('secret');
    expect(cleaned.hostname).toBe('ep-x-pooler.us-east-1.aws.neon.tech');
  });

  it('leaves other URLs untouched', () => {
    const url = 'postgresql://arbitraje_app.abc:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    expect(connectionUrl(url)).toBe(url);
  });
});
