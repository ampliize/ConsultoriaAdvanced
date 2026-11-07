import { workflow, node, trigger, sticky, newCredential, ifElse, languageModel, tool, expr } from '@n8n/workflow-sdk';

const pgCred = newCredential('ADV Supabase Postgres');
const openAiCred = { id: 'y4zS7euvKbfvsztt', name: 'OpenAI account' };

const entrada = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Recebe lote do lead',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: { values: [ { name: 'conversa_id' }, { name: 'telefone' }, { name: 'nome' }, { name: 'texto' }, { name: 'tinha_audio' }, { name: 'primeiro_id' }, { name: 'origem' } ] }
    },
    position: [0, 300]
  },
  output: [{ conversa_id: 'uuid', telefone: '5579999999999', nome: 'Maria', texto: 'Oi, quero limpar meu nome', tinha_audio: 'false', primeiro_id: '1', origem: 'mensagem' }]
});

const contexto = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Carregar contexto',
    parameters: {
      operation: 'executeQuery',
      query: "select public.contexto_conversa($1::uuid, 30, nullif($2, '')::bigint) as historico, public.perfil_lead($1::uuid) as perfil",
      options: { queryReplacement: expr("{{ [ $json.conversa_id, String($json.primeiro_id || '') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [240, 300]
  },
  output: [{ historico: '(primeira mensagem do lead)', perfil: { nome: 'Maria', etapa: 'em_atendimento', agora: 'quarta-feira, 04/11/2026 às 10:00' } }]
});

const modelo = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'OpenAI',
    parameters: {
      model: { __rl: true, mode: 'list', value: 'gpt-5-mini' },
      builtInTools: {},
      options: { reasoningEffort: 'low', timeout: 60000, maxRetries: 2 }
    },
    credentials: { openAiApi: openAiCred },
    position: [320, 560]
  }
});

const kb = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'consultar_base_conhecimento',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Respostas aprovadas pela Advance sobre os serviços (Diagnóstico e Limpa Nome): o que é, passo a passo, preço, prazo, documentos, contrato, garantia, o que pode e não pode prometer e como responder objeções. Use ANTES de responder dúvidas factuais ou objeções. Quando a resposta começar com ORIENTAÇÃO, siga-a com suas palavras. Lista vazia: não invente; transfira.',
      operation: 'executeQuery',
      query: 'select public.buscar_kb_json($1) as respostas',
      options: { queryReplacement: expr("{{ [ $fromAI('pergunta', 'Dúvida do lead em poucas palavras-chave, ex.: preço limpa nome, garantia, prazo, documentos', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [480, 560]
  }
});

const ficha = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'atualizar_ficha_lead',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Salva no CRM o que o lead informou. Chame sempre que ele disser nome completo, CPF/CNPJ, e-mail, objetivo, urgência, der o consentimento LGPD, enviar o documento de identificação ou quando o serviço ficar definido. Retorna o que ainda falta para qualificar (faltando) e erros (ex.: cpf_cnpj_invalido). Quando não falta nada, o lead vira QUALIFICADO.',
      operation: 'executeQuery',
      query: 'select public.atualizar_lead($1::uuid, $2::jsonb) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('dados', 'JSON só com os campos informados agora. Chaves possíveis: nome (nome completo), cpf_cnpj, email, servico (diagnostico|limpa_nome), objetivo (limpar_nome|buscar_credito|entender_negativa|outro), urgencia (alta|media|baixa), consentimento_lgpd (true), documento_recebido (true), resumo (1 frase com a situação do lead). Ex.: {\"nome\":\"Maria Souza Lima\",\"urgencia\":\"alta\"}', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [640, 560]
  }
});

const pagamento = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'gerar_link_pagamento',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Retorna o link de pagamento oficial e a condição (valor) para o serviço escolhido e move o lead para PROPOSTA. Chame quando o lead aceitar contratar. forma: avista, 2x ou tap (2x = 2x de R$ 400 e tap = entrada R$ 297 + 5x R$ 150, só no limpa_nome; diagnóstico é sempre avista). Precisa do nome completo e do CPF/CNPJ já salvos. Pagamento só PIX ou boleto. Se ok=false, siga a orientacao e NUNCA invente link.',
      operation: 'executeQuery',
      query: 'select public.link_pagamento($1::uuid, $2, $3) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('servico', 'diagnostico ou limpa_nome', 'string'), $fromAI('forma', 'avista, 2x ou tap', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [800, 560]
  }
});

