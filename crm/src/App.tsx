import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, MessagesSquare, KanbanSquare, Users, CalendarDays, Settings, Bell, LogOut, OctagonX, Play, Bot } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Conversas from './pages/Conversas';
import Pipeline from './pages/Pipeline';
import Leads from './pages/Leads';
import Reunioes from './pages/Reunioes';
import Config from './pages/Config';
import type { Api, Snapshot } from './lib/api';
import { apiSupabase } from './lib/api';
import { apiDemo } from './lib/demo';
import { anonKey, sb } from './lib/supabase';
import { dataHora } from './lib/format';

export interface Ctx { api: Api; snap: Snapshot; recarregar: () => void; toast: (t: string) => void; abrirConversa: (id: string) => void; agora: number }

const PAGINAS = [
  { id: 'dashboard', nome: 'Dashboard', icon: BarChart3 },
  { id: 'conversas', nome: 'Conversas', icon: MessagesSquare },
  { id: 'funil', nome: 'Funil', icon: KanbanSquare },
  { id: 'leads', nome: 'Leads', icon: Users },
  { id: 'reunioes', nome: 'Reuniões', icon: CalendarDays },
  { id: 'config', nome: 'Configurações', icon: Settings },
] as const;
type Pagina = typeof PAGINAS[number]['id'];

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [verificando, setVerificando] = useState(true);
  useEffect(() => {
    if (!anonKey()) { setVerificando(false); return; }
    sb().auth.getSession().then(async ({ data }) => {
      const email = data.session?.user?.email;
      if (email) { const ok = await sb().rpc('is_crm_user'); if (ok.data) setApi(apiSupabase(email)); }
      setVerificando(false);
    }).catch(() => setVerificando(false));
  }, []);
  if (verificando) return <div className="login"><div style={{ color: '#fff' }}>Carregando…</div></div>;
  if (!api) return <Login onDemo={() => setApi(apiDemo())} onLogin={e => setApi(apiSupabase(e))} />;
  return <Shell api={api} sair={async () => { await api.sair(); setApi(null); }} />;
}

