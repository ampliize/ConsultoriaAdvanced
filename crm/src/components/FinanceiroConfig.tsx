import { useState } from 'react';
import { Copy, Plus, Trash2, HelpCircle } from 'lucide-react';
import type { Ctx } from '../App';

const WEBHOOK = 'https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-asaas-eventos-r7t4k2';
const EVENTOS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_RESTORED', 'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_SPLIT_DONE', 'PAYMENT_SPLIT_CANCELLED',
  'PAYMENT_SPLIT_DIVERGENCE_BLOCK', 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED'];
const TEXTOS: { k: string; nome: string }[] = [
  { k: 'lembrete', nome: 'Lembrete antes do vencimento' }, { k: 'lembrete_hoje', nome: 'Lembrete no dia do vencimento' },
  { k: 'vencida', nome: 'Parcela vencida' }, { k: 'link', nome: 'Envio do link de pagamento' }, { k: 'quitacao', nome: 'Link de quitação' },
  { k: 'primeira_hoje', nome: '1º pagamento vence hoje (lead ainda não pagou)' }, { k: 'primeira_vencida', nome: '1º pagamento venceu (lead ainda não pagou)' },
];
const dias = (v: any) => (Array.isArray(v) ? v.join(', ') : '');
const lerDias = (s: string) => Array.from(new Set(s.split(/[,\s;]+/).map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x >= 0 && x <= 60))).sort((a, b) => b - a);

export function Dica({ t }: { t: string }) {
  return <span className="dica" title={t}><HelpCircle size={13} /></span>;
}

export function Caixa({ titulo, desc, children, extra }: { titulo: string; desc?: string; children: any; extra?: any }) {
  return (
    <section className="cfg-box">
      <div className="cfg-box-h"><div><h4>{titulo}</h4>{desc && <p>{desc}</p>}</div>{extra}</div>
      {children}
    </section>
  );
}

function useSalvar(ctx: Ctx, msg: string) {
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const salvar = async (validar: () => string | null, pares: [string, any][]) => {
    const e = validar(); if (e) { setErro(e); return; }
    setOcupado(true); setErro('');
    try { for (const [k, v] of pares) await ctx.api.salvarConfig(k, v); ctx.toast(msg); ctx.recarregar(); }
    catch (x: any) { setErro(x.message); } finally { setOcupado(false); }
  };
  return { erro, ocupado, salvar };
}

function Rodape({ erro, ocupado, onClick, rotulo = 'Salvar' }: { erro: string; ocupado: boolean; onClick: () => void; rotulo?: string }) {
  return <div className="cfg-save">{erro && <div className="err">{erro}</div>}<button className="btn primary" disabled={ocupado} onClick={onClick}>{ocupado ? 'Salvando…' : rotulo}</button></div>;
}