const pagou = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'informar_pagamento',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Use quando o lead disser que pagou ou enviar imagem de comprovante. Avisa o financeiro para confirmar. Não pausa você: continue pedindo o documento e agendando.',
      operation: 'executeQuery',
      query: 'select public.informar_pagamento($1::uuid, $2) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('detalhe', 'O que o lead disse/enviou, ex.: comprovante PIX de R$ 67', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [960, 560]
  }
});

const horarios = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'consultar_horarios',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'OBRIGATÓRIA antes de oferecer horário de reunião: horários livres reais do especialista (horário de Aracaju). Sem data = próximos horários livres; com data (YYYY-MM-DD) = horários daquele dia. Ofereça 2 ou 3 opções usando o campo legivel e guarde o campo inicio para agendar.',
      operation: 'executeQuery',
      query: "select public.horarios_livres(nullif($1, '')::date, 6) as horarios",
      options: { queryReplacement: expr("{{ [ $fromAI('data', 'Data YYYY-MM-DD que o lead pediu, ou vazio para os próximos horários', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1120, 560]
  }
});

const agendar = tool({
  type: '@n8n/n8n-nodes-langchain.toolWorkflow',
  version: 2.2,
  config: {
    name: 'agendar_reuniao',
    parameters: {
      description: 'Agenda a reunião com o especialista no Google Meet no horário que o lead escolheu. Passe inicio EXATAMENTE como veio de consultar_horarios (ex.: 2026-11-05T10:00:00-03:00). Retorna quando e meet_link para enviar ao lead; se ok=false siga a orientacao. Para remarcar, chame de novo com o novo horário.',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'uWwhloeIoHqxdDoF', cachedResultName: 'ADV · Agendar Meet' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          conversa_id: expr("{{ $('Recebe lote do lead').item.json.conversa_id }}"),
          inicio: expr("{{ $fromAI('inicio', 'Horário ISO exato retornado por consultar_horarios', 'string') }}")
        },
        matchingColumns: [],
        schema: [
          { id: 'conversa_id', displayName: 'conversa_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'inicio', displayName: 'inicio', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      }
    },
    position: [1280, 560]
  }
});

const handoff = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'transferir_para_humano',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Para de responder nesta conversa e avisa o dono no WhatsApp para ele continuar. Depois de chamar, sua resposta final deve ser VAZIA (não escreva nada para o lead). Use quando: não sabe responder com certeza (incerteza); dúvida específica fora do roteiro (duvida_especifica); o lead pede outra pessoa (pedido_lead); reclamação ou irritação (reclamacao); o lead pergunta se fala com robô/IA (pergunta_identidade); falha ao agendar (agendamento).',
      operation: 'executeQuery',
      query: 'select public.iniciar_handoff($1::uuid, $2, $3) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('motivo', 'incerteza, duvida_especifica, pedido_lead, reclamacao, pergunta_identidade ou agendamento', 'string'), $fromAI('resumo', 'Resumo para a equipe em 1-2 frases: situação do lead, serviço e o que já foi combinado', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1440, 560]
  }
});

const avisar = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'avisar_equipe',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Avisa a equipe SEM tirar você da conversa. Use no Limpa Nome quando o pagamento e o documento estiverem ok (motivo contrato), para a equipe enviar o contrato digital. Também para qualquer informação importante que a equipe precisa saber (motivo info).',
      operation: 'executeQuery',
      query: 'select public.avisar_equipe($1::uuid, $2, $3) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('motivo', 'contrato ou info', 'string'), $fromAI('texto', 'O que a equipe precisa fazer/saber, em 1-2 frases', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1600, 560]
  }
});

const perda = tool({
  type: 'n8n-nodes-base.postgresTool',
  version: 2.6,
  config: {
    name: 'registrar_perda',
    parameters: {
      descriptionType: 'manual',
      toolDescription: 'Registra no funil que o lead perdeu o interesse (tipo perdido) ou está fora do perfil (tipo desqualificado). Use só quando ficar claro, ex.: disse que não quer mais, já resolveu com outra empresa, quer dinheiro na hora sem análise, exige garantia judicial, quer perdão da dívida.',
      operation: 'executeQuery',
      query: 'select public.marcar_perda($1::uuid, $2, $3) as resultado',
      options: { queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, $fromAI('tipo', 'perdido ou desqualificado', 'string'), $fromAI('motivo', 'Motivo curto, ex.: preco, sem_interesse, quer_dinheiro_imediato, exige_garantia, perdao_divida, ja_resolveu', 'string') ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1760, 560]
  }
});

const agente = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'SDR Advance',
    parameters: {
      promptType: 'define',
      text: expr("{{ $('Recebe lote do lead').item.json.origem === 'retomada' ? '[ATENÇÃO: a equipe humana conversou com este lead e ficou mais de 15 minutos sem responder; você está reassumindo. Leia o histórico, continue de onde pararam, não se reapresente e não contradiga o que a equipe combinou.]\\n\\n' : '' }}Lead: {{ $('Recebe lote do lead').item.json.nome || 'sem nome' }} (WhatsApp {{ $('Recebe lote do lead').item.json.telefone }})\n\nHistórico da conversa (mais antigo primeiro):\n{{ $json.historico }}\n\nMensagens novas do lead (leia todas juntas como um pedido só):\n{{ $('Recebe lote do lead').item.json.texto }}"),
      hasOutputParser: false,
      options: {
        systemMessage: expr('__PROMPT:agente-sdr__'),
        maxIterations: 10
      }
    },
    subnodes: { model: modelo, tools: [kb, ficha, pagamento, pagou, horarios, agendar, handoff, avisar, perda] },
    onError: 'continueErrorOutput',
    position: [560, 300]
  },
  output: [{ output: 'Oi, Maria! Aqui é da Advance Consultoria, tudo bem? Você quer limpar seu nome ou buscar crédito?' }]
});

