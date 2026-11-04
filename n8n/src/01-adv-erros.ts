import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const pgCred = newCredential('ADV Supabase Postgres');

const onError = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'Falha em fluxo ADV', position: [0, 300] },
  output: [{ execution: { id: '1', url: 'https://n8n/x', error: { message: 'Erro X' }, lastNodeExecuted: 'Nó' }, workflow: { id: 'w', name: 'ADV · WA Entrada' } }]
});

const saveAlert = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar alerta de erro',
    parameters: {
      operation: 'executeQuery',
      query: "insert into public.alertas (tipo, mensagem) values ('erro', $1) returning id",
      options: {
        queryReplacement: expr("{{ [ 'Falha no fluxo ' + ($json.workflow?.name || '?') + ' (nó: ' + ($json.execution?.lastNodeExecuted || '?') + '): ' + ($json.execution?.error?.message || 'erro desconhecido') + ' · ' + ($json.execution?.url || '') ] }}")
      }
    },
    credentials: { postgres: pgCred },
    position: [260, 300]
  },
  output: [{ id: 1 }]
});

const note = sticky('## ADV · Erros\nError Workflow dos fluxos **advanced**. Toda falha vira um alerta `erro` no CRM e é enviada ao WhatsApp da equipe pelo **ADV · Rotinas**.', [onError, saveAlert], { color: 3 });

export default workflow('adv-erros', 'ADV · Erros')
  .add(onError)
  .to(saveAlert)
  .add(note);
