import { useEffect, useMemo, useRef, useState } from 'react';
import { Hand, Bot, Search, Mic, Image as Img, FileText, SendHorizontal, ArrowLeft, Receipt } from 'lucide-react';
import type { Ctx } from '../App';
import type { Conversa, Mensagem } from '../lib/types';
import { etapaInfo } from '../lib/types';
import { hora, relativo, nomeLead, dataHora } from '../lib/format';
import LeadPanel from '../components/LeadPanel';
import GerarCobranca from '../components/GerarCobranca';

export function statusConversa(c: Conversa, pausado: boolean, agora: number) {
  if (pausado) return { cls: 'bad', txt: 'Pausa geral' };
  if (c.assumida_manual) return { cls: 'warn', txt: `Assumida por ${c.assumida_por || 'humano'}` };
  if (c.aguardando_humano) return { cls: 'bad', txt: 'Aguardando humano' };
  if (c.ia_retorna_em && new Date(c.ia_retorna_em).getTime() > agora) {
    const min = Math.max(1, Math.round((new Date(c.ia_retorna_em).getTime() - Date.now()) / 60000));
    return { cls: 'warn', txt: `Humano atendendo · IA volta em ${min} min` };
  }
  if (c.ia_ativa === false) return { cls: 'warn', txt: 'Com a equipe' };
  return { cls: 'ok', txt: 'IA ativa' };
}

const FILTROS = { todas: 'Todas', ia: 'IA ativa', humano: 'Com humano', aguardando: 'Aguardando humano' } as const;

