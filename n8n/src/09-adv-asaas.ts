import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

// ADV · Asaas — cobranças com split, webhook de eventos e sincronização a cada minuto.
// Regras de negócio ficam no banco (supabase/migrations/20261107000100_financeiro_asaas_split.sql).

const pgCred = newCredential('ADV Supabase Postgres');
const asaasCred = newCredential('ADV Asaas API');            // Header Auth: access_token = chave da API do Asaas
const webhookCred = newCredential('ADV Webhook Asaas');      // Header Auth: asaas-access-token = token do webhook

const UA = { parameters: [{ name: 'User-Agent', value: 'AdvanceCRM/1.0' }] };
const RESERVA = "$('Reservar cobrança').item.json";

// ---------------------------------------------------------------- gatilhos
const subfluxo = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Gerar cobrança (subfluxo)',
    parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'cobranca_id' }, { name: 'origem' }] } },
    position: [0, 300]
  },
  output: [{ cobranca_id: '00000000-0000-0000-0000-000000000000', origem: 'agente' }]
});

const aCadaMinuto = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'A cada minuto', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, position: [0, 700] }
});

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Eventos do Asaas (webhook)',
    parameters: { httpMethod: 'POST', path: 'adv-asaas-eventos-r7t4k2', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: webhookCred },
    position: [0, 1100]
  },
  output: [{ body: { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } } }]
});

// ---------------------------------------------------------------- webhook: guarda o evento (idempotente) e processa
const registrarEvento = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar e processar evento',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_registrar_evento($1::jsonb) as r',
      options: { queryReplacement: expr('{{ [ JSON.stringify($json.body) ] }}') }
    },
    credentials: { postgres: pgCred },
    position: [260, 1100]
  },
  output: [{ r: { ok: true } }]
});

const responder = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: { name: 'Responder 200', parameters: { respondWith: 'json', responseBody: '{"received":true}', options: {} }, position: [520, 1100] }
});

// ---------------------------------------------------------------- rotina: o que fazer no Asaas
const tarefas = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Tarefas pendentes no Asaas',
    parameters: { operation: 'executeQuery', query: 'select public.asaas_sincronizacao() as s', options: {} },
    credentials: { postgres: pgCred },
    position: [260, 700]
  },
  output: [{ s: { gerar: [], cancelar: [], base_url: 'https://api-sandbox.asaas.com/v3' } }]
});

const separar = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Separar tarefas',
    parameters: {
      jsCode: "const s = $input.first().json.s || {};\nconst out = [];\nfor (const id of (s.gerar || [])) out.push({ json: { tipo: 'gerar', cobranca_id: id, origem: 'rotina' } });\nfor (const c of (s.cancelar || [])) out.push({ json: { tipo: 'cancelar', cobranca_id: c.cobranca_id, payment_id: c.payment_id, base_url: s.base_url } });\nreturn out;"
    },
    position: [520, 700]
  },
  output: [{ tipo: 'gerar', cobranca_id: '00000000-0000-0000-0000-000000000000', origem: 'rotina' }]
});

const criarOuCancelar = ifElse({
  version: 2.2,
  config: {
    name: 'Criar ou cancelar?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.tipo }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'gerar' }],
        combinator: 'and'
      }
    },
    position: [760, 700]
  }
});

const cancelarNoAsaas = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Excluir cobrança substituída',
    parameters: {
      method: 'DELETE',
      url: expr('{{ $json.base_url }}/payments/{{ $json.payment_id }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: UA,
      options: { timeout: 20000 }
    },
    credentials: { httpHeaderAuth: asaasCred },
    onError: 'continueErrorOutput',
    position: [1000, 860]
  },
  output: [{ deleted: true, id: 'pay_1' }]
});

const cancelOk = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Marcar cancelada',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_cobranca_cancelada($1::uuid, true)',
      options: { queryReplacement: expr("{{ [ $('Separar tarefas').item.json.cobranca_id ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1240, 800]
  }
});

const cancelFalhou = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar falha ao excluir',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_cobranca_cancelada($1::uuid, $2::boolean, $3)',
      options: { queryReplacement: expr("{{ [ $('Separar tarefas').item.json.cobranca_id, String(JSON.stringify($json.error || $json)).includes('404'), String(JSON.stringify($json.error || $json)).slice(0, 400) ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1240, 960]
  }
});

// ---------------------------------------------------------------- criar a cobrança (subfluxo da IA e rotina)
const reservar = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Reservar cobrança',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_reservar_cobranca($1::uuid) as r, $2::text as origem',
      options: { queryReplacement: expr("{{ [ $json.cobranca_id, $json.origem || 'agente' ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1000, 400]
  },
  output: [{ r: { ok: true, pronta: false, cobranca_id: '00000000-0000-0000-0000-000000000000', lead_id: '00000000-0000-0000-0000-000000000000', base_url: 'https://api-sandbox.asaas.com/v3', asaas_customer_id: null, cliente: { name: 'Maria', cpfCnpj: '52998224725' }, cobranca: { billingType: 'BOLETO', value: 297, dueDate: '2026-11-10', externalReference: 'x', split: [] } }, origem: 'agente' }]
});

