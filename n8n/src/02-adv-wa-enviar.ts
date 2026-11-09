import { workflow, node, trigger, sticky, newCredential, ifElse, switchCase, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const pgCred = newCredential('ADV Supabase Postgres');
const evoCred = { id: 'dDVBNHyFclkWF748', name: 'Evolution API · apikey' };
const elevenCred = newCredential('ElevenLabs (xi-api-key)');

const entrada = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Recebe resposta para enviar',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: { values: [ { name: 'conversa_id' }, { name: 'texto' }, { name: 'formato' }, { name: 'autor' }, { name: 'lote_id' } ] }
    },
    position: [0, 300]
  },
  output: [{ conversa_id: 'uuid', texto: 'Olá!\n\nTudo bem?', formato: 'texto', autor: 'ia' }]
});

const blocos = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Quebrar em até 3 mensagens',
    parameters: {
      jsCode: '__CODE:enviar-blocos__'
    },
    position: [240, 300]
  },
  output: [{ conversa_id: 'uuid', autor: 'ia', formato: 'texto', bloco: 'Olá!', falado: null, delay_ms: 1500 }]
});

const loop = splitInBatches({ version: 3, config: { name: 'Um bloco por vez', parameters: { batchSize: 1, options: {} }, position: [480, 300] } });

const preparar = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Checar regras e registrar envio',
    parameters: {
      operation: 'executeQuery',
      query: "select public.preparar_envio($1::uuid, $2, $3, $4, nullif($5, '')::bigint) as v",
      options: {
        queryReplacement: expr("{{ [ $json.conversa_id, $json.formato === 'audio' ? 'audio' : 'text', $json.bloco, $json.autor, String($json.lote_id || '') ] }}")
      }
    },
    credentials: { postgres: pgCred },
    position: [720, 300]
  },
  output: [{ v: { permitido: true, mensagem_id: 10, telefone: '5579999999999', aguardar_ms: 0, base_url: 'https://evo', instancia: 'advance', voz_id: 'abc', voz_modelo: 'eleven_multilingual_v2' } }]
});

const permitido = ifElse({
  version: 2.2,
  config: {
    name: 'Pode enviar agora?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [ { leftValue: expr('{{ $json.v.permitido }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } } ],
        combinator: 'and'
      }
    },
    position: [960, 300]
  }
});

const intervalo = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Intervalo entre mensagens',
    parameters: { resume: 'timeInterval', amount: expr('{{ Math.max(0.3, ($json.v.aguardar_ms || 0) / 1000) }}'), unit: 'seconds' },
    position: [1200, 200]
  },
  output: [{ v: { permitido: true } }]
});

const formato = switchCase({
  version: 3.2,
  config: {
    name: 'Texto ou áudio?',
    parameters: {
      rules: {
        values: [
          { outputKey: 'audio', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [ { leftValue: expr("{{ $('Um bloco por vez').item.json.formato }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'audio' } ], combinator: 'and' } }
        ]
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'texto' }
    },
    position: [1440, 200]
  }
});

const tts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Gerar áudio com a voz clonada (ElevenLabs)',
    parameters: {
      method: 'POST',
      url: expr("https://api.elevenlabs.io/v1/text-to-speech/{{ $('Checar regras e registrar envio').item.json.v.voz_id }}?output_format=mp3_44100_128"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpTemplatedCustomAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ text: $('Um bloco por vez').item.json.falado, model_id: $('Checar regras e registrar envio').item.json.v.voz_modelo, voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true } }) }}"),
      options: { response: { response: { responseFormat: 'file', outputPropertyName: 'audio' } }, timeout: 45000 }
    },
    credentials: { httpTemplatedCustomAuth: elevenCred },
    onError: 'continueErrorOutput',
    position: [1680, 100]
  },
  output: [{}]
});

const audioB64 = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Áudio para base64',
    parameters: { operation: 'binaryToPropery', binaryPropertyName: 'audio', destinationKey: 'audio_b64' },
    position: [1920, 40]
  },
  output: [{ audio_b64: 'SUQzBAAAAAAA' }]
});

const enviarAudio = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Enviar áudio (Evolution)',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Checar regras e registrar envio').item.json.v.base_url }}/message/sendWhatsAppAudio/{{ $('Checar regras e registrar envio').item.json.v.instancia }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ number: $('Checar regras e registrar envio').item.json.v.telefone, audio: $json.audio_b64, delay: $('Um bloco por vez').item.json.delay_ms, encoding: true }) }}"),
      options: { timeout: 60000 }
    },
    credentials: { httpHeaderAuth: evoCred },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    position: [2160, 40]
  },
  output: [{ key: { id: 'WAID123' } }]
});

const virarTexto = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Áudio falhou: enviar como texto',
    parameters: {
      operation: 'executeQuery',
      query: "update public.mensagens set tipo = 'text' where id = $1::bigint returning id",
      options: { queryReplacement: expr("{{ [ $('Checar regras e registrar envio').item.json.v.mensagem_id ] }}") }
    },
    credentials: { postgres: pgCred },
    position: [1920, 220]
  },
  output: [{ id: 10 }]
});

const enviarTexto = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Enviar texto (Evolution)',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Checar regras e registrar envio').item.json.v.base_url }}/message/sendText/{{ $('Checar regras e registrar envio').item.json.v.instancia }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ number: $('Checar regras e registrar envio').item.json.v.telefone, text: $('Um bloco por vez').item.json.bloco, delay: $('Um bloco por vez').item.json.delay_ms }) }}"),
      options: { timeout: 30000 }
    },
    credentials: { httpHeaderAuth: evoCred },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    position: [2160, 300]
  },
  output: [{ key: { id: 'WAID123' } }]
});

const confirmar = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar resultado do envio',
    parameters: {
      operation: 'executeQuery',
      query: 'select public.confirmar_envio($1::bigint, $2, $3::boolean) as ok',
      options: {
        queryReplacement: expr("{{ [ $('Checar regras e registrar envio').item.json.v.mensagem_id, $json.key?.id || '', String(!!$json.key?.id) ] }}")
      }
    },
    credentials: { postgres: pgCred },
    position: [2400, 200]
  },
  output: [{ ok: '' }]
});

const note = sticky(
  '## ADV · WA Enviar\nÚnico ponto de envio do SDR. Quebra a resposta em até 3 mensagens, **checa no banco** se pode enviar (pausa geral, humano na conversa), respeita o intervalo, mostra "digitando…/gravando…" e registra cada envio (é assim que o eco da IA não é confundido com um humano).\n\n**Áudio:** quando o formato é `audio`, gera a fala com a **voz clonada** no ElevenLabs (`elevenlabs_voice_id` no CRM). Se o ElevenLabs falhar, envia como texto.\n\nCredenciais: **ADV Supabase Postgres**, **Evolution API · apikey** (header `apikey`), **ElevenLabs (xi-api-key)** (template `{"headers":{"xi-api-key":"{{api_key}}"}}`).',
  [entrada, blocos, loop, preparar], { color: 5 }
);

export default workflow('adv-wa-enviar', 'ADV · WA Enviar')
  .add(entrada)
  .to(blocos)
  .to(loop.onEachBatch(
    preparar.to(permitido
      .onTrue(intervalo.to(formato
        .onCase(0, tts.to(audioB64.to(enviarAudio.to(confirmar.to(nextBatch(loop))))))
        .onCase(1, enviarTexto.to(confirmar))))
      .onFalse(nextBatch(loop)))
  ))
  .add(tts.onError(virarTexto.to(enviarTexto)))
  .add(note);
