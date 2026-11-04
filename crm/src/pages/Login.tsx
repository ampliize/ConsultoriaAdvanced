import { useState } from 'react';
import { anonKey, salvarAnonKey, keyVemDoAmbiente, sb, SUPABASE_URL } from '../lib/supabase';

export default function Login({ onDemo, onLogin }: { onDemo: () => void; onLogin: (email: string) => void }) {
  const [temKey, setTemKey] = useState(!!anonKey());
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setCarregando(true);
    try {
      const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) throw error;
      const ok = await sb().rpc('is_crm_user');
      if (ok.error || !ok.data) { await sb().auth.signOut(); throw new Error('Este e-mail não tem acesso ao CRM. Peça para a Ampliize cadastrar você.'); }
      onLogin(data.user.email!);
    } catch (err: any) {
      setErro(err.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : err.message);
    } finally { setCarregando(false); }
  }

  return (
    <div className="login">
      <div className="box">
        <svg width="40" height="40" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b2545" /><path d="M8 23 16 8l8 15h-4.2L16 15.6 12.2 23z" fill="#d4a24c" /></svg>
        <h2>Advance · CRM do SDR IA</h2>
        <p>Atendimentos, qualificação e reuniões do consultor virtual.</p>
        {erro && <div className="err">{erro}</div>}
        {!temKey ? (
          <form onSubmit={e => { e.preventDefault(); if (key.trim().length > 30) { salvarAnonKey(key); setTemKey(true); location.reload(); } else setErro('Cole a anon key (public) do projeto.'); }}>
            <p className="small">Primeiro acesso neste navegador: cole a <b>anon key</b> do Supabase ({SUPABASE_URL.replace('https://', '')} → Settings → API).</p>
            <input className="input" placeholder="eyJhbGciOi..." value={key} onChange={e => setKey(e.target.value)} />
            <button className="btn primary">Salvar chave</button>
          </form>
        ) : (
          <form onSubmit={entrar}>
            <input className="input" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" />
            <input className="input" type="password" placeholder="Senha" value={senha} onChange={e => setSenha(e.target.value)} required autoComplete="current-password" />
            <button className="btn primary" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
            {!keyVemDoAmbiente() && <button type="button" className="btn" style={{ marginTop: 8, border: 0 }} onClick={() => { localStorage.removeItem('adv_supabase_anon_key'); location.reload(); }}><span className="small muted">Trocar chave do Supabase</span></button>}
          </form>
        )}
        <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0 12px' }} />
        <button className="btn gold" onClick={onDemo}>Ver demonstração com dados fictícios</button>
      </div>
    </div>
  );
}
