# Auditoria da operação comercial · Advance Consultoria

**Data:** 12/11/2026 · **Feita por:** Ampliize
**Base:** os 11 fluxos do n8n, o prompt do agente, o código do CRM e os números reais do banco (consulta só de leitura, sem nomes nem telefones), de 04/11 a 11/11.

---

## 1. Resumo

A operação funciona: a IA responde em ~22 segundos (mediana), não teve nenhum erro de execução em 294 respostas e os pagamentos pelo Asaas entram e confirmam sozinhos. Os problemas estão em quatro pontos:

1. **A IA transfere demais.** 9 das 14 transferências foram "dúvida específica" para perguntas que ela sabia responder ("explique melhor", "é por ação judicial?", "remove do cartório?").
2. **O CRM não mostra o funil real.** 95 de 104 leads estão com serviço "a definir" e 89 parados em "Em atendimento", porque a IA só salvava o serviço na hora de fechar.
3. **Conversas assumidas ficam esquecidas.** 37 das 42 conversas assumidas pela equipe estão sem resposta humana há mais de 24 horas, e a IA não volta nelas.
4. **Vendas fechadas fora do sistema não aparecem.** Pagamentos feitos por links criados direto no Asaas não ficam ligados a nenhum lead.

O que pedido nesta rodada foi entregue e está no ar: **botão Gerar cobrança na conversa** (produtos e cobrança personalizada) e **split e custo por produto** nas Configurações (Limpa Nome, Combo e Rating).

---

## 2. Números da operação (04/11 a 11/11)

| Indicador | Valor |
|---|---|
| Leads recebidos | 104 (54 tráfego pago, 50 Meta Ads) |
| Conversas com IA ativa | 58 |
| Conversas assumidas pela equipe | 45 (32 iniciadas pela equipe) |
| Mensagens | 461 de leads · 570 da IA · 267 da equipe |
| 1ª resposta da IA | mediana 22 s · 90% em até 30 s |
| Execuções do agente | 294, **0 com erro**, 21 respostas vazias (transferência ou conversa encerrada) |
| Transferências para humano | 14 (9 dúvida específica, 2 pedido do lead, 2 incerteza, 1 agendamento) |
| Leads qualificados | 4 · em proposta: 4 · perdidos: 4 · desqualificados: 3 |
| Contratos | 4 (Limpa Nome: 3 TAP, 1 2x), todos aguardando o 1º pagamento |
| Cobranças em aberto | 3 (2 vencidas, 1 pendente) |
| Leads com serviço "a definir" | 95 de 104 |
| Leads sem nome completo | 96 de 104 |

---

## 3. Mapa dos 11 fluxos

| Fluxo | Função | Gatilho | Situação |
|---|---|---|---|
| ADV · WA Entrada | Recebe mensagens do WhatsApp, transcreve áudio, lê imagem, agrupa e chama o agente | Webhook da Evolution | Ativo, sem falhas |
| ADV · Agente SDR | Cérebro da IA: conversa, qualifica, apresenta, gera link, transfere | Chamado pela Entrada e pelas Rotinas | Ativo, 0 erros |
| ADV · WA Enviar | Único ponto de envio: quebra em mensagens, digitando, regras de pausa e de humano | Chamado pelos outros | Ativo (correções de 09/11: valores cortados e respostas duplicadas) |
| ADV · Contratar | Ferramenta da IA para criar contrato e pedir o link | Chamado pelo agente | **Falhou em 11/11 com data vazia. Corrigido.** |
| ADV · Asaas | Cria cobrança com split, recebe o webhook, sincroniza a cada minuto | Webhook + agenda | Ativo |
| ADV · Rotinas | Devolve conversas à IA, follow-up, alertas à equipe, avisos aos clientes | A cada minuto | Ativo (follow-up **desligado pela equipe** em 11/11 16:45) |
| ADV · CRM Enviar | A equipe responde o lead pelo CRM | Webhook do CRM | Ativo |
| ADV · WhatsApp Conexão | QR Code e status do WhatsApp pelo CRM | Webhook do CRM | Ativo |
| ADV · Erros | Toda falha vira alerta no CRM e no WhatsApp da equipe | Erro de qualquer fluxo | Ativo |
| ADV · Pagamento Confirmado | Webhook de pagamento antigo (antes do Asaas) | — | **Desligado** (substituído pelo ADV · Asaas). Pode ser arquivado. |
| ADV · Agendar Meet | Agenda reunião no Google Meet | Ferramenta do agente | **Desligado.** A ferramenta continua no agente: se a IA tentar agendar, falha. Ver item 5.4. |

