# Advance Consultoria · SDR IA (Ampliize)

Agente SDR de IA no WhatsApp para a **Advance Consultoria de Crédito**: faz o primeiro contato com os leads do tráfego pago, qualifica, apresenta o serviço certo (Diagnóstico R$ 67 ou Limpa Nome R$ 797 / TAP), envia o link de pagamento e agenda a reunião com o especialista no **Google Meet**. Inclui um **CRM** com métricas, funil e controles de intervenção humana.

```
WhatsApp (79) 98104-5273
   │  Evolution API (webhook MESSAGES_UPSERT + base64)
   ▼
ADV · WA Entrada ──► registra no Supabase ──► escuta áudio / lê imagem ──► agrupa mensagens
   │
   ▼
ADV · Agente SDR (OpenAI + ferramentas no banco) ──► ADV · Agendar Meet (Google Calendar)
   │
   ▼
ADV · WA Enviar (texto ou áudio com voz clonada · ElevenLabs)
ADV · Rotinas (1 min): volta da IA após 15 min sem humano · follow-up 2h/24h/48h · alertas da equipe
ADV · Pagamento Confirmado (webhook do meio de pagamento) · ADV · Erros
                      ▲
                 CRM (Vercel) ── Supabase (zixsjyqmzylcopggfjvr)
```

## Links