const precisaCriar = ifElse({
  version: 2.2,
  config: {
    name: 'Precisa criar no Asaas?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.r.ok === true && $json.r.pronta !== true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1240, 400]
  }
});

const respostaPronta = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Resposta (já existia ou ocupada)',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [{ id: 'res1', name: 'resultado', type: 'object', value: expr("{{ $json.r.ok && $json.r.pronta ? { ok: true, link: $json.r.link, valor: $json.r.valor } : { ok: false, erro: $json.r.erro, orientacao: 'O link está sendo gerado e chega por aqui em instantes. Diga isso ao lead e NÃO invente link.' } }}") }] },
      options: {}
    },
    position: [1480, 560]
  }
});

const temCliente = ifElse({
  version: 2.2,
  config: {
    name: 'Já tem cliente no Asaas?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr("{{ $json.r.asaas_customer_id || '' }}"), operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1480, 300]
  }
});

const clienteConhecido = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cliente conhecido',
    parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'c1', name: 'customer_id', type: 'string', value: expr('{{ $json.r.asaas_customer_id }}') }] }, options: {} },
    position: [1720, 160]
  }
});

const buscarCliente = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Buscar cliente pelo CPF',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.r.base_url }}/customers'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'cpfCnpj', value: expr('{{ $json.r.cliente.cpfCnpj }}') }] },
      sendHeaders: true,
      headerParameters: UA,
      options: { timeout: 20000 }
    },
    credentials: { httpHeaderAuth: asaasCred },
    onError: 'continueErrorOutput',
    position: [1720, 340]
  },
  output: [{ totalCount: 0, data: [] }]
});

const achouCliente = ifElse({
  version: 2.2,
  config: {
    name: 'Achou o cliente?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ ($json.data || []).length > 0 }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [1960, 340]
  }
});

const clienteEncontrado = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cliente encontrado',
    parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'c2', name: 'customer_id', type: 'string', value: expr('{{ $json.data[0].id }}') }] }, options: {} },
    position: [2200, 260]
  }
});

const criarCliente = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Criar cliente',
    parameters: {
      method: 'POST',
      url: expr(`{{ ${RESERVA}.r.base_url }}/customers`),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: UA,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(`{{ JSON.stringify(${RESERVA}.r.cliente) }}`),
      options: { timeout: 20000 }
    },
    credentials: { httpHeaderAuth: asaasCred },
    onError: 'continueErrorOutput',
    position: [2200, 420]
  },
  output: [{ id: 'cus_1' }]
});

const clienteCriado = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cliente criado',
    parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'c3', name: 'customer_id', type: 'string', value: expr('{{ $json.id }}') }] }, options: {} },
    position: [2440, 420]
  }
});

const salvarCliente = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Salvar cliente',
    parameters: {
      operation: 'executeQuery',
      query: 'select $2::text as customer_id, public.asaas_salvar_cliente($1::uuid, $2) is null as ok',
      options: { queryReplacement: expr(`{{ [ ${RESERVA}.r.lead_id, $json.customer_id ] }}`) }
    },
    credentials: { postgres: pgCred },
    position: [2680, 300]
  },
  output: [{ customer_id: 'cus_1', ok: true }]
});

const cobrancaExiste = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Cobrança já existe no Asaas?',
    parameters: {
      method: 'GET',
      url: expr(`{{ ${RESERVA}.r.base_url }}/payments`),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'externalReference', value: expr(`{{ ${RESERVA}.r.cobranca_id }}`) }] },
      sendHeaders: true,
      headerParameters: UA,
      options: { timeout: 20000 }
    },
    credentials: { httpHeaderAuth: asaasCred },
    onError: 'continueErrorOutput',
    position: [2920, 300]
  },
  output: [{ totalCount: 0, data: [] }]
});

const jaExiste = ifElse({
  version: 2.2,
  config: {
    name: 'Já foi criada antes?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr("{{ ($json.data || []).filter(p => !p.deleted).length > 0 }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    },
    position: [3160, 300]
  }
});

const cobrancaExistente = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Usar a existente',
    parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'p1', name: 'payment', type: 'object', value: expr('{{ $json.data.filter(p => !p.deleted)[0] }}') }] }, options: {} },
    position: [3400, 220]
  }
});

