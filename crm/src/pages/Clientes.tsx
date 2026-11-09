import { useMemo, useState } from 'react';
import { Users, Wallet, HandCoins, AlertTriangle, BadgeCheck, CalendarClock, Plus, ExternalLink, Send, Scale, MessageCircle } from 'lucide-react';
import type { Ctx } from '../App';
import type { Cobranca, Contrato } from '../lib/types';
import { MODALIDADE, STATUS_CONTRATO, STATUS_COBRANCA, PAGA, EM_ABERTO, rotuloCobranca } from '../lib/types';
import { brl, num, pct, dataHora, nomeLead, telefone, SERVICO } from '../lib/format';

const dia = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const mesNome = (ym: string) => { const [a, m] = ym.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + a.slice(2); };
const ABERTO = ['aguardando_pagamento', 'ativo', 'inadimplente'];

function Kpi({ icon: I, lbl, val, hint, cor }: any) {
  return <div className="card kpi"><div className="lbl"><I size={15} color={cor || '#13315c'} /> {lbl}</div><div className="val">{val}</div>{hint && <div className="hint">{hint}</div>}</div>;
}

export default function Clientes({ ctx }: { ctx: Ctx }) {
  const { contratos, cobrancas, comissoes, config } = ctx.snap;
  const [servico, setServico] = useState<'limpa_nome' | 'diagnostico'>('limpa_nome');
  const [filtro, setFiltro] = useState('abertos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const benef: { nome: string; walletId: string; percentual: number }[] = Array.isArray(config.split_beneficiarios?.valor) ? config.split_beneficiarios.valor : [];
  const asaasAtivo = config.asaas_ativo?.valor === true;
  const custo = Number(config.custo_produto?.valor?.valor ?? 0);

  const m = useMemo(() => {
    const cts = contratos.filter(c => c.servico === servico);
    const ids = new Set(cts.map(c => c.id));
    const cobs = cobrancas.filter(c => ids.has(c.contrato_id));
    const vigentes = cts.filter(c => ['ativo', 'inadimplente', 'quitado'].includes(c.status));
    const ativos = cts.filter(c => c.status === 'ativo' || c.status === 'inadimplente');
    const inad = cts.filter(c => c.status === 'inadimplente');
    const recebido = cobs.filter(PAGA).reduce((a, c) => a + (c.valor_pago ?? c.valor), 0);
    const aReceber = ativos.reduce((a, c) => a + c.saldo_devedor, 0);
    const vencido = cts.reduce((a, c) => a + c.vencido, 0);
    const quitacoes = cobs.filter(c => c.tipo === 'quitacao' && PAGA(c));
    const porModalidade = (['avista', '2x', 'tap'] as const).map(k => ({ k, qtd: vigentes.filter(c => c.modalidade === k).length, valor: vigentes.filter(c => c.modalidade === k).reduce((a, c) => a + c.valor_total, 0) }));
    // previsão: cobranças em aberto por mês de vencimento (próximos 6 meses + atrasadas)
    const hoje = new Date().toISOString().slice(0, 7);
    const meses: string[] = []; { const d = new Date(); d.setDate(1); for (let i = 0; i < 6; i++) { meses.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } }
    const ativosIds = new Set(ativos.map(c => c.id));
    const abertas = cobs.filter(c => EM_ABERTO(c) && ativosIds.has(c.contrato_id) && c.vencimento);
    const previsao = meses.map(ym => ({ ym, valor: abertas.filter(c => c.vencimento!.slice(0, 7) === ym && !(ym === hoje && c.status === 'vencida')).reduce((a, c) => a + c.valor, 0) }));
    // comissões por beneficiário
    const comCt = comissoes.filter(c => ids.has(c.contrato_id));
    const futuras = cobs.filter(c => ['planejada', 'a_gerar', 'gerando'].includes(c.status) && ativosIds.has(c.contrato_id));
    const porBenef = benef.map(b => {
      const minhas = comCt.filter(c => c.beneficiario === b.nome);
      const soma = (st: string[]) => minhas.filter(c => st.includes(c.status)).reduce((a, c) => a + c.valor, 0);
      return { nome: b.nome, recebida: soma(['a_liquidar', 'liquidada']), liquidada: soma(['liquidada']), estornada: soma(['estornada']),
        prevista: soma(['prevista']) + futuras.reduce((a, c) => a + Math.round(c.valor * b.percentual) / 100, 0) };
    });
    return { cts, vigentes, ativos, inad, recebido, aReceber, vencido, quitacoes, porModalidade, previsao, porBenef,
      contratada: vigentes.reduce((a, c) => a + c.valor_total, 0), descontos: cts.reduce((a, c) => a + (c.desconto_quitacao || 0), 0) };
  }, [contratos, cobrancas, comissoes, servico, JSON.stringify(benef)]);

  const lista = m.cts.filter(c =>
    (filtro === 'todos' || (filtro === 'abertos' ? ABERTO.includes(c.status) : c.status === filtro)) &&
    (!busca || nomeLead(c).toLowerCase().includes(busca.toLowerCase()) || c.telefone.includes(busca.replace(/\D/g, '') || '§')));
  const proxima = (ct: Contrato) => cobrancas.filter(c => c.contrato_id === ct.id && EM_ABERTO(c) && c.vencimento).sort((a, b) => a.vencimento!.localeCompare(b.vencimento!))[0];
  const etapas: { id: string; nome: string; texto: string }[] = Array.isArray(config.processo_etapas?.valor) ? config.processo_etapas.valor : [];
  const maxPrev = Math.max(1, ...m.previsao.map(p => p.valor));
  const totalPct = benef.reduce((a, b) => a + Number(b.percentual || 0), 0);
  const ct = contratos.find(c => c.id === aberto);

  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg">{([['limpa_nome', 'Limpa Nome'], ['diagnostico', 'Diagnóstico']] as const).map(([k, n]) => <button key={k} className={servico === k ? 'on' : ''} onClick={() => setServico(k)}>{n}</button>)}</div>
        {asaasAtivo ? <span className="pill ok"><span className="dot" /> Cobrança pelo Asaas ligada{String(config.asaas_base_url?.valor || '').includes('sandbox') ? ' · SANDBOX (teste)' : ''}</span>
          : <span className="pill warn">Asaas desligado: a IA usa os links fixos e nada aparece aqui</span>}
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={() => setNovo(true)} disabled={!asaasAtivo} title={asaasAtivo ? '' : 'Ligue o Asaas em Configurações'}><Plus size={14} /> Novo contrato</button>
      </div>

      <div className="grid g4">
        <Kpi icon={Users} lbl="Clientes ativos" val={num(m.ativos.length)} hint={`${num(m.vigentes.length)} contratos fechados · ${num(m.cts.filter(c => c.status === 'quitado').length)} quitados`} />
        <Kpi icon={Wallet} lbl="Receita contratada" val={brl(m.contratada)} hint={`${brl(m.recebido)} já recebidos`} cor="#059669" />
        <Kpi icon={CalendarClock} lbl="A receber" val={brl(m.aReceber)} hint="parcelas em aberto dos contratos ativos" cor="#0ea5e9" />
        <Kpi icon={AlertTriangle} lbl="Inadimplência" val={brl(m.vencido)} hint={`${num(m.inad.length)} clientes · ${pct(m.inad.length, m.ativos.length)} dos ativos`} cor="#ef4444" />
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="card">
          <h3><HandCoins size={16} /> Comissões do split <span className="sub">{totalPct.toLocaleString('pt-BR')}% do recebido após o custo</span></h3>
          {servico === 'diagnostico' && <p className="small muted">O Diagnóstico não tem split.</p>}
          {servico === 'limpa_nome' && m.porBenef.map(b => (
            <div key={b.nome} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span className="b">{b.nome}</span>
              <span style={{ textAlign: 'right' }}>
                <div className="b">{brl(b.recebida)} <span className="small muted">recebida</span></div>
                <div className="small muted">{brl(b.liquidada)} já repassada pelo Asaas · {brl(b.prevista)} prevista{b.estornada ? ` · ${brl(b.estornada)} estornada` : ''}</div>
              </span>
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 8 }}>O custo do produto ({brl(custo)} por contrato) sai do 1º pagamento; a comissão incide sobre o restante. Só conta quando o cliente paga. Prevista = parcelas que ainda vão vencer.</p>
        </div>
        <div className="card">
          <h3>Contratos por modalidade</h3>
          {m.porModalidade.map(x => (
            <div key={x.k} className="funnel-row" style={{ gridTemplateColumns: '120px 1fr 90px' }}>
              <div className="small b">{MODALIDADE[x.k]}</div>
              <div className="funnel-bar"><span style={{ width: Math.max(3, (x.qtd / Math.max(1, m.vigentes.length)) * 100) + '%', background: '#13315c' }}>{num(x.qtd)}</span></div>
              <div className="small muted" style={{ textAlign: 'right' }}>{brl(x.valor)}</div>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 8 }}>
            <BadgeCheck size={13} style={{ verticalAlign: -2 }} /> Quitações antecipadas: <b>{num(m.quitacoes.length)}</b> ({brl(m.quitacoes.reduce((a, c) => a + (c.valor_pago || 0), 0))}){m.descontos ? ` · descontos concedidos ${brl(m.descontos)}` : ''}
          </div>
        </div>
        <div className="card">
          <h3>Previsão de recebimento <span className="sub">próximos meses</span></h3>
          <div className="bars" style={{ height: 120 }}>
            {m.previsao.map(p => (
              <div className="col" key={p.ym} title={brl(p.valor)}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.valor ? Math.round(p.valor).toLocaleString('pt-BR') : ''}</div>
                <i style={{ height: Math.max(2, (p.valor / maxPrev) * 90) + 'px', background: '#d4a24c', width: '70%', display: 'block', borderRadius: 4 }} />
                <div style={{ fontSize: 10 }}>{mesNome(p.ym)}</div>
              </div>
            ))}
          </div>
          {m.vencido > 0 && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>+ {brl(m.vencido)} em atraso</div>}
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <input className="input" placeholder="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        <div className="seg">{[['abertos', 'Em aberto'], ['inadimplente', 'Inadimplentes'], ['quitado', 'Quitados'], ['todos', 'Todos']].map(([k, n]) => <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{n}</button>)}</div>
        <span className="small muted">{lista.length} contratos</span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Cliente</th><th>Modalidade</th><th>Pagos</th><th>Recebido</th><th>Saldo</th><th>Próximo vencimento</th><th>Processo</th><th>Situação</th></tr></thead>
          <tbody>{lista.slice(0, 400).map(c => {
            const p = proxima(c); const st = STATUS_CONTRATO[c.status]; const et = etapas.find(e => e.id === c.processo_etapa);
            return (
              <tr key={c.id} className="click" onClick={() => setAberto(c.id)}>
                <td className="b">{nomeLead(c)}<div className="small muted">{telefone(c.telefone)}</div></td>
                <td>{c.servico === 'diagnostico' ? SERVICO.diagnostico : MODALIDADE[c.modalidade]}</td>
                <td>{c.pagamentos_feitos}/{c.pagamentos_total}</td>
                <td>{brl(c.pago)}</td><td className={c.vencido ? 'b' : ''} style={{ color: c.vencido ? 'var(--bad)' : undefined }}>{brl(c.saldo_devedor)}</td>
                <td>{p ? <>{dia(p.vencimento)} <span className="small muted">{brl(p.valor)}</span></> : '—'}</td>
                <td className="small">{et?.nome || '—'}</td>
                <td><span className={'pill ' + st.cls}>{st.nome}</span></td>
              </tr>);
          })}</tbody>
        </table>
        {!lista.length && <div className="empty">{asaasAtivo ? 'Nenhum contrato aqui ainda. Eles aparecem quando a IA (ou você, em Novo contrato) gera o link de pagamento.' : 'Ligue a cobrança pelo Asaas em Configurações para os contratos aparecerem aqui.'}</div>}
      </div>

      {ct && <Detalhe ctx={ctx} ct={ct} etapas={etapas} fechar={() => setAberto(null)} />}
      {novo && <NovoContrato ctx={ctx} fechar={() => setNovo(false)} />}
    </div>
  );
}

function Detalhe({ ctx, ct, etapas, fechar }: { ctx: Ctx; ct: Contrato; etapas: { id: string; nome: string; texto: string }[]; fechar: () => void }) {
  const cobs = ctx.snap.cobrancas.filter(c => c.contrato_id === ct.id).sort((a, b) => a.numero - b.numero);
  const coms = ctx.snap.comissoes.filter(c => c.contrato_id === ct.id);
  const nots = ctx.snap.notificacoes.filter(n => n.lead_id === ct.lead_id).slice(0, 12);
  const [modo, setModo] = useState<'' | 'andamento' | 'quitar'>('');
  const [etapa, setEtapa] = useState(ct.processo_etapa || etapas[0]?.id || '');
  const [detalhe, setDetalhe] = useState('');
  const [enviar, setEnviar] = useState(true);
  const [desconto, setDesconto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const st = STATUS_CONTRATO[ct.status];
  const benefCfg: { nome: string; percentual: number }[] = ct.servico === 'limpa_nome' && Array.isArray(ctx.snap.config.split_beneficiarios?.valor) ? ctx.snap.config.split_beneficiarios.valor : [];
  const benefs = Array.from(new Set([...coms.map(c => c.beneficiario), ...benefCfg.map(b => b.nome)]));
  const futuras = ['ativo', 'inadimplente'].includes(ct.status) ? cobs.filter(c => ['planejada', 'a_gerar', 'gerando'].includes(c.status)) : [];
  const primeiro = (nome: string) => (ct.nome || ct.nome_whatsapp || '').split(' ')[0] || nome;
  const preview = (etapas.find(e => e.id === etapa)?.texto || '').replace('{nome}', primeiro('')).replace('{detalhe}', detalhe.trim()).replace(/\s{2,}/g, ' ').trim();
  const desc = Number(String(desconto).replace(',', '.')) || 0;
  const final = Math.round((ct.saldo_devedor - desc) * 100) / 100;
  const podeQuitar = ['ativo', 'inadimplente'].includes(ct.status) && ct.saldo_devedor > 0 && !cobs.some(c => c.tipo === 'quitacao' && ['a_gerar', 'gerando', 'pendente', 'vencida'].includes(c.status));

  async function acao(f: () => Promise<any>, ok: string) {
    setOcupado(true); setErro('');
    try { const r = await f(); if (r && r.ok === false) { setErro(r.erro || 'Não foi possível.'); return; } ctx.toast(ok); setModo(''); ctx.recarregar(); }
    catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  return (
    <div className="modal-bg" onClick={fechar}>
      <div className="modal" style={{ maxWidth: 820, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>{nomeLead(ct)}</h3>
            <div className="small muted">{telefone(ct.telefone)}{ct.email ? ' · ' + ct.email : ''} · {ct.servico === 'diagnostico' ? 'Diagnóstico' : 'Limpa Nome · ' + MODALIDADE[ct.modalidade]} · desde {dataHora(ct.aderido_em || ct.criado_em)}</div>
          </div>
          <span className={'pill ' + st.cls} style={{ marginLeft: 'auto' }}>{st.nome}</span>
        </div>

        <div className="grid g4" style={{ marginTop: 12 }}>
          <div><div className="small muted">Total</div><div className="b">{brl(ct.valor_total)}</div></div>
          <div><div className="small muted">Recebido</div><div className="b">{brl(ct.pago)}</div></div>
          <div><div className="small muted">Saldo devedor</div><div className="b">{brl(ct.saldo_devedor)}</div></div>
          <div><div className="small muted">Em atraso</div><div className="b" style={{ color: ct.vencido ? 'var(--bad)' : undefined }}>{brl(ct.vencido)}</div></div>
        </div>
        {ct.custo_produto > 0 && <div className="small muted" style={{ marginTop: 6 }}>Custo do produto: {brl(ct.custo_produto)} · recuperado {brl(ct.custo_recuperado)}{ct.custo_recuperado < ct.custo_produto ? ' (sai do próximo pagamento antes da comissão)' : ''}</div>}

        <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn sm" onClick={() => { const c = ctx.snap.conversas.find(c => c.lead_id === ct.lead_id); if (c) ctx.abrirConversa(c.id); }}><MessageCircle size={14} /> Abrir conversa</button>
          {ct.servico === 'limpa_nome' && <button className={'btn sm' + (modo === 'andamento' ? ' primary' : '')} onClick={() => setModo(modo === 'andamento' ? '' : 'andamento')}><Scale size={14} /> Atualizar andamento do processo</button>}
          {podeQuitar && <button className={'btn sm' + (modo === 'quitar' ? ' primary' : '')} onClick={() => setModo(modo === 'quitar' ? '' : 'quitar')}><BadgeCheck size={14} /> Quitar saldo devedor</button>}
        </div>

        {modo === 'andamento' && (
          <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
            <div className="field"><label>Etapa do processo</label>
              <select className="input" value={etapa} onChange={e => setEtapa(e.target.value)}>{etapas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></div>
            <div className="field" style={{ marginTop: 8 }}><label>Detalhe (opcional): número do processo, observação…</label>
              <input className="input" value={detalhe} onChange={e => setDetalhe(e.target.value)} placeholder="Ex.: Número do processo: 0001234-56.2026.8.25.0001." /></div>
            <label className="small b" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={enviar} onChange={e => setEnviar(e.target.checked)} /> Avisar o cliente no WhatsApp</label>
            {enviar && <div className="msg out" style={{ marginTop: 8, maxWidth: '100%', whiteSpace: 'pre-wrap' }}>{preview}</div>}
            {ct.modalidade === '2x' && (etapa === 'baixa' || etapa === 'concluido') && cobs.some(c => c.status === 'planejada') && <div className="aviso warn">Ao salvar, a 2ª parcela de R$ 400 é gerada no Asaas (vence em 2 dias) e o cliente recebe o link.</div>}
            <div className="row end" style={{ marginTop: 10 }}><button className="btn primary" disabled={ocupado} onClick={() => acao(() => ctx.api.andamento(ct.id, etapa, detalhe, enviar), enviar ? 'Andamento salvo · mensagem vai em até 1 minuto' : 'Andamento salvo')}>Salvar andamento</button></div>
          </div>
        )}

        {modo === 'quitar' && (
          <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
            <div className="list-row"><span>Saldo devedor (parcelas em aberto)</span><b>{brl(ct.saldo_devedor)}</b></div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <div className="field"><label>Desconto (R$)</label><input className="input" style={{ width: 120 }} value={desconto} onChange={e => setDesconto(e.target.value)} placeholder="0,00" /></div>
              {desc > 0 && <div className="field" style={{ flex: 1 }}><label>Quem autorizou / motivo</label><input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: autorizado pelo Caio, cliente quitou à vista" /></div>}
            </div>
            <div className="list-row" style={{ marginTop: 8 }}><span>Valor da quitação</span><b style={{ fontSize: 18 }}>{brl(final)}</b></div>
            <p className="small muted" style={{ marginTop: 6 }}>As parcelas em aberto são canceladas no Asaas e o cliente recebe o link de quitação no WhatsApp em até 2 minutos. O split de 25% vale sobre o valor que o cliente pagar. O contrato só fica quitado quando o Asaas confirmar o pagamento. Desconto só pode ser dado por um administrador.</p>
            <div className="row end" style={{ marginTop: 10 }}><button className="btn primary" disabled={ocupado || final < 5} onClick={() => acao(() => ctx.api.quitar(ct.id, desc, motivo), 'Quitação criada · link vai ao cliente em instantes')}>Gerar quitação de {brl(final)}</button></div>
          </div>
        )}
        {erro && <div className="err" style={{ marginTop: 8 }}>{erro}</div>}

        <h4 style={{ margin: '18px 0 6px' }}>Cobranças</h4>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Pagamento</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th>Pago em</th><th></th></tr></thead>
            <tbody>{cobs.map(c => <LinhaCobranca key={c.id} ctx={ctx} c={c} todas={cobs} modalidade={ct.modalidade} />)}</tbody>
          </table>
        </div>

        {benefs.length > 0 && <>
          <h4 style={{ margin: '18px 0 6px' }}>Comissões deste contrato</h4>
          {benefs.map(b => {
            const mm = coms.filter(c => c.beneficiario === b);
            const s = (st: string[]) => mm.filter(c => st.includes(c.status)).reduce((a, c) => a + c.valor, 0);
            const pctB = Number(benefCfg.find(x => x.nome === b)?.percentual || 0);
            const prevista = s(['prevista']) + futuras.reduce((a, c) => a + Math.round(c.valor * pctB) / 100, 0);
            return <div key={b} className="list-row"><span>{b}</span><span>{brl(s(['a_liquidar', 'liquidada']))} recebida <span className="small muted">· {brl(prevista)} prevista{s(['estornada']) ? ` · ${brl(s(['estornada']))} estornada` : ''}</span></span></div>;
          })}
        </>}

        {ct.servico === 'limpa_nome' && <>
          <h4 style={{ margin: '18px 0 6px' }}>Processo</h4>
          <div className="small">{etapas.find(e => e.id === ct.processo_etapa)?.nome || 'Ainda sem andamento registrado'}{ct.processo_detalhe ? ' · ' + ct.processo_detalhe : ''}{ct.processo_atualizado_em ? <span className="muted"> · {dataHora(ct.processo_atualizado_em)}</span> : null}</div>
        </>}

        <h4 style={{ margin: '18px 0 6px' }}>Mensagens automáticas para o cliente</h4>
        {!nots.length && <div className="small muted">Nenhuma ainda.</div>}
        {nots.map(n => (
          <div key={n.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: 1, paddingRight: 10 }}><span className="pill gray" style={{ marginRight: 6 }}>{{ link_pagamento: 'link', lembrete: 'lembrete', vencida: 'atraso', andamento: 'andamento', quitacao: 'quitação', manual: 'reenvio' }[n.tipo]}</span><span className="small">{n.texto}</span></span>
            <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{n.status === 'enviada' ? dataHora(n.enviada_em) : n.status === 'pendente' ? 'na fila' : 'cancelada'}</span>
          </div>
        ))}

        <div className="row end" style={{ marginTop: 16 }}><button className="btn" onClick={fechar}>Fechar</button></div>
      </div>
    </div>
  );
}

function LinhaCobranca({ ctx, c, todas, modalidade }: { ctx: Ctx; c: Cobranca; todas: Cobranca[]; modalidade: string }) {
  const st = STATUS_COBRANCA[c.status];
  const [enviando, setEnviando] = useState(false);
  const reenviar = async () => {
    setEnviando(true);
    try { const r = await ctx.api.reenviarLink(c.id); ctx.toast(r.ok ? 'Link vai para o cliente em até 1 minuto' : 'Erro: ' + r.erro); ctx.recarregar(); }
    catch (e: any) { ctx.toast('Erro: ' + e.message); } finally { setEnviando(false); }
  };
  return (
    <tr style={{ opacity: c.status === 'cancelada' || c.status === 'a_cancelar' ? 0.55 : 1 }}>
      <td className="b">{rotuloCobranca(c, todas, modalidade)}</td>
      <td>{brl(c.valor)}{c.valor_estornado ? <div className="small" style={{ color: 'var(--bad)' }}>estornado {brl(c.valor_estornado)}</div> : null}</td>
      <td>{c.vencimento ? dia(c.vencimento) : modalidade === '2x' && c.numero > 1 ? <span className="small muted">quando o nome estiver limpo</span> : '—'}</td>
      <td><span className={'pill ' + st.cls}>{st.nome}</span>{c.erro && c.status === 'a_gerar' ? <div className="small" style={{ color: 'var(--bad)' }} title={c.erro}>falha ao gerar, tentando de novo</div> : null}</td>
      <td className="small">{c.pago_em ? <>{dia(c.pago_em)} · {c.forma_paga === 'PIX' ? 'PIX' : c.forma_paga === 'BOLETO' ? 'boleto' : c.forma_paga || ''}</> : '—'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {c.invoice_url && <a className="btn sm" href={c.invoice_url} target="_blank" rel="noreferrer" title="Abrir fatura"><ExternalLink size={13} /></a>}
        {c.invoice_url && (c.status === 'pendente' || c.status === 'vencida') && <button className="btn sm" style={{ marginLeft: 4 }} disabled={enviando} onClick={reenviar} title="Reenviar link no WhatsApp"><Send size={13} /></button>}
      </td>
    </tr>
  );
}

function NovoContrato({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [busca, setBusca] = useState('');
  const [leadId, setLeadId] = useState('');
  const [servico, setServico] = useState('limpa_nome');
  const [modalidade, setModalidade] = useState('avista');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const planos: Record<string, { parcelas: number[] }> = ctx.snap.config.planos_limpa_nome?.valor || {};
  const achados = busca.trim().length < 2 ? [] : ctx.snap.leads.filter(l => nomeLead(l).toLowerCase().includes(busca.toLowerCase()) || l.telefone.includes(busca.replace(/\D/g, '') || '§')).slice(0, 8);
  const lead = ctx.snap.leads.find(l => l.id === leadId);
  const parcelas = servico === 'diagnostico' ? [Number(ctx.snap.config.valor_diagnostico?.valor || 67)] : planos[modalidade]?.parcelas || [];
  const criar = async () => {
    setOcupado(true); setErro('');
    try { const r = await ctx.api.criarContrato(leadId, servico, modalidade); if (!r.ok) { setErro(r.erro || 'Não foi possível criar.'); return; } ctx.toast('Contrato criado · o link vai para o cliente no WhatsApp em até 2 minutos'); ctx.recarregar(); fechar(); }
    catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  };
  return (
    <div className="modal-bg" onClick={fechar}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h3>Novo contrato</h3>
        <p>O cliente recebe o link de pagamento (PIX ou boleto) no WhatsApp em até 2 minutos. As próximas parcelas são geradas mês a mês.</p>
        {!lead ? <>
          <input className="input" style={{ width: '100%' }} autoFocus placeholder="Buscar lead por nome ou telefone" value={busca} onChange={e => setBusca(e.target.value)} />
          {achados.map(l => <div key={l.id} className="list-row click" style={{ cursor: 'pointer' }} onClick={() => setLeadId(l.id)}><span>{nomeLead(l)}<div className="small muted">{telefone(l.telefone)}{l.cpf_cnpj ? '' : ' · sem CPF'}</div></span><span className="small muted">escolher</span></div>)}
        </> : <>
          <div className="list-row"><span className="b">{nomeLead(lead)}<div className="small muted">{telefone(lead.telefone)}</div></span><button className="btn sm" onClick={() => setLeadId('')}>Trocar</button></div>
          {(!lead.nome || !lead.cpf_cnpj) && <div className="err">Este lead ainda não tem nome completo e CPF/CNPJ. Preencha na ficha do lead (página Leads) antes.</div>}
          <div className="row wrap" style={{ marginTop: 10 }}>
            <div className="field"><label>Serviço</label><select className="input" value={servico} onChange={e => setServico(e.target.value)}><option value="limpa_nome">Limpa Nome</option><option value="diagnostico">Diagnóstico</option></select></div>
            {servico === 'limpa_nome' && <div className="field"><label>Modalidade</label><select className="input" value={modalidade} onChange={e => setModalidade(e.target.value)}><option value="avista">À vista</option><option value="2x">2x de R$ 400</option><option value="tap">TAP · entrada + 5x</option></select></div>}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>{parcelas.map((v, i) => `${i === 0 ? 'Agora' : `Mês ${i}`}: ${brl(v)}`).join(' · ')} · Total {brl(parcelas.reduce((a, b) => a + b, 0))}</div>
        </>}
        {erro && <div className="err" style={{ marginTop: 8 }}>{erro}</div>}
        <div className="row end" style={{ marginTop: 14 }}>
          <button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn primary" disabled={!lead || ocupado} onClick={criar}>Criar e enviar link</button>
        </div>
      </div>
    </div>
  );
}
