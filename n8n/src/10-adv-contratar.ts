import { workflow, node, trigger, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

// ADV · Contratar — ferramenta gerar_link_pagamento da IA.
// Cria o contrato (serviço + modalidade) e devolve o link: pelo Asaas (com split)
// quando asaas_ativo = true, ou pelos links fixos do CRM quando desligado.

const pgCred = newCredential('ADV Supabase Postgres');

const entrada = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Pedido da IA',
    parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'conversa_id' }, { name: 'servico' }, { name: 'modalidade' }, { name: 'vencimento' }] } },
    position: [0, 300]
  },
  output: [{ conversa_id: '00000000-0000-0000-0000-000000000000', servico: 'limpa_nome', modalidade: 'tap' }]
});

const contratar = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Criar contrato',
    parameters: {
      operation: 'executeQuery',
      query: "select public.iniciar_contratacao($1::uuid, $2, $3, 'ia', public.data_segura($4)) as r",
      options: { queryReplacement: expr("{{ [ $json.conversa_id, $json.servico, $json.modalidade || '', $json.vencimento || '' ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [240, 300]
  },
  output: [{ r: { ok: true, acao: 'gerar_cobranca', cobranca_id: '00000000-0000-0000-0000-000000000000', condicao: 'x', total: 1047 } }]
});

const gerar = ifElse({
  version: 2.2,
  config: {
    name: 'Gerar no Asaas?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr("{{ $json.r.acao || '' }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'gerar_cobranca' }],
        combinator: 'and'
      }
    },
    position: [480, 300]
  }
});

const asaas = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Criar cobrança no Asaas',
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'vSXROKXHWOPll0fl', cachedResultName: 'ADV · Asaas' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { cobranca_id: expr('{{ $json.r.cobranca_id }}'), origem: 'agente' },
        matchingColumns: [],
        schema: [
          { id: 'cobranca_id', displayName: 'cobranca_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'origem', displayName: 'origem', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueRegularOutput',
    position: [720, 200]
  },
  output: [{ resultado: { ok: true, link: 'https://sandbox.asaas.com/i/1' } }]
});

const respostaAsaas = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Resposta com link',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [{ id: 'r1', name: 'resultado', type: 'object', value: expr("{{ Object.assign({ condicao: $('Criar contrato').item.json.r.condicao, valor_primeiro_pagamento: $('Criar contrato').item.json.r.valor, valor_total: $('Criar contrato').item.json.r.total }, $json.resultado || { ok: false, orientacao: 'O link está sendo gerado e chega por aqui em instantes. Diga isso ao lead e NÃO invente link.' }) }}") }] },
      options: {}
    },
    position: [960, 200]
  }
});

const respostaDireta = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Resposta direta',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [{ id: 'r2', name: 'resultado', type: 'object', value: expr('{{ $json.r }}') }] },
      options: {}
    },
    position: [720, 420]
  }
});

export default workflow('adv-contratar', 'ADV · Contratar')
  .add(entrada)
  .to(contratar)
  .to(gerar
    .onTrue(asaas.to(respostaAsaas))
    .onFalse(respostaDireta));
