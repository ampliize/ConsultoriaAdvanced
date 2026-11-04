export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'proposta' | 'pago' | 'agendado' | 'concluido' | 'perdido' | 'desqualificado';

export interface Lead {
  id: string; telefone: string; nome: string | null; nome_whatsapp: string | null; cpf_cnpj: string | null; email: string | null;
  servico: 'indefinido' | 'diagnostico' | 'limpa_nome'; objetivo: string | null; urgencia: 'alta' | 'media' | 'baixa' | null;
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