const criarCobranca = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Criar cobrança com split',
    parameters: {
      method: 'POST',
      url: expr(`{{ ${RESERVA}.r.base_url }}/payments`),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: UA,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(`{{ JSON.stringify(Object.assign({}, ${RESERVA}.r.cobranca, { customer: $('Salvar cliente').item.json.customer_id }, ${RESERVA}.r.cobranca.split.length ? {} : { split: undefined })) }}`),
      options: { timeout: 30000 }
    },
    credentials: { httpHeaderAuth: asaasCred },
    onError: 'continueErrorOutput',
    position: [3400, 380]
  },
  output: [{ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/1', dueDate: '2026-11-10', split: [] }]
});

const cobrancaCriada = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cobrança criada',
    parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [{ id: 'p2', name: 'payment', type: 'object', value: expr('{{ $json }}') }] }, options: {} },
    position: [3640, 380]
  }
});

const registrarCobranca = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar cobrança',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_cobranca_criada($1::uuid, $2::jsonb, $3) as r',
      options: { queryReplacement: expr(`{{ [ ${RESERVA}.r.cobranca_id, JSON.stringify($json.payment), ${RESERVA}.origem ] }}`) }
    },
    credentials: { postgres: pgCred },
    position: [3880, 300]
  },
  output: [{ r: { ok: true, link: 'https://sandbox.asaas.com/i/1', valor: 297, condicao: 'x' } }]
});

const resposta = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Resposta (link gerado)',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [{ id: 'res2', name: 'resultado', type: 'object', value: expr("{{ { ok: !!$json.r.link, link: $json.r.link, valor: $json.r.valor, condicao: $json.r.condicao, orientacao: 'Envie este link ao lead junto com a condição. Nunca altere o link.' } }}") }] },
      options: {}
    },
    position: [4120, 300]
  }
});

const falhou = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar falha no Asaas',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.asaas_cobranca_falhou($1::uuid, $2) as r',
      options: { queryReplacement: expr(`{{ [ ${RESERVA}.r.cobranca_id, String(JSON.stringify($json.error || $json)).slice(0, 450) ] }}`) }
    },
    credentials: { postgres: pgCred },
    position: [3160, 640]
  },
  output: [{ r: { ok: false } }]
});

const respostaFalhou = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Resposta (falhou, rotina tenta de novo)',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [{ id: 'res3', name: 'resultado', type: 'object', value: expr("{{ { ok: false, orientacao: 'O link está sendo gerado e chega por aqui em instantes. Diga isso ao lead e NÃO invente link.' } }}") }] },
      options: {}
    },
    position: [3400, 640]
  }
});

const nota = sticky(
  '## ADV · Asaas\n' +
  '**Subfluxo** (chamado pelo ADV · Contratar e pela rotina): reserva a cobrança no banco, acha ou cria o cliente pelo CPF, confere se a cobrança já existe (externalReference) e cria com **split em valor fixo** (12,5% do bruto para cada beneficiário). Se falhar, a rotina tenta de novo e manda o link ao cliente.\n\n' +
  '**Rotina (1 min):** cria as parcelas 10 dias antes do vencimento e exclui as substituídas por quitação.\n\n' +
  '**Webhook:** guarda cada evento pelo `id` (não processa repetido) e aplica a regra no banco: pago, vencido, estorno, split liquidado.\n\n' +
  'Credenciais: **ADV Asaas API** (header `access_token`) e **ADV Webhook Asaas** (header `asaas-access-token`).',
  [subfluxo, aCadaMinuto, webhook], { color: 4, width: 520, height: 360 }
);

export default workflow('adv-asaas', 'ADV · Asaas')
  .add(subfluxo).to(reservar)
  .add(aCadaMinuto).to(tarefas).to(separar).to(criarOuCancelar
    .onTrue(reservar)
    .onFalse(cancelarNoAsaas))
  .add(cancelarNoAsaas.onError(cancelFalhou))
  .add(cancelarNoAsaas).to(cancelOk)
  .add(reservar).to(precisaCriar
    .onTrue(temCliente
      .onTrue(clienteConhecido.to(salvarCliente))
      .onFalse(buscarCliente))
    .onFalse(respostaPronta))
  .add(buscarCliente).to(achouCliente
    .onTrue(clienteEncontrado.to(salvarCliente))
    .onFalse(criarCliente))
  .add(buscarCliente.onError(falhou))
  .add(criarCliente).to(clienteCriado).to(salvarCliente)
  .add(criarCliente.onError(falhou))
  .add(salvarCliente).to(cobrancaExiste).to(jaExiste
    .onTrue(cobrancaExistente.to(registrarCobranca))
    .onFalse(criarCobranca))
  .add(cobrancaExiste.onError(falhou))
  .add(criarCobranca).to(cobrancaCriada).to(registrarCobranca)
  .add(criarCobranca.onError(falhou))
  .add(registrarCobranca).to(resposta)
  .add(falhou).to(respostaFalhou)
  .add(webhook).to(registrarEvento).to(responder)
  .add(nota);