**Respostas aos 10 pontos críticos do plano:**

1. *Os fluxos compartilham o contexto?* Sim. Tudo passa pelo banco (ficha, histórico, conversa), não há contexto preso em um fluxo só.
2. *Agentes com funções parecidas?* Não. Há um agente só; os outros fluxos são ferramentas dele.
3. *Repetem perguntas?* Corrigido em 08 e 09/11 (reapresentação, urgência, CPF). Restava a repetição de mensagens, corrigida em 09/11.
4. *O CRM recebe tudo do n8n?* Sim, o n8n grava direto no banco do CRM. Mas a IA salvava pouco da ficha (ver 4.2).
5. *O funil atualiza certo?* As mudanças de etapa são registradas (0 divergências entre etapa e histórico). O problema é a IA não salvar o serviço cedo.
6. *Pagamentos identificados?* Os do sistema, sim. Os de links criados direto no Asaas, não (ver 4.4).
7. *Transferências preservam contexto?* Sim: o alerta leva um resumo e a conversa inteira fica no CRM.
8. *Motivos de perda reais?* Parcialmente: 2 dos 7 estão "sem motivo" e 1 com texto livre ("ja fechou"). Ver 5.3.
9. *Dashboard confiável?* Os números saem do banco, mas "conversão por serviço" fica distorcida enquanto 95 leads estão "a definir".
10. *Oportunidades sem acompanhamento?* Sim: 37 conversas assumidas paradas e cobranças vencidas sem aviso (ver 4.3 e 4.5).

---

## 4. Falhas encontradas

### 4.1 A IA transferia o que sabia responder · **Corrigido**
Das 14 transferências, 9 foram "dúvida específica" para perguntas já respondidas no prompt e na base: "explique melhor", "não entendi", "o Combo é por ação judicial?", "remove do cartório?", "limpa CNPJ?". Cada uma deixa o lead esperando a equipe.
**Correção:** o prompt agora lista esses casos e manda explicar de novo com palavras mais simples. A transferência fica para dúvida jurídica real, reclamação, pedido de pessoa e pergunta sobre robô.

### 4.2 Funil mostra "a definir" para quase todos · **Corrigido (daqui pra frente)**
95 de 104 leads com serviço "a definir". A IA só salvava o serviço ao gerar o link.
**Correção:** o prompt manda salvar serviço, objetivo, urgência e um resumo assim que a pessoa diz o que quer, mesmo sem nome e CPF. Os leads antigos não mudam sozinhos.

### 4.3 Conversas assumidas ficam esquecidas · **Precisa de decisão**
42 conversas estão "assumidas" pela equipe; 37 sem resposta humana há mais de 24 h e 29 há mais de 48 h. A IA não volta enquanto estiver assumida (regra pedida pela equipe para não atrapalhar a negociação). Desses, 6 leads mandaram a última mensagem há mais de 1 hora e ninguém respondeu.
**Proposta:** depois de X horas sem resposta da equipe numa conversa assumida, (a) alertar a equipe no WhatsApp, ou (b) devolver para a IA. Preciso que vocês escolham a regra e o prazo.

### 4.4 Pagamentos fora do sistema · **Resolvido para vendas novas**
O Asaas avisou 15 recebimentos (R$ 2.832,38) que o CRM ignorou porque não vieram de cobranças do sistema. A maioria (12) são "Recarga de saldo" da própria conta, não são vendas. Três parecem vendas manuais: R$ 67,00 e R$ 150,00 (07/11) e R$ 244,50 (10/11). Essas vendas não têm split, não têm comissão registrada e não aparecem no funil.
**Correção:** o botão **Gerar cobrança** no CRM substitui o Asaas manual: o link sai pela mesma API, com split e ligado ao lead. As 3 vendas antigas precisam ser lançadas à mão se quiserem no relatório.

### 4.5 Lead que não paga o 1º link não recebe lembrete · **Corrigido (opcional)**
Os lembretes só iam para quem já tinha pago a 1ª parcela. Hoje há 2 links vencidos (R$ 400 e R$ 297) sem nenhum aviso.
**Correção:** nova opção em Configurações · Avisos aos clientes, "Lead que recebeu o link e não pagou". Avisa no dia do vencimento e nos dias de atraso configurados. **Está desligada**; liguem quando quiserem.