- **CRM:** https://advance-crm-sdr.vercel.app (projeto Vercel `advance-crm-sdr`, deploy automático a partir deste repositório, pasta `crm`)
- **Fluxos n8n** (tag `advanced`): [ADV · WA Entrada](https://n8n-n8n.dgwpoe.easypanel.host/workflow/Nerz4p4GgDCR0XXI) · [ADV · Agente SDR](https://n8n-n8n.dgwpoe.easypanel.host/workflow/TNvtCkc68qPPPGbv) · [ADV · WA Enviar](https://n8n-n8n.dgwpoe.easypanel.host/workflow/Lr0ADIxWg4ylzd7s) · [ADV · Agendar Meet](https://n8n-n8n.dgwpoe.easypanel.host/workflow/uWwhloeIoHqxdDoF) · [ADV · Rotinas](https://n8n-n8n.dgwpoe.easypanel.host/workflow/7MffEsgySkgk2MV4) · [ADV · Pagamento Confirmado](https://n8n-n8n.dgwpoe.easypanel.host/workflow/8lV0ABGeaGbbkgMp) · [ADV · Erros](https://n8n-n8n.dgwpoe.easypanel.host/workflow/T2lDbAncOYpksYWK) · [ADV · WhatsApp Conexão](https://n8n-n8n.dgwpoe.easypanel.host/workflow/t47ZAgms1AAeYd9b) (publicado: o CRM gera o QR Code por ele)

## Pastas

| Pasta | O que é |
|---|---|
| `supabase/migrations` | Schema completo (tabelas, regras, funções do agente, RLS, realtime) + seed com configurações e base de conhecimento tirada do levantamento comercial |
| `supabase/tests/cenarios.sql` | Roteiro de testes das regras (eco da IA, humano, 15 min, pausa geral, qualificação, pagamento, agenda, follow-up, RLS) |
| `n8n/` | Código (Workflow SDK) dos fluxos, prompt do agente e código dos nós Code. Os fluxos já estão criados no n8n com a tag **advanced** |
| `crm/` | CRM em React + Vite (deploy na Vercel) |

## Regras implementadas

1. **Intervenção humana:** se alguém responde o lead pelo número do atendimento, a IA para **naquela conversa** e só volta **15 min depois da última mensagem do humano** (`minutos_retorno_humano`). As mensagens que o lead mandou nesse intervalo são respondidas pela IA quando ela volta. O eco das mensagens da própria IA é reconhecido e não conta como humano.
2. **Assumir atendimento (CRM):** botão por conversa. A IA fica fora até alguém clicar em **Devolver para a IA**.
3. **Emergência:** botão no topo do CRM pausa **todo** o SDR (respostas, follow-ups e retomadas) na hora. Tanto a Ampliize quanto a Advance podem pausar e reativar; fica registrado em `auditoria` e a equipe é avisada no WhatsApp.
4. **Quando a IA não sabe responder** (ou dúvida fora do roteiro, pedido de outra pessoa, reclamação, pergunta se é robô, erro do sistema): ela **para de responder sem mandar nada ao lead** e o dono recebe alerta no WhatsApp (`whatsapp_equipe`) e no CRM. Ela só volta quando um humano responder e ficar 15 min sem mensagens, ou quando alguém clicar em *Devolver para a IA*.
5. **Identidade:** o agente atende como alguém da equipe da Advance e nunca se chama de assistente virtual, robô ou IA. Se o lead perguntar com seriedade se está falando com um robô, ele não responde e passa a conversa para uma pessoa da equipe.
6. **Mídia:** áudios do lead são transcritos; imagens são lidas (RG/CNH, comprovante de pagamento, print do Serasa). A IA responde em **áudio com a voz clonada** quando o lead manda áudio (`audio_modo`), e sempre por texto quando há link, valor ou CPF.
7. **Follow-up:** 2h, 24h e 48h sem resposta (entre 08h e 20h). Depois disso o lead vai para **perdido · sem_resposta** (e é reaberto se voltar a falar).
8. **Nunca prometer** garantia judicial, prazo de juiz, perdão de dívida ou crédito imediato (prompt + base de conhecimento).

## Ativação (checklist)

1. **Banco:** rode as duas migrations no SQL Editor do projeto `zixsjyqmzylcopggfjvr` (em ordem). Crie os usuários do CRM em *Authentication → Users* com os e-mails cadastrados em `crm_usuarios` e desative o cadastro público.
2. **Credenciais no n8n** (os fluxos `ADV ·` estão despublicados):
   - `ADV Supabase Postgres` → conexão Postgres do projeto zixsjyqmzylcopggfjvr (pooler, porta 6543, SSL). **Hoje os nós Postgres foram ligados automaticamente na credencial "Postgres account"; troque para a credencial nova antes de publicar.**
   - `Evolution API · apikey` (já existe) — confirme que é o servidor onde ficará a instância da Advance.
   - `OpenAI account` (já existe).
   - `ElevenLabs (xi-api-key)`, `ADV Google Calendar` (agenda do especialista), `ADV Webhook Pagamento` (header secreto) — novas.
3. **Configurações no CRM** (*Configurações*): URL e instância da Evolution, ID da voz clonada, links de pagamento, agenda do especialista e números da equipe.
4. **Evolution:** instância do número (79) 98104-5273 com webhook `https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-wa-entrada-k7m2p9`, evento `MESSAGES_UPSERT` e **Webhook Base64** ligado.
5. Publique na ordem: `ADV · Erros` → `ADV · WA Enviar` → `ADV · Agendar Meet` → `ADV · Agente SDR` → `ADV · Rotinas` → `ADV · Pagamento Confirmado` → `ADV · WA Entrada`. Depois defina `ADV · Erros` como *Error Workflow* dos demais.
6. Meio de pagamento: aponte o webhook para `https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-pagamento-confirmado-q4w8z1` (envie `telefone` ou `lead_id` e `valor`) ou confirme manualmente no CRM.

## CRM

```bash
cd crm && npm install && npm run dev
```

Variáveis (Vercel → Settings → Environment Variables): `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Sem a chave, a tela de login pede a anon key uma vez por navegador. O botão **Ver demonstração** abre o CRM com dados fictícios.

## Testar as regras do banco

```bash
psql "$DATABASE_URL_DE_TESTE" -f supabase/migrations/20261104000100_advance_sdr_schema.sql \
  -f supabase/migrations/20261104000200_advance_seed.sql -f supabase/tests/cenarios.sql
```
(use um banco de teste: o roteiro cria leads fictícios)

## Financeiro do Limpa Nome (Asaas + split)

**Modalidades** (só PIX ou boleto): à vista R$ 597 · 2x de R$ 400 · TAP: entrada R$ 297 + 5x R$ 150 (R$ 1.047). Diagnóstico R$ 67 (sem split).

**Split:** 12,5% para cada beneficiário (Davy e Caio) sobre o **valor bruto** de cada pagamento do Limpa Nome. O Asaas calcula percentual sobre o valor líquido, por isso o split vai como **valor fixo** (`fixedValue` = 12,5% do valor da cobrança; o último beneficiário fecha os centavos: R$ 297 → 37,13 + 37,12). A tarifa do Asaas fica na conta que emite. O Asaas só repassa quando o cliente paga e estorna o split junto quando a cobrança é estornada.

**Fluxo:**
1. A IA (ou o CRM em *Novo contrato*) chama `iniciar_contratacao` → cria o contrato e uma cobrança por pagamento. A 1ª fica `a_gerar`; as demais `planejada`.
2. `ADV · Asaas` cria o cliente (busca pelo CPF antes), confere se a cobrança já existe (`externalReference` = id da cobrança) e cria com split. Se falhar, a rotina tenta de novo e manda o link ao cliente no WhatsApp.
3. Webhook do Asaas → `asaas_registrar_evento`: grava o evento pelo `id` (repetido não processa de novo) e aplica a regra: pago (ativa o contrato, agenda as parcelas mês a mês, avisa a IA), vencido (inadimplente), estorno, split liquidado.
4. A rotina cria cada parcela no Asaas 10 dias antes do vencimento. As Rotinas mandam lembrete (3 dias antes e no dia), aviso de atraso (1 e 5 dias depois) e o andamento do processo.
5. Quitação antecipada (CRM): soma o saldo em aberto, desconto só por administrador e com motivo, cancela as cobranças em aberto no Asaas e gera uma cobrança de quitação com split de 25% sobre o valor dela. O contrato só fica quitado quando o Asaas confirma.

**Workflows:** `ADV · Asaas` (vSXROKXHWOPll0fl), `ADV · Contratar` (5i8G5K4B4k7LyuBB, ferramenta da IA). Notificações em `ADV · Rotinas`.

**Ativar (sandbox primeiro):**
1. Asaas → Integrações → Segurança → **Habilitar Split** (bloqueado por padrão em contas novas).
2. n8n → credencial Header Auth **ADV Asaas API** (`access_token` = chave da API) e **ADV Webhook Asaas** (`asaas-access-token` = token do webhook).
3. Asaas → Webhooks → URL `https://n8n-n8n.dgwpoe.easypanel.host/webhook/adv-asaas-eventos-r7t4k2`, mesmo token, eventos listados em Configurações do CRM.
4. CRM → Configurações → Financeiro: walletId de cada beneficiário, ambiente Sandbox, ligar o Asaas.
5. Ligar as credenciais nos nós do `ADV · Asaas`, publicar `ADV · Asaas` e `ADV · Contratar`, e trocar a ferramenta `gerar_link_pagamento` do agente para chamar o `ADV · Contratar`.

**Testes:** `psql -f supabase/tests/financeiro.sql` (15 cenários: split, modalidades, idempotência do webhook, parcelas, inadimplência, quitação com desconto, estorno, notificações, links fixos sem Asaas).
