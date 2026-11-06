import { useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, Unplug, Smartphone } from 'lucide-react';
import type { Ctx } from '../App';
import type { WhatsappResp } from '../lib/api';

const ROTULO: Record<string, { txt: string; cls: string }> = {
  open: { txt: 'Conectado', cls: 'ok' },
  connecting: { txt: 'Aguardando leitura do QR Code', cls: 'warn' },
  close: { txt: 'Desconectado', cls: 'bad' },
  inexistente: { txt: 'Instância ainda não criada', cls: 'gray' },
  sem_config: { txt: 'Falta configurar a Evolution', cls: 'gray' },
  desconhecido: { txt: 'Sem resposta da Evolution', cls: 'gray' },
};

export default function WhatsappConexao({ ctx }: { ctx: Ctx }) {
  const [estado, setEstado] = useState<string>('');
  const [qr, setQr] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [url, setUrl] = useState<string>(ctx.snap.config.evolution_base_url?.valor || '');
  const [inst, setInst] = useState<string>(ctx.snap.config.evolution_instancia?.valor || 'advance');
  const salvarEvo = async () => {
    if (!/^https?:\/\//.test(url.trim())) { setErro('A URL precisa começar com https://'); return; }
    setOcupado(true);
    try {
      await ctx.api.salvarConfig('evolution_base_url', url.trim().replace(/\/+$/, '').replace(/\/manager$/i, ''));
      await ctx.api.salvarConfig('evolution_instancia', inst.trim() || 'advance');
      ctx.toast('Evolution configurada'); ctx.recarregar(); setErro(''); await status();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  };
  const timers = useRef<any[]>([]);
  const limpar = () => { timers.current.forEach(clearInterval); timers.current = []; };

  const tratar = (r: WhatsappResp) => {
    setErro(r.erro || (r.estado === 'desconhecido' && r.detalhe ? String(r.detalhe) : ''));
    if (r.estado) setEstado(r.estado);
    return r;
  };
  const status = async () => { try { const r = tratar(await ctx.api.whatsapp('status')); if (r.estado === 'open') { setQr(null); limpar(); } } catch (e: any) { setErro(e.message); } };
  const conectar = async () => {
    setOcupado(true); setErro('');
    try {
      const r = tratar(await ctx.api.whatsapp('conectar'));
      if (r.estado === 'open') { setQr(null); return; }
      if (r.qr) {
        setQr(r.qr.startsWith('data:') ? r.qr : 'data:image/png;base64,' + r.qr); setEstado('connecting'); setSegundos(40);
        limpar();
        timers.current.push(setInterval(status, 4000));
        timers.current.push(setInterval(() => setSegundos(s => s - 1), 1000));
      }
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  };
  const desconectar = async () => {
    if (!confirm('Desconectar o WhatsApp do atendimento? O SDR para de receber e enviar mensagens até conectar de novo.')) return;
    setOcupado(true); limpar(); setQr(null);
    try { tratar(await ctx.api.whatsapp('desconectar')); await status(); } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  };
  useEffect(() => { status(); return limpar; }, []);
  useEffect(() => { if (qr && segundos <= 0 && estado === 'connecting') conectar(); }, [segundos]);

  const r = ROTULO[estado] || { txt: estado ? estado : 'Verificando…', cls: 'gray' };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3><Smartphone size={16} /> Conexão do WhatsApp <span className={'pill ' + r.cls} style={{ marginLeft: 'auto' }}><span className={'dot' + (estado === 'connecting' ? ' pulse' : '')} /> {r.txt}</span></h3>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: '1 1 260px' }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Conecte o celular que vai atender os leads (qualquer número de WhatsApp). Clique em <b>Gerar QR Code</b>, abra o WhatsApp desse celular → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e aponte a câmera para o código.
          </p>
          <div className="row wrap">
            {estado !== 'open' && <button className="btn primary" disabled={ocupado} onClick={conectar}><QrCode size={16} /> {qr ? 'Gerar novo QR Code' : 'Gerar QR Code'}</button>}
            <button className="btn" disabled={ocupado} onClick={status}><RefreshCw size={15} /> Atualizar status</button>
            {estado === 'open' && <button className="btn danger" disabled={ocupado} onClick={desconectar}><Unplug size={15} /> Desconectar</button>}
          </div>
          {(estado === 'sem_config' || estado === 'desconhecido' || estado === 'inexistente') && (
            <div className="row wrap" style={{ marginTop: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '2 1 260px', margin: 0 }}><label>URL da Evolution API</label><input className="input" placeholder="https://evolution.seudominio.com" value={url} onChange={e => setUrl(e.target.value)} /></div>
              <div className="field" style={{ flex: '1 1 140px', margin: 0 }}><label>Nome da instância</label><input className="input" value={inst} onChange={e => setInst(e.target.value)} /></div>
              <button className="btn primary" disabled={ocupado} onClick={salvarEvo}>Salvar</button>
            </div>
          )}
          {erro && estado !== 'sem_config' && <div className="err" style={{ marginTop: 10 }}>{erro}</div>}
          {estado === 'open' && <p className="small" style={{ color: 'var(--ok)', fontWeight: 600 }}>WhatsApp conectado. As mensagens dos leads já chegam ao SDR.</p>}
        </div>
        {qr && estado !== 'open' && (
          <div style={{ textAlign: 'center' }}>
            <img src={qr} alt="QR Code do WhatsApp" style={{ width: 240, height: 240, border: '1px solid var(--line)', borderRadius: 10, background: '#fff', padding: 6 }} />
            <div className="small muted">{segundos > 0 ? `Novo código em ${segundos}s` : 'Gerando novo código…'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
