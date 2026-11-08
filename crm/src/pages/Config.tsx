import { useEffect, useState } from 'react';
import { Smartphone, Wallet, HandCoins, BellRing, Scale, CalendarDays, MessageCircleReply, Bot, Users } from 'lucide-react';
import type { Ctx } from '../App';
import type { CrmUsuario } from '../lib/api';
import WhatsappConexao from '../components/WhatsappConexao';
import AgendaEditor from '../components/AgendaEditor';
import FollowupEditor from '../components/FollowupEditor';
import { PagamentosConfig, SplitConfig, AvisosConfig, ProcessoConfig, Caixa, Dica } from '../components/FinanceiroConfig';

type Aba = 'whatsapp' | 'pagamentos' | 'split' | 'avisos' | 'processo' | 'agenda' | 'followup' | 'ia' | 'usuarios';
const ABAS: { id: Aba; nome: string; desc: string; icon: any }[] = [
  { id: 'whatsapp', nome: 'WhatsApp', desc: 'Número conectado ao atendimento da IA.', icon: Smartphone },
  { id: 'pagamentos', nome: 'Pagamentos', desc: 'Cobrança pelo Asaas, custo do produto e webhook.', icon: Wallet },
  { id: 'split', nome: 'Split e comissões', desc: 'Quem recebe a comissão de cada pagamento do Limpa Nome.', icon: HandCoins },
  { id: 'avisos', nome: 'Avisos aos clientes', desc: 'Lembretes de parcela e avisos de atraso no WhatsApp.', icon: BellRing },
  { id: 'processo', nome: 'Andamento do processo', desc: 'Etapas do Limpa Nome e a mensagem de cada uma.', icon: Scale },
  { id: 'agenda', nome: 'Agenda do especialista', desc: 'Horários que a IA pode oferecer para a reunião no Meet.', icon: CalendarDays },
  { id: 'followup', nome: 'Follow-up', desc: 'Lembretes para quem parou de responder.', icon: MessageCircleReply },
  { id: 'ia', nome: 'Atendimento da IA', desc: 'Regras de intervenção humana, alertas e áudio.', icon: Bot },
  { id: 'usuarios', nome: 'Usuários do CRM', desc: 'Quem pode entrar no CRM.', icon: Users },
];

function lerAba(): Aba { try { const a = localStorage.getItem('adv_cfg_aba') as Aba; return ABAS.some(x => x.id === a) ? a : 'whatsapp'; } catch { return 'whatsapp'; } }

export default function Config({ ctx }: { ctx: Ctx }) {
  const [aba, setAba] = useState<Aba>(lerAba());
  const ir = (a: Aba) => { setAba(a); try { localStorage.setItem('adv_cfg_aba', a); } catch { /* sem storage */ } };
  const cfg = ctx.snap.config;
  const asaas = cfg.asaas_ativo?.valor === true;
  const prod = String(cfg.asaas_base_url?.valor || '').includes('api.asaas.com') && !String(cfg.asaas_base_url?.valor || '').includes('sandbox');
  const benef: any[] = Array.isArray(cfg.split_beneficiarios?.valor) ? cfg.split_beneficiarios.valor : [];
  const totalSplit = benef.reduce((a, b) => a + Number(b.percentual || 0), 0);
  const status: Partial<Record<Aba, { txt: string; cls: string }>> = {
    pagamentos: asaas ? { txt: prod ? 'Asaas · produção' : 'Asaas · teste', cls: prod ? 'ok' : 'warn' } : { txt: 'Links fixos', cls: 'gray' },
    split: { txt: `${benef.length} · ${totalSplit.toLocaleString('pt-BR')}%`, cls: benef.some(b => !b.walletId) ? 'warn' : 'info' },
    followup: Array.isArray(cfg.followup_horas?.valor) && cfg.followup_horas.valor.length ? { txt: `${cfg.followup_horas.valor.length} lembretes`, cls: 'info' } : { txt: 'Desligado', cls: 'gray' },
  };
  const atual = ABAS.find(a => a.id === aba)!;

  return (
    <div className="page cfg">
      <nav className="cfg-tabs">
        {ABAS.map(a => (
          <button key={a.id} className={'cfg-tab' + (aba === a.id ? ' on' : '')} onClick={() => ir(a.id)}>
            <a.icon size={16} /><span>{a.nome}</span>
            {status[a.id] && <em className={'pill ' + status[a.id]!.cls}>{status[a.id]!.txt}</em>}
          </button>
        ))}
      </nav>
      <div className="cfg-body">
        <header className="cfg-head"><h2><atual.icon size={20} /> {atual.nome}</h2><p>{atual.desc}</p></header>
        {aba === 'whatsapp' && <WhatsappConexao ctx={ctx} />}
        {aba === 'pagamentos' && <PagamentosConfig ctx={ctx} />}
        {aba === 'split' && <SplitConfig ctx={ctx} />}
        {aba === 'avisos' && <AvisosConfig ctx={ctx} />}
        {aba === 'processo' && <ProcessoConfig ctx={ctx} />}
        {aba === 'agenda' && <div className="sem-titulo"><AgendaEditor ctx={ctx} /></div>}
        {aba === 'followup' && <div className="sem-titulo"><FollowupEditor ctx={ctx} /></div>}
        {aba === 'ia' && <IaConfig ctx={ctx} />}
        {aba === 'usuarios' && <UsuariosConfig ctx={ctx} />}
      </div>
    </div>
  );
}

function IaConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [min, setMin] = useState<number>(Number(cfg.minutos_retorno_humano?.valor ?? 15));
  const [equipe, setEquipe] = useState<string>(Array.isArray(cfg.whatsapp_equipe?.valor) ? cfg.whatsapp_equipe.valor.join('\n') : '');
  const [exigir, setExigir] = useState<boolean>(cfg.exigir_pagamento_para_agendar?.valor !== false);
  const [audio, setAudio] = useState<string>(cfg.audio_modo?.valor || 'espelhar');
  const [voz, setVoz] = useState<string>(cfg.elevenlabs_voice_id?.valor || '');
  const [erro, setErro] = useState('');
  const salvar = async () => {
    if (!(min >= 1)) return setErro('Os minutos precisam ser 1 ou mais.');
    try {
      await ctx.api.salvarConfig('minutos_retorno_humano', Number(min));
      await ctx.api.salvarConfig('whatsapp_equipe', equipe.split('\n').map(s => s.replace(/\D/g, '')).filter(Boolean).map(s => (s.length <= 11 ? '55' + s : s)));
      await ctx.api.salvarConfig('exigir_pagamento_para_agendar', exigir);
      await ctx.api.salvarConfig('audio_modo', audio);
      await ctx.api.salvarConfig('elevenlabs_voice_id', voz.trim());
      setErro(''); ctx.toast('Atendimento salvo'); ctx.recarregar();
    } catch (e: any) { setErro(e.message); }
  };
  return <>
    <Caixa titulo="Quando um humano assume" desc="Se alguém da equipe responder pelo número, a IA para naquela conversa.">
      <div className="cfg-grid">
        <div className="field"><label>A IA volta depois de (minutos) <Dica t="Tempo sem mensagem do humano para a IA retomar a conversa." /></label>
          <input className="input" type="number" min={1} value={min} onChange={e => setMin(Number(e.target.value))} /></div>
        <div className="field"><label>Reunião do Diagnóstico</label>
          <select className="input" value={String(exigir)} onChange={e => setExigir(e.target.value === 'true')}><option value="true">Só agendar depois do pagamento</option><option value="false">Pode agendar antes</option></select></div>
      </div>
    </Caixa>
    <Caixa titulo="Equipe" desc="Recebem os alertas (IA parou, pagamento, reunião, erro). A IA nunca responde estes números como se fossem leads.">
      <div className="field"><label>WhatsApp da equipe (um por linha, com DDD)</label>
        <textarea className="input" rows={3} value={equipe} onChange={e => setEquipe(e.target.value)} placeholder="79 99999-9999" /></div>
    </Caixa>
    <Caixa titulo="Respostas em áudio" desc="Voz clonada no ElevenLabs. Links e valores sempre vão por escrito.">
      <div className="cfg-grid">
        <div className="field"><label>Quando responder em áudio</label>
          <select className="input" value={audio} onChange={e => setAudio(e.target.value)}><option value="espelhar">Quando o lead mandar áudio</option><option value="sempre">Sempre que possível</option><option value="nunca">Nunca (só texto)</option></select></div>
        <div className="field"><label>ID da voz no ElevenLabs</label><input className="input mono" value={voz} onChange={e => setVoz(e.target.value)} placeholder="vazio = só texto" /></div>
      </div>
    </Caixa>
    <div className="cfg-save">{erro && <div className="err">{erro}</div>}<button className="btn primary" onClick={salvar}>Salvar</button></div>
  </>;
}

function UsuariosConfig({ ctx }: { ctx: Ctx }) {
  const [usuarios, setUsuarios] = useState<CrmUsuario[]>([]);
  const [novo, setNovo] = useState({ email: '', nome: '', papel: 'advance' });
  const carregar = () => ctx.api.usuarios().then(setUsuarios).catch(() => {});
  useEffect(() => { carregar(); }, []);
  const PAPEL: Record<string, string> = { advance: 'Advance (admin)', ampliize: 'Ampliize (admin)', closer: 'Closer' };
  return <>
    <Caixa titulo="Quem acessa" desc="O e-mail precisa estar aqui e ter usuário com senha no Supabase (Authentication → Users).">
      <div className="tabela-cfg users">
        <div className="th"><span>Pessoa</span><span>Papel</span><span>Situação</span><span /></div>
        {usuarios.map(u => (
          <div className="tr" key={u.email}>
            <span><b>{u.nome || u.email}</b><div className="small muted">{u.email}</div></span>
            <span className="small">{PAPEL[u.papel] || u.papel}</span>
            <span>{u.ativo ? <span className="pill ok">Ativo</span> : <span className="pill gray">Inativo</span>}</span>
            <button className="btn sm" onClick={async () => { await ctx.api.salvarUsuario({ ...u, ativo: !u.ativo }); carregar(); }}>{u.ativo ? 'Desativar' : 'Ativar'}</button>
          </div>
        ))}
      </div>
    </Caixa>
    <Caixa titulo="Adicionar pessoa" desc="Admins podem autorizar desconto na quitação. Closer não.">
      <div className="cfg-grid">
        <div className="field"><label>E-mail</label><input className="input" placeholder="email@empresa.com" value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} /></div>
        <div className="field"><label>Nome</label><input className="input" value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} /></div>
        <div className="field"><label>Papel</label><select className="input" value={novo.papel} onChange={e => setNovo({ ...novo, papel: e.target.value })}><option value="advance">Advance (admin)</option><option value="closer">Closer</option><option value="ampliize">Ampliize (admin)</option></select></div>
      </div>
      <div className="row end"><button className="btn primary" onClick={async () => { if (!novo.email.trim()) return; await ctx.api.salvarUsuario({ ...novo, ativo: true }); setNovo({ email: '', nome: '', papel: 'advance' }); carregar(); ctx.toast('Pessoa adicionada'); }}>Adicionar</button></div>
    </Caixa>
  </>;
}
