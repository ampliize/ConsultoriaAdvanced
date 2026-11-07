import { useEffect, useState } from 'react';
import { Wallet, Copy, Plus, Trash2 } from 'lucide-react';
import type { Ctx } from '../App';

const WEBHOOK = 'https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-asaas-eventos-r7t4k2';
const EVENTOS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_RESTORED', 'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_SPLIT_DONE', 'PAYMENT_SPLIT_CANCELLED',
  'PAYMENT_SPLIT_DIVERGENCE_BLOCK', 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED'];
const TEXTOS: { k: string; nome: string }[] = [
  { k: 'lembrete', nome: 'Lembrete antes do vencimento' }, { k: 'lembrete_hoje', nome: 'Lembrete no dia do vencimento' },
  { k: 'vencida', nome: 'Parcela vencida' }, { k: 'link', nome: 'Envio de link de pagamento' }, { k: 'quitacao', nome: 'Link de quitação' },
];
const dias = (v: any) => (Array.isArray(v) ? v.join(', ') : '');
const lerDias = (s: string) => Array.from(new Set(s.split(/[,\s;]+/).map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x >= 0 && x <= 60))).sort((a, b) => b - a);

export default function FinanceiroConfig({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const [ativo, setAtivo] = useState<boolean>(cfg.asaas_ativo?.valor === true);
  const [base, setBase] = useState<string>(cfg.asaas_base_url?.valor || 'https://api-sandbox.asaas.com/v3');
  const [forma, setForma] = useState<string>(cfg.asaas_forma_cobranca?.valor || 'BOLETO');
  const [benef, setBenef] = useState<{ nome: string; walletId: string; percentual: number }[]>(Array.isArray(cfg.split_beneficiarios?.valor) ? cfg.split_beneficiarios.valor : []);
  const [lemb, setLemb] = useState(dias(cfg.notif_lembrete_dias?.valor ?? [3, 0]));
  const [venc, setVenc] = useState(dias(cfg.notif_vencida_dias?.valor ?? [1, 5]));
  const [jan, setJan] = useState<{ inicio: string; fim: string }>(cfg.notif_janela?.valor || { inicio: '08:00', fim: '20:00' });
  const [textos, setTextos] = useState<Record<string, string>>(cfg.notif_textos?.valor || {});
  const [etapas, setEtapas] = useState<{ id: string; nome: string; texto: string }[]>(Array.isArray(cfg.processo_etapas?.valor) ? cfg.processo_etapas.valor : []);
  const [erro, setErro] = useState('');
  useEffect(() => { setAtivo(cfg.asaas_ativo?.valor === true); }, [cfg.asaas_ativo?.valor]);
  const total = benef.reduce((a, b) => a + (Number(b.percentual) || 0), 0);
  const producao = base.includes('api.asaas.com') && !base.includes('sandbox');

  const salvar = async () => {
    setErro('');
    if (benef.some(b => !b.nome.trim() || !(Number(b.percentual) > 0))) return setErro('Cada beneficiário precisa de nome e percentual.');
    if (total > 50) return setErro('A soma do split passou de 50%. Confira os percentuais.');
    if (ativo && benef.some(b => !b.walletId.trim())) return setErro('Para ligar o Asaas, preencha o walletId de todos os beneficiários do split.');
    const l = lerDias(lemb), v = lerDias(venc);
    if (jan.inicio >= jan.fim) return setErro('O horário final das notificações precisa ser depois do inicial.');
    try {
      await ctx.api.salvarConfig('asaas_base_url', base);
      await ctx.api.salvarConfig('asaas_forma_cobranca', forma);
      await ctx.api.salvarConfig('split_beneficiarios', benef.map(b => ({ nome: b.nome.trim(), walletId: b.walletId.trim(), percentual: Number(b.percentual) })));
      await ctx.api.salvarConfig('notif_lembrete_dias', l);
      await ctx.api.salvarConfig('notif_vencida_dias', v);
      await ctx.api.salvarConfig('notif_janela', jan);
      await ctx.api.salvarConfig('notif_textos', textos);
      await ctx.api.salvarConfig('processo_etapas', etapas.map((e, i) => ({ ...e, id: e.id || 'etapa_' + (i + 1) })));
      await ctx.api.salvarConfig('asaas_ativo', ativo);
      ctx.toast('Financeiro salvo'); ctx.recarregar();
    } catch (e: any) { setErro(e.message); }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3><Wallet size={16} /> Cobrança pelo Asaas, split e avisos aos clientes</h3>

      <label className="small b" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /> Gerar as cobranças pelo Asaas (com split)
      </label>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>Desligado: a IA continua usando os links fixos de pagamento. Ligado: cada lead recebe um boleto/PIX só dele, o pagamento é confirmado sozinho e as parcelas são cobradas mês a mês.</p>

      <div className="row wrap">
        <div className="field"><label>Ambiente</label>
          <select className="input" value={producao ? 'p' : 's'} onChange={e => setBase(e.target.value === 'p' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')}>
            <option value="s">Sandbox (testes, sem dinheiro real)</option><option value="p">Produção (cobranças reais)</option>
          </select></div>
        <div className="field"><label>Forma de cobrança</label>
          <select className="input" value={forma} onChange={e => setForma(e.target.value)}>
            <option value="BOLETO">Boleto (com PIX na fatura)</option><option value="PIX">Só PIX</option><option value="UNDEFINED">Cliente escolhe (formas habilitadas na conta)</option>
          </select></div>
      </div>
      {producao && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>Produção: as cobranças são reais. A chave da API no n8n precisa ser a de produção.</div>}

      <h4 style={{ margin: '16px 0 4px' }}>Split do Limpa Nome <span className="small muted">({total.toLocaleString('pt-BR')}% do valor bruto de cada pagamento)</span></h4>
      <p className="small muted" style={{ marginTop: 0 }}>O walletId é o identificador da conta Asaas de quem recebe (não é senha). O Asaas manda o valor fixo para cada conta quando o cliente paga.</p>
      {benef.map((b, i) => (
        <div className="row wrap" key={i} style={{ marginBottom: 6 }}>
          <input className="input" style={{ width: 110 }} placeholder="Nome" value={b.nome} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} />
          <input className="input" style={{ flex: 1, minWidth: 200, fontFamily: 'monospace', fontSize: 12 }} placeholder="walletId (ex.: 48548710-9baa-4ec1-a11f-9010193527c6)" value={b.walletId} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, walletId: e.target.value } : x))} />
          <input className="input" type="number" step="0.5" min={0} style={{ width: 80 }} value={b.percentual} onChange={e => setBenef(benef.map((x, j) => j === i ? { ...x, percentual: Number(e.target.value) } : x))} /><span className="small">%</span>
          <button type="button" className="btn sm" title="Remover" onClick={() => setBenef(benef.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setBenef([...benef, { nome: '', walletId: '', percentual: 12.5 }])}><Plus size={14} /> Adicionar beneficiário</button>

      <h4 style={{ margin: '16px 0 4px' }}>Avisos automáticos no WhatsApp</h4>
      <div className="row wrap">
        <div className="field"><label>Lembrete: dias antes do vencimento</label><input className="input" style={{ width: 120 }} value={lemb} onChange={e => setLemb(e.target.value)} placeholder="3, 0" /></div>
        <div className="field"><label>Atraso: dias depois do vencimento</label><input className="input" style={{ width: 120 }} value={venc} onChange={e => setVenc(e.target.value)} placeholder="1, 5" /></div>
        <div className="field"><label>Enviar entre</label><div className="row"><input className="input" type="time" value={jan.inicio} onChange={e => setJan({ ...jan, inicio: e.target.value })} /><span className="small">e</span><input className="input" type="time" value={jan.fim} onChange={e => setJan({ ...jan, fim: e.target.value })} /></div></div>
      </div>
      <p className="small muted">Use <b>{'{nome}'}</b>, <b>{'{parcela}'}</b>, <b>{'{valor}'}</b>, <b>{'{vencimento}'}</b> e <b>{'{link}'}</b> nos textos. "0" no lembrete = no dia do vencimento.</p>
      {TEXTOS.map(t => (
        <div className="field" key={t.k} style={{ marginBottom: 8 }}><label>{t.nome}</label>
          <textarea className="input" rows={2} value={textos[t.k] || ''} onChange={e => setTextos({ ...textos, [t.k]: e.target.value })} /></div>
      ))}

      <h4 style={{ margin: '16px 0 4px' }}>Andamento do processo (mensagens ao cliente)</h4>
      <p className="small muted" style={{ marginTop: 0 }}>Você escolhe a etapa no cliente (Clientes · Financeiro) e ele recebe a mensagem. Use <b>{'{nome}'}</b> e <b>{'{detalhe}'}</b> (ex.: número do processo).</p>
      {etapas.map((e, i) => (
        <div key={i} className="card" style={{ padding: 10, marginBottom: 8, boxShadow: 'none' }}>
          <div className="row"><input className="input" style={{ flex: 1 }} value={e.nome} onChange={ev => setEtapas(etapas.map((x, j) => j === i ? { ...x, nome: ev.target.value } : x))} />
            <button type="button" className="btn sm" title="Remover etapa" onClick={() => setEtapas(etapas.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>
          <textarea className="input" rows={2} style={{ width: '100%', marginTop: 6 }} value={e.texto} onChange={ev => setEtapas(etapas.map((x, j) => j === i ? { ...x, texto: ev.target.value } : x))} />
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setEtapas([...etapas, { id: 'etapa_' + Date.now(), nome: 'Nova etapa', texto: '{nome}, ' }])}><Plus size={14} /> Adicionar etapa</button>

      <h4 style={{ margin: '16px 0 4px' }}>Webhook para configurar no Asaas</h4>
      <div className="row"><code className="small" style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all' }}>{WEBHOOK}</code>
        <button type="button" className="btn sm" onClick={() => { navigator.clipboard?.writeText(WEBHOOK); ctx.toast('URL copiada'); }}><Copy size={14} /></button></div>
      <p className="small muted">Eventos a marcar no Asaas: {EVENTOS.join(', ')}.</p>

      {erro && <div className="err">{erro}</div>}
      <button className="btn primary" style={{ marginTop: 8 }} onClick={salvar}>Salvar financeiro</button>
    </div>
  );
}
