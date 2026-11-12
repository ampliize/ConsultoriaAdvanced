import { useEffect, useMemo, useState } from 'react';
import { Copy, Send, X } from 'lucide-react';
import type { Ctx } from '../App';
import type { Lead } from '../lib/types';
import { brl } from '../lib/format';

// Gerar cobrança pelo CRM: produto da tabela ou cobrança personalizada. O link sai pela API do Asaas
// (com o split das Configurações), aparece aqui para copiar e pode ir sozinho para o WhatsApp do cliente.

const PRODUTOS = [
  { id: 'limpa_nome', nome: 'Limpa Nome', planos: 'planos_limpa_nome', modalidades: ['avista', '2x', 'tap'] },
  { id: 'combo', nome: 'Limpa Nome + Rating', planos: 'planos_combo', modalidades: ['avista', '2x', 'tap'] },
  { id: 'rating', nome: 'Rating (nome já limpo)', planos: 'planos_rating', modalidades: ['avista', '2x'] },
  { id: 'diagnostico', nome: 'Diagnóstico de crédito', planos: '', modalidades: ['avista'] },
] as const;
const NOME_MOD: Record<string, string> = { avista: 'À vista', '2x': '2x', tap: 'TAP · entrada + 5x' };
const hojeISO = (dias = 0) => new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Maceio' });
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const fmtDoc = (s: string) => { const d = s.replace(/\D/g, ''); if (d.length <= 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4'); return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})$/, '$1.$2.$3/$4-$5'); };

export default function GerarCobranca({ ctx, lead, fechar }: { ctx: Ctx; lead: Lead; fechar: () => void }) {
  const cfg = ctx.snap.config;
  const [aba, setAba] = useState<'produto' | 'personalizada'>('produto');
  const [cli, setCli] = useState({ nome: lead.nome || '', cpf_cnpj: lead.cpf_cnpj ? fmtDoc(lead.cpf_cnpj) : '', email: lead.email || '', endereco: (lead as any).endereco || '' });
  const [servico, setServico] = useState<string>(['limpa_nome', 'combo', 'rating', 'diagnostico'].includes(lead.servico) ? lead.servico : 'limpa_nome');
  const [modalidade, setModalidade] = useState('avista');
  const [venc, setVenc] = useState(hojeISO(2));
  const [p, setP] = useState({ descricao: '', valor: '', parcelas: '0', valor_parcela: '', aguardar_entrega: false, com_split: true, custo: '' });
  const [enviar, setEnviar] = useState(true);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [gerada, setGerada] = useState<{ cobranca_id: string; enviar_link: boolean } | null>(null);

  const prod = PRODUTOS.find(x => x.id === servico)!;
  useEffect(() => { if (!(prod.modalidades as readonly string[]).includes(modalidade)) setModalidade('avista'); }, [servico]);
  const parcelasProd: number[] = servico === 'diagnostico' ? [Number(cfg.valor_diagnostico?.valor || 67)] : cfg[prod.planos]?.valor?.[modalidade]?.parcelas || [];
  const nParc = Math.max(0, Math.min(12, parseInt(p.parcelas, 10) || 0));
  const totalPers = num(p.valor) + nParc * num(p.valor_parcela);
  const asaasLigado = cfg.asaas_ativo?.valor === true;
  const contratoAberto = ctx.snap.contratos.find(c => c.lead_id === lead.id && c.servico === servico && ['aguardando_pagamento', 'ativo', 'inadimplente'].includes(c.status));

  // depois de gerar: acompanha o link que o Asaas devolve (chega pelo realtime)
  const cob = useMemo(() => gerada ? ctx.snap.cobrancas.find(c => c.id === gerada.cobranca_id) : null, [gerada, ctx.snap.cobrancas]);
  useEffect(() => { if (gerada && !cob?.invoice_url) { const t = setInterval(() => ctx.recarregar(), 4000); return () => clearInterval(t); } }, [gerada, cob?.invoice_url]);

  const gerar = async () => {
    setErro('');
    if (!cli.nome.trim() || cli.nome.trim().split(/\s+/).length < 2) return setErro('Informe o nome completo do cliente.');
    const doc = cli.cpf_cnpj.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) return setErro('CPF precisa ter 11 números e CNPJ 14.');
    if (aba === 'personalizada') {
      if (p.descricao.trim().length < 3) return setErro('Descreva o que está sendo cobrado.');
      if (num(p.valor) < 5) return setErro('O valor mínimo é R$ 5,00.');
      if (nParc > 0 && num(p.valor_parcela) < 5) return setErro('Informe o valor de cada parcela.');
    }
    const dados: Record<string, any> = { ...cli, cpf_cnpj: doc, tipo: aba, vencimento: venc, enviar_link: enviar };
    if (aba === 'produto') Object.assign(dados, { servico, modalidade: servico === 'diagnostico' ? 'avista' : modalidade });
    else Object.assign(dados, { descricao: p.descricao.trim(), valor: num(p.valor), parcelas: nParc, valor_parcela: num(p.valor_parcela), aguardar_entrega: p.aguardar_entrega, com_split: p.com_split, custo: num(p.custo) });
    setOcupado(true);
    try {
      const r = await ctx.api.gerarCobranca(lead.id, dados);
      if (!r.ok) { setErro(r.erro || 'Não foi possível gerar a cobrança.'); return; }
      setGerada({ cobranca_id: r.cobranca_id, enviar_link: !!r.enviar_link || enviar });
      ctx.recarregar();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  };

  const enviarAgora = async () => {
    if (!cob) return;
    const r = await ctx.api.enviarLinkCobranca(cob.id);
    ctx.toast(r.ok ? 'Link enviado para o cliente no WhatsApp' : 'Não enviado: ' + (r.erro || 'erro'));
  };

  if (gerada) return (
    <div className="modal-bg" onClick={fechar}><div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
      <h3>Cobrança gerada</h3>
      {!cob?.invoice_url ? <p>Gerando o link no Asaas… leva alguns segundos.{cob?.erro ? ` Atenção: ${cob.erro}` : ''}</p> : <>
        <p>{brl(cob.valor)} · vence {cob.vencimento ? new Date(cob.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}. {gerada.enviar_link ? 'O link vai para o cliente no WhatsApp em até 1 minuto.' : 'O link não foi enviado ao cliente.'}</p>
        <div className="row"><code className="codebox" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cob.invoice_url}</code>
          <button className="btn sm" title="Copiar" onClick={() => { navigator.clipboard?.writeText(cob.invoice_url!); ctx.toast('Link copiado'); }}><Copy size={14} /></button></div>
        {!gerada.enviar_link && <button className="btn sm" style={{ marginTop: 10 }} onClick={enviarAgora}><Send size={14} /> Enviar na conversa</button>}
      </>}
      <div className="row end" style={{ marginTop: 14 }}><button className="btn primary" onClick={fechar}>Fechar</button></div>
    </div></div>
  );

  return (
    <div className="modal-bg" onClick={fechar}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="row"><h3 style={{ flex: 1 }}>Gerar cobrança</h3><button className="btn icone" onClick={fechar} aria-label="Fechar"><X size={16} /></button></div>
        {!asaasLigado && <div className="aviso warn">A cobrança pelo Asaas está desligada em Configurações · Pagamentos.</div>}

        <div className="cfg-sub">Dados do cliente</div>
        <div className="cfg-grid">
          <div className="field"><label>Nome completo</label><input className="input" value={cli.nome} onChange={e => setCli({ ...cli, nome: e.target.value })} /></div>
          <div className="field"><label>CPF ou CNPJ</label><input className="input mono" inputMode="numeric" value={cli.cpf_cnpj} onChange={e => setCli({ ...cli, cpf_cnpj: e.target.value })} onBlur={() => setCli({ ...cli, cpf_cnpj: fmtDoc(cli.cpf_cnpj) })} /></div>
          <div className="field"><label>E-mail (opcional)</label><input className="input" type="email" value={cli.email} onChange={e => setCli({ ...cli, email: e.target.value })} /></div>
          <div className="field"><label>Endereço (opcional)</label><input className="input" value={cli.endereco} onChange={e => setCli({ ...cli, endereco: e.target.value })} /></div>
        </div>

        <div className="seg" style={{ margin: '12px 0 8px' }}>
          <button className={aba === 'produto' ? 'on' : ''} onClick={() => setAba('produto')}>Nossos produtos</button>
          <button className={aba === 'personalizada' ? 'on' : ''} onClick={() => setAba('personalizada')}>Cobrança personalizada</button>
        </div>

        {aba === 'produto' ? <>
          <div className="cfg-grid">
            <div className="field"><label>Produto</label><select className="input" value={servico} onChange={e => setServico(e.target.value)}>{PRODUTOS.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></div>
            {servico !== 'diagnostico' && <div className="field"><label>Forma</label><select className="input" value={modalidade} onChange={e => setModalidade(e.target.value)}>{prod.modalidades.map(m => <option key={m} value={m}>{NOME_MOD[m]}</option>)}</select></div>}
          </div>
          <div className="small muted">{parcelasProd.map((v, i) => `${i === 0 ? 'Agora' : i === 1 ? (servico === 'rating' ? 'Na entrega' : 'Com o nome limpo') : `+${i - 1} mês`}: ${brl(v)}`).join(' · ')} · Total <b>{brl(parcelasProd.reduce((a, b) => a + b, 0))}</b></div>
          {contratoAberto && <div className="aviso warn" style={{ marginTop: 8 }}>{contratoAberto.status === 'aguardando_pagamento' ? 'Já existe um link deste produto aguardando pagamento: gerar de novo troca a forma de pagamento (o link anterior é cancelado).' : 'Este cliente já tem este produto ativo. Para cobrar algo a mais, use a cobrança personalizada.'}</div>}
        </> : <>
          <div className="field"><label>O que está sendo cobrado</label><input className="input" maxLength={120} placeholder="Ex.: Limpa Nome CPF + CNPJ + Rating" value={p.descricao} onChange={e => setP({ ...p, descricao: e.target.value })} /></div>
          <div className="cfg-grid">
            <div className="field"><label>Valor agora (R$)</label><input className="input" inputMode="decimal" placeholder="2.000,00" value={p.valor} onChange={e => setP({ ...p, valor: e.target.value })} /></div>
            <div className="field"><label>Parcelas depois</label><select className="input" value={p.parcelas} onChange={e => setP({ ...p, parcelas: e.target.value })}>{Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i === 0 ? 'Nenhuma (pagamento único)' : `${i}x`}</option>)}</select></div>
            {nParc > 0 && <div className="field"><label>Valor de cada parcela (R$)</label><input className="input" inputMode="decimal" value={p.valor_parcela} onChange={e => setP({ ...p, valor_parcela: e.target.value })} /></div>}
            {nParc > 0 && <div className="field"><label>Quando começam</label><select className="input" value={p.aguardar_entrega ? 's' : 'n'} onChange={e => setP({ ...p, aguardar_entrega: e.target.value === 's' })}><option value="n">Mensais, a partir do vencimento</option><option value="s">Só depois da entrega (andamento “Restrições baixadas”)</option></select></div>}
            <div className="field"><label>Custo do produto (R$, opcional)</label><input className="input" inputMode="decimal" placeholder="0,00" value={p.custo} onChange={e => setP({ ...p, custo: e.target.value })} /></div>
            <div className="field"><label>Comissão (split)</label><select className="input" value={p.com_split ? 's' : 'n'} onChange={e => setP({ ...p, com_split: e.target.value === 's' })}><option value="s">Com comissão das Configurações</option><option value="n">Sem comissão</option></select></div>
          </div>
          <div className="small muted">Total <b>{brl(totalPers)}</b>{nParc > 0 ? ` (${brl(num(p.valor))} agora + ${nParc}x de ${brl(num(p.valor_parcela))})` : ''}</div>
        </>}

        <div className="cfg-grid" style={{ marginTop: 10 }}>
          <div className="field"><label>Vencimento do 1º pagamento</label><input className="input" type="date" min={hojeISO()} max={hojeISO(aba === 'produto' ? 45 : 60)} value={venc} onChange={e => setVenc(e.target.value)} /></div>
        </div>
        <label className="switch" style={{ marginTop: 10, whiteSpace: 'normal' }}><input type="checkbox" checked={enviar} onChange={e => setEnviar(e.target.checked)} /><span>Enviar o link no WhatsApp do cliente</span></label>

        {erro && <div className="err" style={{ marginTop: 8 }}>{erro}</div>}
        <div className="row end" style={{ marginTop: 14 }}>
          <button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn primary" disabled={ocupado || !asaasLigado} onClick={gerar}>{ocupado ? 'Gerando…' : 'Gerar cobrança'}</button>
        </div>
      </div>
    </div>
  );
}
