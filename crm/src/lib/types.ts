export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'proposta' | 'pago' | 'agendado' | 'concluido' | 'perdido' | 'desqualificado';

export interface Lead {
  id: string; telefone: string; nome: string | null; nome_whatsapp: string | null; cpf_cnpj: string | null; email: string | null;
  servico: 'indefinido' | 'diagnostico' | 'limpa_nome' | 'combo' | 'rating'; objetivo: string | null; urgencia: 'alta' | 'media' | 'baixa' | null;
  etapa: Etapa; motivo_perda: string | null; origem: string; anuncio: any; consentimento_lgpd_em: string | null;
  forma_pagamento: string | null; valor_previsto: number | null; valor_venda: number | null;
  pagamento_status: 'nenhum' | 'link_enviado' | 'informado' | 'confirmado'; documento_recebido: boolean; contrato_assinado: boolean;
  resumo: string | null; observacoes: string | null; primeira_msg_em: string | null; primeira_resposta_em: string | null;
  ultima_msg_lead_em: string | null; qualificado_em: string | null; proposta_em: string | null; pago_em: string | null;
  agendado_em: string | null; concluido_em: string | null; perdido_em: string | null; criado_em: string; atualizado_em: string;
}

export interface Conversa {
  id: string; lead_id: string; telefone: string; modo: 'ia' | 'humano'; humano_ultima_atividade_em: string | null;
  assumida_manual: boolean; assumida_por: string | null; aguardando_humano: boolean; motivo_handoff: string | null;
  ultima_msg_em: string | null; nao_lidas: number; followup_etapa: number; criado_em: string;
  ia_ativa: boolean; ia_retorna_em: string | null; nome: string | null; nome_whatsapp: string | null; etapa: Etapa;
  servico: string; urgencia: string | null; origem: string; pagamento_status: string;
  ultima_msg_texto: string | null; ultima_msg_autor: string | null;
}

export interface Mensagem {
  id: number; conversa_id: string; lead_id: string; direcao: 'in' | 'out'; autor: 'lead' | 'ia' | 'humano' | 'sistema';
  tipo: string; texto: string | null; midia_descricao: string | null; status_envio: string | null; criado_em: string;
}

export interface Reuniao { id: string; lead_id: string; inicio: string; fim: string; status: string; meet_link: string | null; closer: string | null; observacao: string | null; }
export interface Evento { id: number; lead_id: string; etapa_de: string | null; etapa_para: string; motivo: string | null; por: string; criado_em: string; }
export interface Alerta { id: number; tipo: string; lead_id: string | null; conversa_id: string | null; mensagem: string; lido: boolean; criado_em: string; }
export interface ConfigRow { chave: string; valor: any; descricao: string | null; atualizado_em: string; atualizado_por: string | null; }

export const ETAPAS: { id: Etapa; nome: string; cor: string }[] = [
  { id: 'novo', nome: 'Novo lead', cor: '#64748b' },
  { id: 'em_atendimento', nome: 'Em atendimento', cor: '#3b82f6' },
  { id: 'qualificado', nome: 'Qualificado', cor: '#8b5cf6' },
  { id: 'proposta', nome: 'Proposta / checkout', cor: '#f59e0b' },
  { id: 'pago', nome: 'Pago', cor: '#10b981' },
  { id: 'agendado', nome: 'Reunião agendada', cor: '#0ea5e9' },
  { id: 'concluido', nome: 'Concluído', cor: '#059669' },
  { id: 'perdido', nome: 'Perdeu interesse', cor: '#ef4444' },
  { id: 'desqualificado', nome: 'Desqualificado', cor: '#9ca3af' },
];
export const FUNIL: Etapa[] = ['novo', 'em_atendimento', 'qualificado', 'proposta', 'pago', 'agendado', 'concluido'];
export const etapaInfo = (e: string) => ETAPAS.find(x => x.id === e) || ETAPAS[0];
export const ordemEtapa = (e: string) => FUNIL.indexOf(e as Etapa);

