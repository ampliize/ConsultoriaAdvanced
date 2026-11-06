import { useEffect, useRef, useState } from 'react';
import { BellRing, Plus, Trash2 } from 'lucide-react';
import type { Ctx } from '../App';

interface Lembrete { qtd: number; unidade: 'horas' | 'dias'; texto: string }

const PADRAO_TEXTOS = [
  'Oi, {nome}! Conseguiu ver minha última mensagem? Estou por aqui para te ajudar a destravar seu crédito.',
  '{nome}, passando para saber se ainda posso te ajudar. Quer que eu siga com a sua análise?',
  '{nome}, vou deixar seu atendimento em pausa por aqui. Quando quiser retomar, é só me mandar uma mensagem.',
];

function montar(horas: number[], textos: string[]): Lembrete[] {
  return horas.map((h, i) => ({
    qtd: h % 24 === 0 && h >= 24 ? h / 24 : h,
    unidade: h % 24 === 0 && h >= 24 ? 'dias' : 'horas',
    texto: textos[i] || '',
  }));
}

export default function FollowupEditor({ ctx }: { ctx: Ctx }) {
  const cfg = ctx.snap.config;
  const horasCfg: number[] = Array.isArray(cfg.followup_horas?.valor) ? cfg.followup_horas.valor : [2, 24, 48];
  const textosCfg: string[] = Array.isArray(cfg.followup_mensagens?.valor) ? cfg.followup_mensagens.valor : PADRAO_TEXTOS;
  const [lista, setLista] = useState<Lembrete[]>(montar(horasCfg, textosCfg));
  const [ativo, setAtivo] = useState(horasCfg.length > 0);
  const [jan, setJan] = useState<{ inicio: string; fim: string }>(cfg.followup_janela?.valor || { inicio: '08:00', fim: '20:00' });
  const [erro, setErro] = useState('');
  const cursor = useRef<Record<number, number>>({});
  useEffect(() => { setLista(montar(horasCfg, textosCfg)); }, [JSON.stringify(cfg.followup_horas?.valor), JSON.stringify(cfg.followup_mensagens?.valor)]);

  const mudar = (i: number, patch: Partial<Lembrete>) => setLista(lista.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const inserirNome = (i: number) => {
    const t = lista[i].texto;
    const pos = Math.min(cursor.current[i] ?? t.length, t.length);
    cursor.current[i] = pos + 6;
    mudar(i, { texto: t.slice(0, pos) + '{nome}' + t.slice(pos) });
  };
  const salvar = async () => {
    const itens = ativo ? lista.map(l => ({ horas: Math.round(Number(l.qtd) * (l.unidade === 'dias' ? 24 : 1)), texto: l.texto.trim() })) : [];
    if (itens.some(x => !x.horas || x.horas < 1)) return setErro('Cada lembrete precisa de um tempo maior que zero.');
    if (itens.some(x => !x.texto)) return setErro('Escreva a mensagem de cada lembrete.');
    if (jan.inicio >= jan.fim) return setErro('O horário final precisa ser depois do inicial.');
    itens.sort((a, b) => a.horas - b.horas);
    setErro('');
    await ctx.api.salvarConfig('followup_horas', itens.map(x => x.horas));
    await ctx.api.salvarConfig('followup_mensagens', itens.map(x => x.texto));
    await ctx.api.salvarConfig('followup_janela', jan);
    ctx.toast('Follow-up salvo'); ctx.recarregar();
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3><BellRing size={16} /> Follow-up de quem parou de responder</h3>
      <label className="small b" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /> Enviar lembretes automáticos
      </label>
      {ativo && <>
        {lista.map((l, i) => (
          <div key={i} className="card" style={{ padding: 12, marginBottom: 10, boxShadow: 'none' }}>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <b className="small">Lembrete {i + 1}:</b>
              <span className="small">enviar</span>
              <input className="input" type="number" min={1} style={{ width: 70 }} value={l.qtd} onChange={e => mudar(i, { qtd: Number(e.target.value) })} />
              <select className="input" value={l.unidade} onChange={e => mudar(i, { unidade: e.target.value as any })}><option value="horas">horas</option><option value="dias">dias</option></select>
              <span className="small">depois da última mensagem sem resposta</span>
              <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} title="Remover lembrete" onClick={() => setLista(lista.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
            <textarea onSelect={e => { cursor.current[i] = (e.target as HTMLTextAreaElement).selectionStart; }} className="input" rows={2} style={{ width: '100%' }} value={l.texto} onChange={e => mudar(i, { texto: e.target.value })} />
            <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => inserirNome(i)}>+ Inserir nome do lead</button>
          </div>
        ))}
        {lista.length < 5 && <button type="button" className="btn sm" onClick={() => setLista([...lista, { qtd: (lista[lista.length - 1]?.qtd || 1) + 1, unidade: lista[lista.length - 1]?.unidade || 'dias', texto: '' }])}><Plus size={14} /> Adicionar lembrete</button>}
        <div className="row wrap" style={{ marginTop: 14 }}>
          <span className="small b">Só enviar entre</span>
          <input className="input" type="time" value={jan.inicio} onChange={e => setJan({ ...jan, inicio: e.target.value })} />
          <span className="small">e</span>
          <input className="input" type="time" value={jan.fim} onChange={e => setJan({ ...jan, fim: e.target.value })} />
        </div>
        <p className="small muted">Se o lead responder, os lembretes param. Sem resposta 24h depois do último lembrete, ele vai para <b>Perdeu interesse</b>. Fora do horário, o lembrete espera até o próximo horário permitido.</p>
      </>}
      {erro && <div className="err">{erro}</div>}
      <button className="btn primary" onClick={salvar}>Salvar follow-up</button>
    </div>
  );
}
