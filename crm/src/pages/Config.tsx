import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import type { CrmUsuario } from '../lib/api';
import WhatsappConexao from '../components/WhatsappConexao';
import AgendaEditor from '../components/AgendaEditor';
import FollowupEditor from '../components/FollowupEditor';

const CAMPOS: { chave: string; nome: string; tipo: 'texto' | 'numero' | 'json' | 'bool' | 'audio' | 'lista'; ajuda?: string }[] = [
  { chave: 'minutos_retorno_humano', nome: 'Minutos para a IA voltar após o humano parar de responder', tipo: 'numero', ajuda: 'Regra de intervenção humana (padrão 15).' },
  { chave: 'whatsapp_equipe', nome: 'WhatsApp do dono / equipe para alertas', tipo: 'lista', ajuda: 'Um número por linha, com DDD. Recebem aviso quando a IA para de responder (não soube responder, erro, lead pediu pessoa), pagamentos informados e reuniões.' },
  { chave: 'link_pagamento_diagnostico', nome: 'Link de pagamento · Diagnóstico (R$ 67)', tipo: 'texto' },
  { chave: 'link_pagamento_limpa_nome_avista', nome: 'Link de pagamento · Limpa Nome à vista (R$ 797)', tipo: 'texto' },
  { chave: 'link_pagamento_limpa_nome_tap', nome: 'Link de pagamento · Limpa Nome TAP (entrada R$ 297 + 5x R$ 150)', tipo: 'texto' },
  { chave: 'exigir_pagamento_para_agendar', nome: 'Diagnóstico: só agendar reunião depois do pagamento', tipo: 'bool' },
  { chave: 'audio_modo', nome: 'Respostas em áudio (voz clonada)', tipo: 'audio' },
  { chave: 'elevenlabs_voice_id', nome: 'ID da voz clonada no ElevenLabs (Claudianny / Matheus)', tipo: 'texto' },
];

function Campo({ ctx, c }: { ctx: Ctx; c: typeof CAMPOS[number] }) {
  const atual = ctx.snap.config[c.chave]?.valor;
  const inicial = c.tipo === 'json' ? JSON.stringify(atual ?? null, null, 1) : c.tipo === 'lista' ? (Array.isArray(atual) ? atual.join('\n') : '') : atual ?? '';
  const [v, setV] = useState<any>(inicial);
  const [erro, setErro] = useState('');
  useEffect(() => setV(inicial), [JSON.stringify(atual)]);
  const salvar = async () => {
    try {
      let valor: any = v;
      if (c.tipo === 'json') valor = JSON.parse(v);
      if (c.tipo === 'numero') valor = Number(v);
      if (c.tipo === 'lista') valor = String(v).split('\n').map(s => s.replace(/\D/g, '')).filter(Boolean).map(s => s.length <= 11 ? '55' + s : s);
      await ctx.api.salvarConfig(c.chave, valor); setErro(''); ctx.toast('Configuração salva'); ctx.recarregar();
    } catch (e: any) { setErro(e.message); }
  };
  return (
    <div className="field" style={{ marginBottom: 16 }}>
      <label>{c.nome}</label>
      {c.tipo === 'bool' ? <select className="input" value={String(v)} onChange={e => setV(e.target.value === 'true')}><option value="true">Sim</option><option value="false">Não</option></select>
        : c.tipo === 'audio' ? <select className="input" value={v} onChange={e => setV(e.target.value)}><option value="espelhar">Quando o lead mandar áudio</option><option value="sempre">Sempre que possível</option><option value="nunca">Nunca (só texto)</option></select>
        : c.tipo === 'json' || c.tipo === 'lista' ? <textarea className="input" rows={c.tipo === 'lista' ? 3 : 4} style={{ fontFamily: 'monospace', fontSize: 12 }} value={v} onChange={e => setV(e.target.value)} />
        : <input className="input" type={c.tipo === 'numero' ? 'number' : 'text'} value={v} onChange={e => setV(e.target.value)} />}
      {c.ajuda && <span className="small muted">{c.ajuda}</span>}
      {erro && <span className="small" style={{ color: 'var(--bad)' }}>{erro}</span>}
      <div><button className="btn sm" onClick={salvar}>Salvar</button></div>
    </div>
  );
}

export default function Config({ ctx }: { ctx: Ctx }) {
  const [usuarios, setUsuarios] = useState<CrmUsuario[]>([]);
  const [novo, setNovo] = useState({ email: '', nome: '', papel: 'advance' });
  const carregar = () => ctx.api.usuarios().then(setUsuarios).catch(() => {});
  useEffect(() => { carregar(); }, []);
  return (
    <div className="page">
      <WhatsappConexao ctx={ctx} />
      <div className="grid g2">
        <div>
          <div className="card">
            <h3>Regras e integrações do SDR</h3>
            {CAMPOS.map(c => <Campo key={c.chave} ctx={ctx} c={c} />)}
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <h3>Quem acessa o CRM</h3>
            <p className="small muted" style={{ marginTop: -6 }}>O e-mail precisa estar aqui <b>e</b> ter usuário criado no Supabase (Authentication → Users).</p>
            {usuarios.map(u => (
              <div className="list-row" key={u.email}><span>{u.nome || u.email}<div className="small muted">{u.email} · {u.papel}</div></span>
                <button className="btn sm" onClick={async () => { await ctx.api.salvarUsuario({ ...u, ativo: !u.ativo }); carregar(); }}>{u.ativo ? 'Desativar' : 'Ativar'}</button></div>
            ))}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <input className="input" placeholder="email" value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} />
              <input className="input" placeholder="nome" value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} style={{ width: 120 }} />
              <select className="input" value={novo.papel} onChange={e => setNovo({ ...novo, papel: e.target.value })}><option value="advance">Advance</option><option value="closer">Closer</option><option value="ampliize">Ampliize</option></select>
              <button className="btn primary sm" onClick={async () => { if (!novo.email) return; await ctx.api.salvarUsuario({ ...novo, ativo: true }); setNovo({ email: '', nome: '', papel: 'advance' }); carregar(); }}>Adicionar</button>
            </div>
          </div>
        </div>
        <div>
          <AgendaEditor ctx={ctx} />
          <FollowupEditor ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