export default function Conversas({ ctx, selecionada, selecionar }: { ctx: Ctx; selecionada: string | null; selecionar: (id: string) => void }) {
  const [filtro, setFiltro] = useState<keyof typeof FILTROS>('todas');
  const [busca, setBusca] = useState('');
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const caixa = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cobrar, setCobrar] = useState(false);
  const [aberta, setAberta] = useState(!!selecionada); // celular: lista ou conversa em tela cheia
  const pausado = !!ctx.snap.config.sdr_pausado_global?.valor?.pausado;
  const lista = useMemo(() => ctx.snap.conversas.filter(c => {
    const s = statusConversa(c, false, ctx.agora);
    if (filtro === 'ia' && s.txt !== 'IA ativa') return false;
    if (filtro === 'humano' && !(c.assumida_manual || s.txt.startsWith('Humano') || s.txt === 'Com a equipe')) return false;
    if (filtro === 'aguardando' && !c.aguardando_humano) return false;
    const q = busca.toLowerCase();
    return !q || (c.nome || '').toLowerCase().includes(q) || (c.nome_whatsapp || '').toLowerCase().includes(q) || c.telefone.includes(q.replace(/\D/g, '') || '§');
  }), [ctx.snap.conversas, filtro, busca, ctx.agora]);
  const conv = ctx.snap.conversas.find(c => c.id === selecionada) || null;
  const lead = conv ? ctx.snap.leads.find(l => l.id === conv.lead_id) : null;

  useEffect(() => { if (!selecionada && lista[0]) selecionar(lista[0].id); }, [lista.length]);
  useEffect(() => {
    if (!selecionada) return;
    let vivo = true;
    ctx.api.mensagens(selecionada).then(m => { if (vivo) setMsgs(m); });
    return () => { vivo = false; };
  }, [selecionada, ctx.snap]);
  useEffect(() => { const c = caixa.current; if (c) c.scrollTop = c.scrollHeight; }, [msgs.length, selecionada]);

  const assumir = async () => { await ctx.api.assumir(conv!.id); ctx.toast('Você assumiu o atendimento. A IA não responde esta conversa até você devolver.'); ctx.recarregar(); };
  const devolver = async () => {
    if (!window.confirm('A IA volta a responder esta conversa AGORA. Se você ainda está atendendo, cancele: ela volta sozinha alguns minutos depois da sua última mensagem.')) return;
    await ctx.api.devolver(conv!.id); ctx.toast('Conversa devolvida para a IA'); ctx.recarregar();
  };
  const enviar = async () => {
    const t = texto.trim(); if (!t || !conv || enviando) return;
    setEnviando(true);
    try {
      const r = await ctx.api.enviarMensagem(conv.id, t);
      if (!r.ok) { ctx.toast('Não enviado: ' + (r.erro || 'erro desconhecido')); return; }
      setTexto('');
      setMsgs(await ctx.api.mensagens(conv.id));
      ctx.recarregar();
    } catch (e: any) { ctx.toast('Não enviado: ' + e.message); } finally { setEnviando(false); }
  };
  useEffect(() => { setTexto(''); }, [selecionada]);
  const st = conv ? statusConversa(conv, pausado, ctx.agora) : null;

  return (
    <div className={'chat' + (aberta ? ' aberta' : '')}>
      <div className="lst">
        <div className="f">
          <div className="row"><Search size={15} className="muted" /><input className="input" style={{ flex: 1 }} placeholder="Buscar nome ou telefone" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>{(Object.keys(FILTROS) as (keyof typeof FILTROS)[]).map(f => <button key={f} className={filtro === f ? 'on' : ''} onClick={() => setFiltro(f)}>{FILTROS[f]}</button>)}</div>
        </div>
        {lista.map(c => {
          const s = statusConversa(c, pausado, ctx.agora); const e = etapaInfo(c.etapa);
          return (
            <div key={c.id} className={'citem' + (c.id === selecionada ? ' on' : '')} onClick={() => { selecionar(c.id); setAberta(true); }}>
              <div className="l1">{nomeLead(c)}{c.nao_lidas > 0 && <span className="chip" style={{ background: 'var(--ok)' }}>{c.nao_lidas}</span>}<span className="t">{relativo(c.ultima_msg_em)}</span></div>
              <div className="l2">{c.ultima_msg_autor === 'lead' ? '' : c.ultima_msg_autor === 'humano' ? '👤 ' : '🤖 '}{c.ultima_msg_texto || '—'}</div>
              <div className="row"><span className={'pill ' + s.cls} style={{ fontSize: 10, padding: '2px 7px' }}>{s.txt}</span><span className="chip" style={{ background: e.cor, fontSize: 10 }}>{e.nome}</span></div>
            </div>
          );
        })}
        {!lista.length && <div className="empty">Nenhuma conversa.</div>}
      </div>
      <div className="thread">
        {conv ? <>
          <div className="thead">
            <button className="btn icone voltar" onClick={() => setAberta(false)} aria-label="Voltar para a lista"><ArrowLeft size={18} /></button>
            <div style={{ minWidth: 0 }}><div className="b">{nomeLead(conv)}</div><div className="small muted">{conv.motivo_handoff && conv.aguardando_humano ? `Transferida pela IA: ${conv.motivo_handoff}` : `Conversa iniciada em ${dataHora(conv.criado_em)}`}</div></div>
            <span className={'pill ' + st!.cls} style={{ marginLeft: 'auto' }}><span className="dot" /> {st!.txt}</span>
            {lead && <button className="btn cobrar" onClick={() => setCobrar(true)} title="Gerar cobrança pelo Asaas"><Receipt size={16} /> <span>Gerar cobrança</span></button>}
            {conv.assumida_manual || conv.aguardando_humano || !conv.ia_ativa
              ? <button className="btn ok" onClick={devolver}><Bot size={16} /> Devolver para a IA</button>
              : <button className="btn gold" onClick={assumir}><Hand size={16} /> Assumir atendimento</button>}
          </div>
          <div className="msgs" ref={caixa}>
            {msgs.map(m => (
              <div key={m.id} className={`msg ${m.direcao} ${m.autor}`}>
                {m.direcao === 'out' && <div className="who">{m.autor === 'ia' ? '🤖 SDR IA' : m.autor === 'humano' ? '👤 Equipe Advance' : 'Sistema'}</div>}
                {m.texto && <div>{m.texto}</div>}
                {m.tipo === 'audio' && <div className="media"><Mic size={12} /> {m.direcao === 'out' ? 'Áudio com voz clonada' : 'Áudio'}{m.midia_descricao ? `: “${m.midia_descricao}”` : m.direcao === 'out' ? '' : ' (transcrevendo…)'}</div>}
                {m.tipo === 'image' && <div className="media"><Img size={12} /> {m.midia_descricao || 'Imagem'}</div>}
                {m.tipo === 'document' && <div className="media"><FileText size={12} /> Documento</div>}
                <div className="meta">{hora(m.criado_em)}{m.status_envio === 'falhou' ? ' · ⚠ falhou' : ''}</div>
              </div>
            ))}
          </div>
          <div className="composer">
            <textarea className="input" rows={2} placeholder="Escreva sua resposta…" value={texto} disabled={enviando}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
            <button className="btn primary" disabled={enviando || !texto.trim()} onClick={enviar} title="Enviar"><SendHorizontal size={16} /> <span>{enviando ? 'Enviando…' : 'Enviar'}</span></button>
          </div>
          <div className="small muted" style={{ padding: '0 16px 10px', background: 'var(--card)' }}>
            {conv.assumida_manual || (ctx.snap.config.ia_retorno_automatico && ctx.snap.config.ia_retorno_automatico.valor !== true) ? 'Ao responder (aqui ou pelo celular), a IA para nesta conversa e só volta quando você clicar em “Devolver para a IA”.' : `Ao responder (aqui ou pelo celular), a IA pausa nesta conversa e volta sozinha ${ctx.snap.config.minutos_retorno_humano?.valor ?? 15} min depois da sua última mensagem. Para ela não voltar, use “Assumir atendimento”.`}
          </div>
        </> : <div className="empty">Selecione uma conversa.</div>}
      </div>
      <div className="side-panel">{lead ? <LeadPanel ctx={ctx} lead={lead} /> : <div className="empty">—</div>}</div>
      {cobrar && lead && <GerarCobranca ctx={ctx} lead={lead} fechar={() => setCobrar(false)} />}
    </div>
  );
}
