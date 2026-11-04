import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zixsjyqmzylcopggfjvr.supabase.co';
const KEY_STORAGE = 'adv_supabase_anon_key';

export function anonKey(): string | null {
  const env = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (env) return env;
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}
export function salvarAnonKey(k: string) { try { localStorage.setItem(KEY_STORAGE, k.trim()); } catch { /* sem storage */ } }
export function esquecerAnonKey() { try { localStorage.removeItem(KEY_STORAGE); } catch { /* sem storage */ } }
export const keyVemDoAmbiente = () => !!import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    const k = anonKey();
    if (!k) throw new Error('Chave do Supabase não configurada');
    client = createClient(SUPABASE_URL, k, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}