// ---------------------------------------------------------------- Pagamentos (Asaas)
export function PagamentosConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [ativo, setAtivo] = useState<boolean>(cfg.asaas_ativo?.valor === true);
  const [base, setBase] = useState<string>(cfg.asaas_base_url?.valor || 'https://api-sandbox.asaas.com/v3');
  const [forma, setForma] = useState<string>(cfg.asaas_forma_cobranca?.valor || 'BOLETO');
  const [custo, setCusto] = useState<{ walletId: string }>({ walletId: cfg.custo_produto?.valor?.walletId || '' });
  const [links, setLinks] = useState<Record<string, string>>({
    link_pagamento_diagnostico: cfg.link_pagamento_diagnostico?.valor || '', link_pagamento_limpa_nome_avista: cfg.link_pagamento_limpa_nome_avista?.valor || '',
    link_pagamento_limpa_nome_2x: cfg.link_pagamento_limpa_nome_2x?.valor || '', link_pagamento_limpa_nome_tap: cfg.link_pagamento_limpa_nome_tap?.valor || '',
  });
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Pagamentos salvos');
  const producao = base.includes('api.asaas.com') && !base.includes('sandbox');
  const benef: any[] = Array.isArray(cfg.split_beneficiarios?.valor) ? cfg.split_beneficiarios.valor : [];

  return <>
    <Caixa titulo="Cobrança pelo Asaas" desc="Ligado: cada cliente recebe um boleto com PIX só dele e o pagamento é confirmado sozinho."
      extra={<label className="switch"><input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /><span>{ativo ? 'Ligado' : 'Desligado'}</span></label>}>
      <div className="cfg-grid">
        <div className="field"><label>Ambiente</label>
          <select className="input" value={producao ? 'p' : 's'} onChange={e => setBase(e.target.value === 'p' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')}>
            <option value="p">Produção (cobranças reais)</option><option value="s">Sandbox (testes)</option>
          </select></div>
        <div className="field"><label>Forma de cobrança</label>
          <select className="input" value={forma} onChange={e => setForma(e.target.value)}>
            <option value="BOLETO">Boleto com PIX</option><option value="PIX">Só PIX</option><option value="UNDEFINED">Cliente escolhe</option>
          </select></div>
      </div>
      {!producao && ativo && <div className="aviso warn">Ambiente de teste: nenhuma cobrança é real.</div>}
    </Caixa>

    <Caixa titulo="Custo do produto" desc="O valor de custo de cada produto fica na aba Split e comissões. Aqui você diz para onde ele vai.">
      <div className="cfg-grid">
        <div className="field"><label>Carteira do fornecedor <Dica t="Deixe vazio para o custo ficar na conta Asaas que faz a cobrança." /></label>
          <input className="input mono" placeholder="vazio = fica na conta que cobra" value={custo.walletId} onChange={e => setCusto({ ...custo, walletId: e.target.value })} /></div>
      </div>
    </Caixa>

    <Caixa titulo="Webhook do Asaas" desc="Endereço que o Asaas usa para avisar pagamentos. Configure uma vez no painel do Asaas.">
      <div className="row"><code className="codebox">{WEBHOOK}</code>
        <button type="button" className="btn sm" title="Copiar" onClick={() => { navigator.clipboard?.writeText(WEBHOOK); ctx.toast('URL copiada'); }}><Copy size={14} /></button></div>
      <details className="mais"><summary>Eventos para marcar no Asaas ({EVENTOS.length})</summary><div className="tags">{EVENTOS.map(e => <span key={e} className="tag">{e}</span>)}</div></details>
    </Caixa>

    <Caixa titulo="Links fixos de pagamento" desc="Só são usados quando a cobrança pelo Asaas está desligada.">
      <details className="mais" open={!ativo}><summary>{ativo ? 'Ver links (não usados agora)' : 'Links em uso'}</summary>
        <div className="cfg-grid" style={{ marginTop: 10 }}>
          {([['link_pagamento_diagnostico', 'Diagnóstico (R$ 67)'], ['link_pagamento_limpa_nome_avista', 'Limpa Nome à vista (R$ 597)'], ['link_pagamento_limpa_nome_2x', 'Limpa Nome 2x (1ª de R$ 400)'], ['link_pagamento_limpa_nome_tap', 'Limpa Nome TAP (entrada R$ 297)']] as const).map(([k, n]) => (
            <div className="field" key={k}><label>{n}</label><input className="input" value={links[k]} placeholder="https://" onChange={e => setLinks({ ...links, [k]: e.target.value })} /></div>
          ))}
        </div>
      </details>
    </Caixa>

    <Rodape erro={erro} ocupado={ocupado} onClick={() => salvar(
      () => ativo && benef.some(b => !String(b.walletId || '').trim()) ? 'Para ligar o Asaas, preencha a carteira (walletId) de todos na aba Split e comissões.' : null,
      [['asaas_base_url', base], ['asaas_forma_cobranca', forma],
       ['custo_produto', { ...(cfg.custo_produto?.valor || {}), walletId: (custo.walletId || '').trim() }],
       ...Object.entries(links).map(([k, v]) => [k, v.trim()] as [string, any]), ['asaas_ativo', ativo]])} />
  </>;
}

// ---------------------------------------------------------------- Split
const PRODUTOS_SPLIT = [
  { id: 'limpa_nome', nome: 'Limpa Nome', planos: 'planos_limpa_nome' },
  { id: 'combo', nome: 'Limpa Nome + Rating (Combo)', planos: 'planos_combo' },
  { id: 'rating', nome: 'Rating sozinho', planos: 'planos_rating' },
] as const;
const MODS: Record<string, string> = { avista: 'À vista', '2x': '2x', tap: 'TAP' };

export function SplitConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [benef, setBenef] = useState<{ nome: string; walletId: string; percentual: number }[]>(Array.isArray(cfg.split_beneficiarios?.valor) ? cfg.split_beneficiarios.valor : []);
  const custoCfg = cfg.custo_produto?.valor || {};
  const comSplitCfg: string[] = Array.isArray(cfg.split_servicos?.valor) ? cfg.split_servicos.valor : ['limpa_nome'];
  const [prod, setProd] = useState(PRODUTOS_SPLIT.map(p => ({
    id: p.id,
    custo: Number(custoCfg.por_servico?.[p.id] ?? (p.id === 'limpa_nome' ? custoCfg.valor ?? 197 : 0)),
    comCusto: Array.isArray(custoCfg.servicos) ? custoCfg.servicos.includes(p.id) : p.id === 'limpa_nome',
    comissao: comSplitCfg.includes(p.id),
  })));
  const [aberto, setAberto] = useState<string>('limpa_nome');
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Split salvo');
  const total = benef.reduce((a, b) => a + (Number(b.percentual) || 0), 0);
  const upd = (id: string, patch: any) => setProd(prod.map(x => x.id === id ? { ...x, ...patch } : x));

  // simula como o sistema reparte: o custo sai primeiro (até acabar), a comissão é sobre o que sobra
  const simular = (parcelas: number[], custo: number, comissao: boolean) => {
    let resto = custo;
    return parcelas.map(v => { const c = Math.min(resto, v); resto -= c; const com = comissao ? Math.round((v - c) * total) / 100 : 0; return { v, c, com, liq: Math.round((v - c - com) * 100) / 100 }; });
  };

  return <>
    <Caixa titulo="Quem recebe a comissão" desc="Percentual de cada pagamento, depois do custo do produto. Vale para todos os produtos com comissão ligada abaixo."
      extra={<span className="pill info">Total {total.toLocaleString('pt-BR')}%</span>}>
      <div className="tabela-cfg">
        <div className="th"><span>Nome</span><span>Carteira Asaas (walletId)</span><span>%</span><span /></div>
        {benef.map((b, i) => (
          <div className="tr" key={i}>
            <input className="input" placeholder="Nome" value={b.nome} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} />
            <input className="input mono" placeholder="ex.: 48548710-9baa-4ec1-a11f-9010193527c6" value={b.walletId} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, walletId: e.target.value } : x))} />
            <input className="input" type="number" step="0.5" min={0} value={b.percentual} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, percentual: Number(e.target.value) } : x))} />
            <button type="button" className="btn sm" title="Remover" onClick={() => setBenef(benef.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => setBenef([...benef, { nome: '', walletId: '', percentual: 12.5 }])}><Plus size={14} /> Adicionar</button>
    </Caixa>

    <Caixa titulo="Produtos" desc="Custo de cada contrato (sai do 1º pagamento antes da comissão) e se o produto paga comissão. O Diagnóstico não tem custo nem comissão.">
      <div className="prod-tabela">
        <div className="th"><span>Produto</span><span>Custo por contrato (R$)</span><span>Liga / desliga</span></div>
        {PRODUTOS_SPLIT.map(p => { const x = prod.find(y => y.id === p.id)!; return (
          <div className="tr" key={p.id}>
            <b>{p.nome}</b>
            <input className="input" type="number" min={0} step="0.01" value={x.comCusto ? x.custo : 0} disabled={!x.comCusto}
              onChange={e => upd(p.id, { custo: Number(e.target.value) })} />
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <label className="switch"><input type="checkbox" checked={x.comCusto} onChange={e => upd(p.id, { comCusto: e.target.checked })} /><span>Custo</span></label>
              <label className="switch"><input type="checkbox" checked={x.comissao} onChange={e => upd(p.id, { comissao: e.target.checked })} /><span>Comissão</span></label>
            </div>
          </div>); })}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Mudanças valem para contratos novos. Contratos que já existem mantêm o custo e a comissão com que foram criados. Na cobrança personalizada você escolhe custo e comissão na hora.</p>
    </Caixa>

    <Caixa titulo="Como fica na prática" desc={`Com ${total.toLocaleString('pt-BR')}% de comissão. Escolha o produto:`}
      extra={<div className="seg">{PRODUTOS_SPLIT.map(p => <button key={p.id} className={aberto === p.id ? 'on' : ''} onClick={() => setAberto(p.id)}>{p.nome.split(' (')[0]}</button>)}</div>}>
      {(() => {
        const p = PRODUTOS_SPLIT.find(y => y.id === aberto)!; const x = prod.find(y => y.id === aberto)!;
        const planos: Record<string, { parcelas: number[] }> = cfg[p.planos]?.valor || {};
        return <div className="exemplos">{Object.entries(planos).map(([m, pl]) => {
          const linhas = simular(pl.parcelas || [], x.comCusto ? x.custo : 0, x.comissao);
          const soma = (k: 'v' | 'c' | 'com' | 'liq') => linhas.reduce((a, l) => a + l[k], 0);
          return <div key={m}><b>{MODS[m] || m} · {brl(soma('v'))}</b>
            {linhas.slice(0, 3).map((l, i) => <span key={i}>{i === 0 ? '1º' : `${i + 1}º`} {brl(l.v)} → custo {brl(l.c)} · comissão {brl(l.com)}</span>)}
            {linhas.length > 3 && <span>… mais {linhas.length - 3} de {brl(linhas[3].v)}</span>}
            <span>Comissão total {brl(soma('com'))} · fica com a Advance {brl(soma('liq'))}</span></div>;
        })}</div>;
      })()}
    </Caixa>

    <Rodape erro={erro} ocupado={ocupado} onClick={() => salvar(() => {
      if (benef.some(b => !b.nome.trim() || !(Number(b.percentual) > 0))) return 'Cada pessoa precisa de nome e percentual.';
      if (total > 50) return 'A soma passou de 50%. Confira os percentuais.';
      if (prod.some(x => x.comCusto && !(x.custo >= 0))) return 'Custo inválido.';
      if (cfg.asaas_ativo?.valor === true && benef.some(b => !b.walletId.trim())) return 'Com o Asaas ligado, todos precisam ter a carteira (walletId).';
      return null;
    }, [
      ['split_beneficiarios', benef.map(b => ({ nome: b.nome.trim(), walletId: b.walletId.trim(), percentual: Number(b.percentual) }))],
      ['split_servicos', prod.filter(x => x.comissao).map(x => x.id)],
      ['custo_produto', { ...custoCfg, valor: prod.find(x => x.id === 'limpa_nome')!.custo,
        servicos: prod.filter(x => x.comCusto).map(x => x.id),
        por_servico: Object.fromEntries(prod.map(x => [x.id, Math.round(x.custo * 100) / 100])) }],
    ])} />
  </>;
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------- Avisos aos clientes
export function AvisosConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [lemb, setLemb] = useState(dias(cfg.notif_lembrete_dias?.valor ?? [3, 0]));
  const [venc, setVenc] = useState(dias(cfg.notif_vencida_dias?.valor ?? [1, 5]));
  const [jan, setJan] = useState<{ inicio: string; fim: string }>(cfg.notif_janela?.valor || { inicio: '08:00', fim: '20:00' });
  const [textos, setTextos] = useState<Record<string, string>>(cfg.notif_textos?.valor || {});
  const [primeira, setPrimeira] = useState<boolean>(cfg.notif_primeira_cobranca?.valor === true);
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Avisos salvos');

  return <>
    <Caixa titulo="Quando enviar" desc="Lembretes e avisos de atraso das parcelas do Limpa Nome, pelo WhatsApp.">
      <div className="cfg-grid">
        <div className="field"><label>Lembrete: dias antes <Dica t="0 = no dia do vencimento. Separe por vírgula." /></label><input className="input" value={lemb} onChange={e => setLemb(e.target.value)} placeholder="3, 0" /></div>
        <div className="field"><label>Atraso: dias depois <Dica t="Separe por vírgula. Ex.: 1, 5" /></label><input className="input" value={venc} onChange={e => setVenc(e.target.value)} placeholder="1, 5" /></div>
        <div className="field"><label>Horário permitido</label><div className="row"><input className="input" type="time" value={jan.inicio} onChange={e => setJan({ ...jan, inicio: e.target.value })} /><span className="small">até</span><input className="input" type="time" value={jan.fim} onChange={e => setJan({ ...jan, fim: e.target.value })} /></div></div>
      </div>
    </Caixa>

    <Caixa titulo="Lead que recebeu o link e não pagou" desc="Avisa no dia do vencimento e nos dias de atraso acima, até o lead pagar. Desligado, só os clientes que já pagaram o 1º recebem avisos."
      extra={<label className="switch"><input type="checkbox" checked={primeira} onChange={e => setPrimeira(e.target.checked)} /><span>{primeira ? 'Ligado' : 'Desligado'}</span></label>}>
      <span />
    </Caixa>

    <Caixa titulo="Textos das mensagens" desc="Palavras entre chaves são trocadas automaticamente."
      extra={<div className="tags">{['{nome}', '{parcela}', '{valor}', '{vencimento}', '{link}'].map(t => <span key={t} className="tag">{t}</span>)}</div>}>
      {TEXTOS.map(t => (
        <div className="field" key={t.k}><label>{t.nome}</label>
          <textarea className="input" rows={2} value={textos[t.k] || ''} onChange={e => setTextos({ ...textos, [t.k]: e.target.value })} /></div>
      ))}
    </Caixa>

    <Rodape erro={erro} ocupado={ocupado} onClick={() => salvar(
      () => jan.inicio >= jan.fim ? 'O horário final precisa ser depois do inicial.' : null,
      [['notif_lembrete_dias', lerDias(lemb)], ['notif_vencida_dias', lerDias(venc)], ['notif_janela', jan], ['notif_textos', textos], ['notif_primeira_cobranca', primeira]])} />
  </>;
}