// ---------------------------------------------------------------- financeiro (Asaas + split)
export type StatusContrato = 'aguardando_pagamento' | 'ativo' | 'inadimplente' | 'quitado' | 'cancelado' | 'estornado';
export interface Contrato {
  id: string; lead_id: string; servico: 'diagnostico' | 'limpa_nome' | 'combo' | 'rating' | 'personalizada'; modalidade: 'avista' | '2x' | 'tap' | 'personalizada'; valor_total: number;
  descricao?: string | null; com_split?: boolean;
  status: StatusContrato; processo_etapa: string | null; processo_detalhe: string | null; processo_atualizado_em: string | null;
  aderido_em: string | null; quitado_em: string | null; desconto_quitacao: number | null; criado_por: string; criado_em: string;
  nome: string | null; nome_whatsapp: string | null; telefone: string; cpf_cnpj: string | null; email: string | null;
  pago: number; saldo_devedor: number; vencido: number; pagamentos_feitos: number; pagamentos_total: number;
  custo_produto: number; custo_recuperado: number;
}
export type StatusCobranca = 'planejada' | 'a_gerar' | 'gerando' | 'pendente' | 'vencida' | 'confirmada' | 'recebida' | 'estornada' | 'a_cancelar' | 'cancelada';
export interface Cobranca {
  id: string; contrato_id: string; lead_id: string; numero: number; tipo: 'avista' | 'adesao' | 'parcela' | 'quitacao' | 'unica';
  valor: number; vencimento: string | null; status: StatusCobranca; motivo_cancelamento: string | null; asaas_payment_id: string | null;
  invoice_url: string | null; forma_paga: string | null; valor_pago: number | null; valor_liquido: number | null; valor_estornado: number | null;
  pago_em: string | null; erro: string | null; criado_em: string; custo_alocado?: number;
}
export interface Comissao {
  id: number; cobranca_id: string; contrato_id: string; lead_id: string; beneficiario: string; wallet_id: string | null;
  base: number; percentual: number | null; valor: number; status: 'prevista' | 'a_liquidar' | 'liquidada' | 'estornada' | 'cancelada';
  liquidada_em: string | null; criado_em: string;
}
export interface Notificacao {
  id: number; lead_id: string; contrato_id: string | null; cobranca_id: string | null;
  tipo: 'link_pagamento' | 'lembrete' | 'vencida' | 'andamento' | 'quitacao' | 'manual'; texto: string;
  status: 'pendente' | 'enviada' | 'cancelada'; agendada_para: string; enviada_em: string | null; criado_por: string; criado_em: string;
}
export const MODALIDADE: Record<string, string> = { avista: 'À vista', '2x': '2x', tap: 'TAP · entrada + 5x', personalizada: 'Personalizada' };
export const STATUS_CONTRATO: Record<StatusContrato, { nome: string; cls: string }> = {
  aguardando_pagamento: { nome: 'Aguardando 1º pagamento', cls: 'gray' }, ativo: { nome: 'Em dia', cls: 'ok' },
  inadimplente: { nome: 'Inadimplente', cls: 'bad' }, quitado: { nome: 'Quitado', cls: 'info' },
  cancelado: { nome: 'Cancelado', cls: 'gray' }, estornado: { nome: 'Estornado', cls: 'warn' },
};
export const STATUS_COBRANCA: Record<StatusCobranca, { nome: string; cls: string }> = {
  planejada: { nome: 'Agendada', cls: 'gray' }, a_gerar: { nome: 'Gerando link', cls: 'gray' }, gerando: { nome: 'Gerando link', cls: 'gray' },
  pendente: { nome: 'Aguardando', cls: 'info' }, vencida: { nome: 'Vencida', cls: 'bad' }, confirmada: { nome: 'Paga', cls: 'ok' },
  recebida: { nome: 'Paga', cls: 'ok' }, estornada: { nome: 'Estornada', cls: 'warn' }, a_cancelar: { nome: 'Substituída', cls: 'gray' },
  cancelada: { nome: 'Cancelada', cls: 'gray' },
};
export const PAGA = (c: { status: string }) => c.status === 'confirmada' || c.status === 'recebida';
export const EM_ABERTO = (c: { status: string }) => ['planejada', 'a_gerar', 'gerando', 'pendente', 'vencida'].includes(c.status);
export function rotuloCobranca(c: Cobranca, todas: Cobranca[], modalidade: string) {
  if (c.tipo === 'adesao') return 'Entrada';
  if (c.tipo === 'quitacao') return 'Quitação do saldo';
  if (c.tipo === 'avista') return 'À vista';
  if (c.tipo === 'unica') return 'Diagnóstico';
  const parcelas = todas.filter(x => x.contrato_id === c.contrato_id && (x.tipo === 'parcela')).length;
  return `Parcela ${modalidade === 'tap' ? c.numero - 1 : c.numero} de ${parcelas}`;
}