function Shell({ api, sair }: { api: Api; sair: () => void }) {
  const [pagina, setPagina] = useState<Pagina>('dashboard');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [conversaAberta, setConversaAberta] = useState<string | null>(null);
  const [modalPausa, setModalPausa] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [verAlertas, setVerAlertas] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const timer = useRef<any>(null);

  const recarregar = useCallback(() => {
    api.carregar(null).then(s => { setSnap(s); setErro(''); }).catch(e => setErro(e.message));
  }, [api]);
  useEffect(() => {
    recarregar();
    const off = api.assinar(() => { clearTimeout(timer.current); timer.current = setTimeout(recarregar, 600); });
    const i1 = setInterval(recarregar, 30000); const i2 = setInterval(() => setAgora(Date.now()), 10000);
    return () => { off(); clearInterval(i1); clearInterval(i2); };
  }, [api, recarregar]);
  const toast = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  if (!snap) return <div className="login"><div style={{ color: '#fff' }}>{erro ? <>Erro ao carregar: {erro}<br /><br /><button className="btn" onClick={sair}>Voltar</button></> : 'Carregando dados…'}</div></div>;

  const pausado = !!snap.config.sdr_pausado_global?.valor?.pausado;
  const pausaInfo = snap.config.sdr_pausado_global?.valor || {};
  const aguardando = snap.conversas.filter(c => c.aguardando_humano).length;
  const alertasNovos = snap.alertas.filter(a => !a.lido).length;
  const ctx: Ctx = { api, snap, recarregar, toast, agora, abrirConversa: id => { setConversaAberta(id); setPagina('conversas'); } };

  async function alternarPausa() {
    try { await api.pausaGeral(!pausado, motivo); setModalPausa(false); setMotivo(''); toast(pausado ? 'SDR IA reativado' : 'SDR IA pausado em todas as conversas'); recarregar(); }
    catch (e: any) { toast('Erro: ' + e.message); }
  }

  return (
    <div className={'app' + (pagina === 'conversas' ? ' fixa' : '')}>
      <aside className="side">
        <div className="brand"><Bot size={22} color="#d4a24c" /><div>Advance<small>SDR IA · Ampliize</small></div></div>
        {PAGINAS.map(p => (
          <button key={p.id} className={'nav' + (pagina === p.id ? ' on' : '')} onClick={() => setPagina(p.id)}>
            <p.icon size={17} /> {p.nome}
            {p.id === 'conversas' && aguardando > 0 && <span className="count">{aguardando}</span>}
          </button>
        ))}
        <div className="bottom">{api.demo ? 'Modo demonstração' : api.email()}<br /><button className="nav" style={{ padding: '8px 0' }} onClick={sair}><LogOut size={15} /> Sair</button></div>
      </aside>
      <div className="main">
        {pausado && <div className="banner"><OctagonX size={18} /> SDR IA PAUSADO em todas as conversas{pausaInfo.por ? ` · por ${pausaInfo.por}` : ''}{pausaInfo.em ? ` em ${dataHora(pausaInfo.em)}` : ''}{pausaInfo.motivo ? ` · ${pausaInfo.motivo}` : ''}. Nenhuma mensagem automática está sendo enviada.</div>}
        {api.demo && <div className="banner" style={{ background: '#92400e' }}>Demonstração com dados fictícios — nada aqui é enviado para o WhatsApp.</div>}
        <header className="top">
          <h1>{PAGINAS.find(p => p.id === pagina)!.nome}</h1>
          <div className="grow" />
          {pausado ? <span className="pill bad"><span className="dot" /> SDR pausado</span> : <span className="pill ok"><span className="dot pulse" /> SDR IA ativo</span>}
          <div style={{ position: 'relative' }}>
            <button className="btn" onClick={() => { setVerAlertas(v => !v); if (alertasNovos) api.marcarAlertasLidos().then(recarregar); }} title="Alertas">
              <Bell size={16} />{alertasNovos > 0 && <span className="chip" style={{ background: 'var(--bad)' }}>{alertasNovos}</span>}
            </button>
          </div>
          <button className={'emerg' + (pausado ? ' resume' : '')} onClick={() => setModalPausa(true)}>
            {pausado ? <><Play size={16} /> Reativar SDR</> : <><OctagonX size={16} /> Emergência: pausar tudo</>}
          </button>
        </header>
        {verAlertas && (
          <div className="alerts">
            {snap.alertas.length === 0 && <div className="empty">Sem alertas.</div>}
            {snap.alertas.slice(0, 40).map(a => (
              <div key={a.id} className={'a' + (a.lido ? '' : ' novo')} onClick={() => { if (a.conversa_id) { ctx.abrirConversa(a.conversa_id); setVerAlertas(false); } }} style={{ cursor: a.conversa_id ? 'pointer' : 'default' }}>
                <div className="row"><span className="pill gray">{a.tipo.replace(/_/g, ' ')}</span><span className="small muted" style={{ marginLeft: 'auto' }}>{dataHora(a.criado_em)}</span></div>
                <div style={{ marginTop: 5 }}>{a.mensagem}</div>
              </div>
            ))}
          </div>
        )}
        {erro && <div className="banner" style={{ background: '#7c2d12' }}>Falha ao atualizar: {erro}</div>}
        {pagina === 'dashboard' && <Dashboard ctx={ctx} />}
        {pagina === 'conversas' && <Conversas ctx={ctx} selecionada={conversaAberta} selecionar={setConversaAberta} />}
        {pagina === 'funil' && <Pipeline ctx={ctx} />}
        {pagina === 'leads' && <Leads ctx={ctx} />}
        {pagina === 'reunioes' && <Reunioes ctx={ctx} />}
        {pagina === 'config' && <Config ctx={ctx} />}
      </div>
      {modalPausa && (
        <div className="modal-bg" onClick={() => setModalPausa(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{pausado ? 'Reativar o SDR IA?' : 'Pausar todo o SDR IA?'}</h3>
            <p>{pausado ? 'A IA volta a responder os leads em todas as conversas (exceto as assumidas por humanos). Mensagens que chegaram durante a pausa serão respondidas em até 1 minuto.' : 'A IA para de responder IMEDIATAMENTE em todas as conversas, inclusive follow-ups. Use em caso de bug ou comportamento estranho. A equipe é avisada no WhatsApp.'}</p>
            {!pausado && <input className="input" style={{ width: '100%', marginBottom: 12 }} placeholder="Motivo (opcional): ex. IA repetindo mensagens" value={motivo} onChange={e => setMotivo(e.target.value)} />}
            <div className="row end">
              <button className="btn" onClick={() => setModalPausa(false)}>Cancelar</button>
              <button className={'btn ' + (pausado ? 'ok' : 'danger')} onClick={alternarPausa}>{pausado ? 'Reativar agora' : 'Pausar agora'}</button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