const registrar = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Decidir texto/áudio e registrar',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.decidir_formato($1::boolean, $2) as formato, public.registrar_execucao($3::uuid, $4, $5, $2, public.decidir_formato($1::boolean, $2)) as reg',
      options: {
        queryReplacement: expr("{{ [ String($('Recebe lote do lead').item.json.tinha_audio) === 'true', ($json.output || '').trim(), $('Recebe lote do lead').item.json.conversa_id, $execution.id, $('Recebe lote do lead').item.json.texto ] }}")
      }
    },
    credentials: { postgres: pgCred },
    position: [880, 200]
  },
  output: [{ formato: 'texto', reg: { chegou_nova: false } }]
});

const temResposta = ifElse({
  version: 2.2,
  config: {
    name: 'Tem resposta?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [ { leftValue: expr("{{ ($('SDR Advance').item.json.output || '').trim() }}"), operator: { type: 'string', operation: 'notEmpty', singleValue: true } } ],
        combinator: 'and'
      }
    },
    position: [1120, 200]
  }
});

const enviar = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Enviar resposta',
    parameters: {
      workflowId: { __rl: true, mode: 'id', value: 'Lr0ADIxWg4ylzd7s', cachedResultName: 'ADV · WA Enviar' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          conversa_id: expr("{{ $('Recebe lote do lead').item.json.conversa_id }}"),
          texto: expr("{{ ($('SDR Advance').item.json.output || '').trim() }}"),
          formato: expr("{{ $('Decidir texto/áudio e registrar').item.json.formato }}"),
          autor: 'ia'
        },
        matchingColumns: [],
        schema: [
          { id: 'conversa_id', displayName: 'conversa_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'texto', displayName: 'texto', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'formato', displayName: 'formato', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'autor', displayName: 'autor', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
        ]
      },
      options: { waitForSubWorkflow: false }
    },
    position: [1360, 120]
  }
});

const falha = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Erro: transferir para a equipe',
    parameters: {
      operation: 'executeQuery',
      query: "select public.iniciar_handoff($1::uuid, 'erro_sistema', $2) as r, public.registrar_execucao($1::uuid, $3, $4, null, null, $2) as reg",
      options: {
        queryReplacement: expr("{{ [ $('Recebe lote do lead').item.json.conversa_id, 'Falha do agente de IA: ' + ($json.error?.message || $json.error || 'erro desconhecido') + ' | Lead escreveu: ' + $('Recebe lote do lead').item.json.texto, $execution.id, $('Recebe lote do lead').item.json.texto ] }}")
      }
    },
    credentials: { postgres: pgCred },
    position: [880, 420]
  },
  output: [{ r: { ok: true } }]
});

const note = sticky('## ADV · Agente SDR\nCérebro do SDR da Advance (OpenAI). Recebe o lote de mensagens do lead, carrega histórico + ficha do CRM e conduz o roteiro: **saudação → objetivo → qualificação (nome, urgência, LGPD, CPF/CNPJ) → apresentação → link de pagamento → documento → reunião no Meet**.\n\nFerramentas: base de conhecimento, ficha do lead, link de pagamento, pagamento informado, horários, agendar (Meet), transferir, avisar equipe, registrar perda.\n\nSe não souber responder ou se a IA falhar, ela para de responder nesta conversa (sem avisar o lead) e o dono é notificado no WhatsApp.', [entrada, contexto], { color: 6 });

export default workflow('adv-agente-sdr', 'ADV · Agente SDR')
  .add(entrada)
  .to(contexto)
  .to(agente)
  .to(registrar)
  .to(temResposta.onTrue(enviar))
  .add(agente.onError(falha))
  .add(note);