### 4.6 Contratação falhava com data vazia · **Corrigido**
Em 11/11 às 18:39 o ADV · Contratar parou com erro "invalid input syntax for type date" quando a IA mandou o vencimento vazio de um jeito inesperado. O lead ficou sem link.
**Correção:** qualquer data inválida agora vira "vencimento padrão em 2 dias"; o prompt também pede a data sempre no formato certo.

### 4.7 4 follow-ups não foram entregues · **Observação**
Em 11/11 entre 14:23 e 15:34, 4 lembretes de follow-up voltaram como "falhou" na Evolution. Foi pontual (WhatsApp/Evolution), não se repetiu, e o follow-up foi desligado pela equipe às 16:45.

### 4.8 Split só aparecia para o Limpa Nome · **Corrigido**
A tela mostrava só o custo de R$ 197 e exemplos do Limpa Nome. O banco já cobrava certo (Combo R$ 197 de custo, Rating R$ 150, todos com 25% de comissão), mas não dava para ver nem mudar pelo CRM.
**Correção:** ver item 6.2.

---

## 5. Recomendações (por impacto e esforço)

| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 5.1 | Regra para conversas assumidas paradas (4.3) | Alto | Baixo, após decisão |
| 5.2 | Ligar o aviso do 1º link vencido (4.5) | Alto | Nenhum (só ligar) |
| 5.3 | Motivos de perda em lista fixa no CRM (sem texto livre) | Médio | Baixo |
| 5.4 | Decidir sobre o Agendar Meet: ligar com Cal.com ou tirar a ferramenta do agente | Médio | Médio |
| 5.5 | Reativar o follow-up com regra de 1 lembrete a cada 20 h (já pronta) | Médio | Nenhum |
| 5.6 | Arquivar o fluxo antigo ADV · Pagamento Confirmado | Baixo | Nenhum |
| 5.7 | Revisar daqui a 7 dias: % de leads com serviço definido e nº de transferências | Médio | Baixo |

---

## 6. O que foi entregue nesta rodada

### 6.1 Gerar cobrança na conversa
Na aba **Conversas**, botão **Gerar cobrança** no topo da conversa:
- **Dados do cliente:** nome completo, CPF/CNPJ (com validação), e-mail e endereço. Vêm preenchidos da ficha e o que for digitado atualiza a ficha.
- **Nossos produtos:** Limpa Nome, Limpa Nome + Rating, Rating e Diagnóstico, com as formas (à vista, 2x, TAP) e os valores da tabela. Segue exatamente a mesma regra da IA: parcelas, "2ª só com o nome limpo", custo e comissão do produto.
- **Cobrança personalizada:** descrição livre (ex.: "Limpa Nome CPF + CNPJ + Rating"), valor agora, até 12 parcelas depois (mensais ou só depois da entrega), custo opcional e com ou sem comissão.
- Vencimento do 1º pagamento e opção de **mandar o link no WhatsApp do cliente** ou só copiar.
- O link sai pela **API do Asaas** com o split; aparece na tela para copiar, com botão "Enviar na conversa".
- O lead vai para "Proposta", o contrato aparece em **Clientes** (nova aba "Personalizadas") e, quando paga, vira "Pago" e registra as comissões.
- Tudo fica registrado em auditoria (quem gerou, valores, data).

### 6.2 Split e custo por produto
Em **Configurações · Split e comissões**:
- Quem recebe e o percentual (como antes).
- **Produtos:** custo por contrato e se paga comissão, separado para Limpa Nome (R$ 197), Combo (R$ 197) e Rating (R$ 150).
- **Como fica na prática:** escolhe o produto e vê, para cada forma de pagamento, quanto sai de custo, de comissão e quanto fica com a Advance.
- Mudanças valem para contratos novos; os antigos mantêm o que foi combinado.

### 6.3 Onde está cada mudança
- Banco: migração `20261111000100_cobranca_crm_split_produto.sql` (aplicada em 12/11; não alterou nenhum contrato ou cobrança existente).
- Testes: `supabase/tests/cobranca_crm.sql` (11 cenários) + testes financeiros e de duplicidade, todos passando.
- n8n: ADV · Contratar e prompt do ADV · Agente SDR publicados.
- CRM: publicado na Vercel.
