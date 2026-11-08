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
  const [custo, setCusto] = useState<{ valor: number; walletId: string; servicos: string[] }>(cfg.custo_produto?.valor || { valor: 197, walletId: '', servicos: ['limpa_nome'] });
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

    <Caixa titulo="Custo do produto" desc="Sai inteiro do 1º pagamento de cada contrato do Limpa Nome, antes da comissão.">
      <div className="cfg-grid">
        <div className="field"><label>Valor por contrato (R$)</label><input className="input" type="number" min={0} step="0.01" value={custo.valor} onChange={e => setCusto({ ...custo, valor: Number(e.target.value) })} /></div>
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
       ['custo_produto', { ...custo, valor: Number(custo.valor) || 0, walletId: (custo.walletId || '').trim() }],
       ...Object.entries(links).map(([k, v]) => [k, v.trim()] as [string, any]), ['asaas_ativo', ativo]])} />
  </>;
}

// ---------------------------------------------------------------- Split
export function SplitConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [benef, setBenef] = useState<{ nome: string; walletId: string; percentual: number }[]>(Array.isArray(cfg.split_beneficiarios?.valor) ? cfg.split_beneficiarios.valor : []);
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Split salvo');
  const total = benef.reduce((a, b) => a + (Number(b.percentual) || 0), 0);
  const custo = Number(cfg.custo_produto?.valor?.valor ?? 0);
  const exemplo = (v: number) => Math.round((v - Math.min(v, custo)) * total) / 100;

  return <>
    <Caixa titulo="Quem recebe a comissão" desc="Percentual de cada pagamento do Limpa Nome, depois do custo do produto."
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

    <Caixa titulo="Como fica na prática" desc={`Com custo de R$ ${custo.toLocaleString('pt-BR')} e ${total.toLocaleString('pt-BR')}% de comissão:`}>
      <div className="exemplos">
        <div><b>TAP</b><span>entrada R$ 297 → {brl(exemplo(297))}</span><span>cada parcela R$ 150 → {brl(Math.round(150 * total) / 100)}</span></div>
        <div><b>À vista</b><span>R$ 597 → {brl(exemplo(597))}</span></div>
        <div><b>2x</b><span>1ª R$ 400 → {brl(exemplo(400))}</span><span>2ª R$ 400 → {brl(Math.round(400 * total) / 100)}</span></div>
      </div>
    </Caixa>

    <Rodape erro={erro} ocupado={ocupado} onClick={() => salvar(() => {
      if (benef.some(b => !b.nome.trim() || !(Number(b.percentual) > 0))) return 'Cada pessoa precisa de nome e percentual.';
      if (total > 50) return 'A soma passou de 50%. Confira os percentuais.';
      if (cfg.asaas_ativo?.valor === true && benef.some(b => !b.walletId.trim())) return 'Com o Asaas ligado, todos precisam ter a carteira (walletId).';
      return null;
    }, [['split_beneficiarios', benef.map(b => ({ nome: b.nome.trim(), walletId: b.walletId.trim(), percentual: Number(b.percentual) }))]])} />
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
  const { erro, ocupado, salvar } = useSalvar(ctx, 'Avisos salvos');

  return <>
    <Caixa titulo="Quando enviar" desc="Lembretes e avisos de atraso das parcelas do Limpa Nome, pelo WhatsApp.">
      <div className="cfg-grid">
        <div className="field"><label>Lembrete: dias antes <Dica t="0 = no dia do vencimento. Separe por vírgula." /></label><input className="input" value={lemb} onChange={e => setLemb(e.target.value)} placeholder="3, 0" /></div>
        <div className="field"><label>Atraso: dias depois <Dica t="Separe por vírgula. Ex.: 1, 5" /></label><input className="input" value={venc} onChange={e => setVenc(e.target.value)} placeholder="1, 5" /></div>
        <div className="field"><label>Horário permitido</label><div className="row"><input className="input" type="time" value={jan.inicio} onChange={e => setJan({ ...jan, inicio: e.target.value })} /><span className="small">até</span><input className="input" type="time" value={jan.fim} onChange={e => setJan({ ...jan, fim: e.target.value })} /></div></div>
      </div>
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
      [['notif_lembrete_dias', lerDias(lemb)], ['notif_vencida_dias', lerDias(venc)], ['notif_janela', jan], ['notif_textos', textos]])} />
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