// ---------------------------------------------------------------- Andamento do processo
export function ProcessoConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [etapas, setEtapas] = useState<{ id: string; nome: string; texto: string }[]>(Array.isArray(cfg.processo_etapas?.valor) ? cfg.processo_etapas.valor : []);
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Etapas salvas');

  return <>
    <Caixa titulo="Etapas e mensagens" desc="Na ficha do cliente (Clientes · Financeiro) você escolhe a etapa e ele recebe a mensagem."
      extra={<div className="tags">{['{nome}', '{detalhe}'].map(t => <span key={t} className="tag">{t}</span>)}</div>}>
      {etapas.map((e, i) => (
        <div key={i} className="etapa">
          <span className="num">{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input className="input b" style={{ width: '100%' }} value={e.nome} onChange={ev => setEtapas(etapas.map((x, j) => j === i ? { ...x, nome: ev.target.value } : x))} />
            <textarea className="input" rows={2} style={{ width: '100%', marginTop: 6 }} value={e.texto} onChange={ev => setEtapas(etapas.map((x, j) => j === i ? { ...x, texto: ev.target.value } : x))} />
          </div>
          <button type="button" className="btn sm" title="Remover etapa" onClick={() => setEtapas(etapas.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setEtapas([...etapas, { id: 'etapa_' + Date.now(), nome: 'Nova etapa', texto: '{nome}, ' }])}><Plus size={14} /> Adicionar etapa</button>
    </Caixa>
    <Rodape erro={erro} ocupado={ocupado} onClick={() => salvar(
      () => etapas.some(e => !e.nome.trim() || !e.texto.trim()) ? 'Cada etapa precisa de nome e mensagem.' : null,
      [['processo_etapas', etapas.map((e, i) => ({ ...e, id: e.id || 'etapa_' + (i + 1) }))]])} />
  </>;
}
