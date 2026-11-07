-- =====================================================================
-- ADVANCE · FINANCEIRO DO LIMPA NOME (Asaas + split + notificações)
--
-- Modalidades do Limpa Nome (só PIX ou boleto):
--   à vista R$ 597 · 2x de R$ 400 (R$ 800) · TAP: entrada R$ 297 + 5x R$ 150 (R$ 1.047)
-- Split (só Limpa Nome): 12,5% para cada beneficiário configurado, sobre o
-- valor BRUTO de cada pagamento recebido. Como o Asaas calcula percentual
-- sobre o valor líquido (netValue), o split é enviado como valor fixo
-- (fixedValue) = 12,5% do valor da cobrança; a tarifa do Asaas fica na
-- conta que emite a cobrança.
--
-- Fluxo: contrato → cobranças (uma por pagamento) → Asaas cria a cobrança
-- com split → webhook (idempotente pelo id do evento) atualiza status,
-- comissões e contrato → Rotinas mandam lembretes/avisos no WhatsApp.
-- Nada é marcado como pago sem o evento do Asaas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CONFIGURAÇÃO
-- ---------------------------------------------------------------------
insert into public.config (chave, valor, descricao) values
  ('asaas_ativo',            'false', 'Gera as cobranças pelo Asaas (false = usa os links fixos de pagamento)'),
  ('asaas_base_url',         '"https://api-sandbox.asaas.com/v3"', 'API do Asaas: https://api-sandbox.asaas.com/v3 (testes) ou https://api.asaas.com/v3 (produção)'),
  ('asaas_forma_cobranca',   '"BOLETO"', 'Tipo da cobrança no Asaas: BOLETO, PIX ou UNDEFINED (o cliente escolhe)'),
  ('asaas_dias_vencimento',  '2', 'Dias até o vencimento da primeira cobrança e da quitação'),
  ('asaas_gerar_dias_antes', '10', 'Quantos dias antes do vencimento cada parcela é criada no Asaas'),
  ('asaas_notificar_pelo_asaas', 'false', 'true = o Asaas também envia e-mail/SMS das cobranças ao cliente'),
  ('split_beneficiarios',    '[{"nome":"Davy","walletId":"","percentual":12.5},{"nome":"Caio","walletId":"","percentual":12.5}]',
                             'Quem recebe o split do Limpa Nome (walletId da conta Asaas de cada um e % sobre o valor bruto)'),
  ('split_servicos',         '["limpa_nome"]', 'Serviços que têm split'),
  ('split_obrigatorio',      'true', 'Não gera cobrança de serviço com split se faltar o walletId de algum beneficiário'),
  ('planos_limpa_nome',      '{"avista":{"nome":"À vista","parcelas":[597]},"2x":{"nome":"2x de R$ 400","parcelas":[400,400]},"tap":{"nome":"TAP: entrada + 5x","parcelas":[297,150,150,150,150,150]}}',
                             'Modalidades do Limpa Nome (valores de cada pagamento, o 1º é cobrado na contratação e os demais mês a mês)'),
  ('valor_diagnostico',      '67', 'Valor do Diagnóstico de crédito'),
  ('link_pagamento_limpa_nome_2x', '""', 'Link de pagamento do Limpa Nome em 2x (1ª de R$ 400) — usado só sem o Asaas'),
  ('notif_janela',           '{"inicio":"08:00","fim":"20:00"}', 'Horário para enviar notificações aos clientes'),
  ('notif_lembrete_dias',    '[3, 0]', 'Lembrete de parcela: quantos dias antes do vencimento (0 = no dia)'),
  ('notif_vencida_dias',     '[1, 5]', 'Aviso de parcela vencida: quantos dias depois do vencimento'),
  ('notif_textos',           '{
     "lembrete": "Oi, {nome}! Passando pra lembrar que a {parcela} do seu Limpa Nome, de {valor}, vence em {vencimento}. Dá pra pagar por PIX ou boleto neste link: {link}",
     "lembrete_hoje": "Oi, {nome}! A {parcela} do seu Limpa Nome, de {valor}, vence hoje. Segue o link pra pagar por PIX ou boleto: {link}",
     "vencida": "{nome}, ainda não identificamos o pagamento da {parcela} do seu Limpa Nome, de {valor}, que venceu em {vencimento}. Se já pagou, pode desconsiderar. Pra regularizar: {link}",
     "link": "{nome}, aqui está o seu link de pagamento ({parcela}, {valor}) por PIX ou boleto: {link}",
     "quitacao": "{nome}, conforme combinado, segue o link para quitar o saldo do seu Limpa Nome, de {valor}, por PIX ou boleto: {link}"
   }', 'Textos das notificações ({nome}, {parcela}, {valor}, {vencimento}, {link})'),
  ('processo_etapas',        '[
     {"id":"contrato_assinado","nome":"Contrato assinado","texto":"{nome}, recebemos seu contrato assinado. Agora nossa equipe vai preparar a sua ação. Qualquer novidade a gente te avisa por aqui."},
     {"id":"protocolado","nome":"Ação protocolada","texto":"{nome}, sua ação foi protocolada na justiça. {detalhe} A gente acompanha e te avisa a cada novidade."},
     {"id":"em_andamento","nome":"Em andamento","texto":"{nome}, seu processo segue em andamento. {detalhe} Assim que tiver novidade, te aviso por aqui."},
     {"id":"baixa","nome":"Restrições baixadas","texto":"{nome}, boa notícia! As restrições apontadas na ação foram baixadas. {detalhe}"},
     {"id":"concluido","nome":"Processo concluído","texto":"{nome}, seu processo do Limpa Nome foi concluído. {detalhe} Obrigado pela confiança na Advance!"}
   ]', 'Etapas do processo do Limpa Nome e a mensagem enviada ao cliente ({nome}, {detalhe})')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- LEADS: cliente no Asaas e novas formas de pagamento
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists asaas_customer_id text;
alter table public.leads drop constraint if exists leads_forma_pagamento_check;
alter table public.leads add constraint leads_forma_pagamento_check
  check (forma_pagamento in ('avista','2x','tap'));

-- ---------------------------------------------------------------------
-- CONTRATOS · COBRANÇAS · COMISSÕES · EVENTOS DO ASAAS · NOTIFICAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.contratos (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references public.leads(id) on delete cascade,
  servico                text not null check (servico in ('diagnostico','limpa_nome')),
  modalidade             text not null check (modalidade in ('avista','2x','tap')),
  valor_total            numeric(10,2) not null,
  status                 text not null default 'aguardando_pagamento'
                         check (status in ('aguardando_pagamento','ativo','inadimplente','quitado','cancelado','estornado')),
  processo_etapa         text,
  processo_detalhe       text,
  processo_atualizado_em timestamptz,
  aderido_em             timestamptz,      -- 1º pagamento confirmado
  quitado_em             timestamptz,
  desconto_quitacao      numeric(10,2),
  criado_por             text not null default 'ia',
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index if not exists contratos_lead_idx on public.contratos (lead_id);
create unique index if not exists contratos_aberto_uq on public.contratos (lead_id, servico)
  where status in ('aguardando_pagamento','ativo','inadimplente');

create table if not exists public.cobrancas (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid not null references public.contratos(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  numero           int not null,
  tipo             text not null check (tipo in ('avista','adesao','parcela','quitacao','unica')),
  valor            numeric(10,2) not null,
  vencimento       date,
  status           text not null default 'planejada'
                   check (status in ('planejada','a_gerar','gerando','pendente','vencida','confirmada','recebida',
                                     'estornada','a_cancelar','cancelada')),
  motivo_cancelamento text,
  asaas_payment_id text unique,
  invoice_url      text,
  bank_slip_url    text,
  forma_paga       text,
  valor_pago       numeric(10,2),
  valor_liquido    numeric(10,2),
  valor_estornado  numeric(10,2),
  pago_em          timestamptz,
  split            jsonb not null default '[]'::jsonb,   -- split enviado ao Asaas
  tentativas       int not null default 0,
  erro             text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (contrato_id, numero)
);
create index if not exists cobrancas_status_idx on public.cobrancas (status, vencimento);
create index if not exists cobrancas_lead_idx on public.cobrancas (lead_id);

create table if not exists public.comissoes (
  id             bigserial primary key,
  cobranca_id    uuid not null references public.cobrancas(id) on delete cascade,
  contrato_id    uuid not null references public.contratos(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  beneficiario   text not null,
  wallet_id      text,
  base           numeric(10,2) not null,   -- valor bruto da cobrança
  percentual     numeric(7,4),
  valor          numeric(10,2) not null,
  status         text not null default 'prevista'
                 check (status in ('prevista','a_liquidar','liquidada','estornada','cancelada')),
  asaas_split_id text,
  liquidada_em   timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (cobranca_id, beneficiario)
);
create index if not exists comissoes_status_idx on public.comissoes (beneficiario, status);

create table if not exists public.asaas_eventos (
  id            text primary key,           -- id do evento no Asaas (evt_...): garante idempotência
  evento        text not null,
  payment_id    text,
  payload       jsonb not null,
  status        text not null default 'pendente' check (status in ('pendente','processado','ignorado','erro')),
  resultado     jsonb,
  tentativas    int not null default 0,
  recebido_em   timestamptz not null default now(),
  processado_em timestamptz
);
create index if not exists asaas_eventos_payment_idx on public.asaas_eventos (payment_id);
create index if not exists asaas_eventos_pend_idx on public.asaas_eventos (recebido_em) where status in ('pendente','erro');

create table if not exists public.notificacoes (
  id            bigserial primary key,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  contrato_id   uuid references public.contratos(id) on delete cascade,
  cobranca_id   uuid references public.cobrancas(id) on delete cascade,
  tipo          text not null check (tipo in ('link_pagamento','lembrete','vencida','andamento','quitacao','manual')),
  chave         text unique,                 -- evita mandar o mesmo aviso duas vezes
  texto         text not null,
  status        text not null default 'pendente' check (status in ('pendente','enviada','cancelada')),
  agendada_para timestamptz not null default now(),
  enviada_em    timestamptz,
  criado_por    text not null default 'sistema',
  criado_em     timestamptz not null default now()
);
create index if not exists notificacoes_pend_idx on public.notificacoes (agendada_para) where status = 'pendente';
create index if not exists notificacoes_lead_idx on public.notificacoes (lead_id, criado_em desc);

create or replace function public.tg_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists contratos_atualizado on public.contratos;
create trigger contratos_atualizado before update on public.contratos for each row execute function public.tg_atualizado_em();
drop trigger if exists cobrancas_atualizado on public.cobrancas;
create trigger cobrancas_atualizado before update on public.cobrancas for each row execute function public.tg_atualizado_em();
drop trigger if exists comissoes_atualizado on public.comissoes;
create trigger comissoes_atualizado before update on public.comissoes for each row execute function public.tg_atualizado_em();

-- ---------------------------------------------------------------------
-- AJUDANTES
-- ---------------------------------------------------------------------
create or replace function public.hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Maceio')::date
$$;

create or replace function public.brl(v numeric) returns text language sql immutable as $$
  select 'R$ ' || translate(to_char(coalesce(v,0), 'FM999,999,990.00'), ',.', '.,')
$$;

-- valores de cada pagamento da modalidade
create or replace function public.plano_parcelas(p_servico text, p_modalidade text)
returns numeric[] language sql stable as $$
  select case
    when p_servico = 'diagnostico' then array[coalesce((public.cfg_txt('valor_diagnostico'))::numeric, 67)]
    else array(select jsonb_array_elements_text(public.cfg('planos_limpa_nome') -> p_modalidade -> 'parcelas')::numeric)
  end
$$;

-- normaliza o que a IA ou o CRM mandar como modalidade
create or replace function public.normalizar_modalidade(p_servico text, p_modalidade text)
returns text language sql immutable as $$
  select case
    when p_servico = 'diagnostico' then 'avista'
    when lower(coalesce(p_modalidade,'')) ~ '(tap|entrada|5x|cinco)' then 'tap'
    when lower(coalesce(p_modalidade,'')) ~ '(2x|duas|2 vezes|dois)' then '2x'
    when lower(coalesce(p_modalidade,'')) ~ '(vista|unico|único|avista)' then 'avista'
    else null end
$$;

create or replace function public.condicao_texto(p_servico text, p_modalidade text)
returns text language sql stable as $$
  select case
    when p_servico = 'diagnostico' then public.brl((public.plano_parcelas('diagnostico','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = 'avista' then public.brl((public.plano_parcelas('limpa_nome','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = '2x' then '2x de ' || public.brl((public.plano_parcelas('limpa_nome','2x'))[1])
                                  || ', a 1ª agora e a 2ª em 30 dias (PIX ou boleto)'
    else 'Entrada de ' || public.brl((public.plano_parcelas('limpa_nome','tap'))[1]) || ' + '
         || (array_length(public.plano_parcelas('limpa_nome','tap'),1) - 1) || 'x de '
         || public.brl((public.plano_parcelas('limpa_nome','tap'))[2]) || ' mensais (PIX ou boleto)'
  end
$$;

-- rótulo da cobrança para mensagens ("entrada", "parcela 2 de 5", "1ª parcela de 2")
create or replace function public.rotulo_cobranca(c public.cobrancas)
returns text language sql stable as $$
  select case
    when c.tipo = 'adesao' then 'entrada'
    when c.tipo = 'quitacao' then 'quitação do saldo'
    when c.tipo = 'avista' then 'pagamento à vista'
    when c.tipo = 'unica' then 'Diagnóstico de crédito'
    when ct.modalidade = 'tap' then 'parcela ' || (c.numero - 1) || ' de '
         || (select count(*) - 1 from public.cobrancas x where x.contrato_id = c.contrato_id and x.tipo in ('adesao','parcela'))
    else 'parcela ' || c.numero || ' de '
         || (select count(*) from public.cobrancas x where x.contrato_id = c.contrato_id and x.tipo = 'parcela')
  end
  from public.contratos ct where ct.id = c.contrato_id
$$;

-- split do valor: cada beneficiário recebe % do valor BRUTO (arredondado em centavos;
-- o último fecha a soma exata: 25% de R$ 297 = R$ 74,25 = 37,13 + 37,12)
create or replace function public.split_calcular(p_servico text, p_valor numeric)
returns jsonb language plpgsql stable as $$
declare b jsonb := coalesce(public.cfg('split_beneficiarios'), '[]'::jsonb);
        n int; i int; v numeric; v_total numeric; v_acc numeric := 0; v_pct numeric; v_out jsonb := '[]'::jsonb;
begin
  if not (coalesce(public.cfg('split_servicos'), '["limpa_nome"]'::jsonb) ? p_servico) then return v_out; end if;
  n := jsonb_array_length(b);
  if n = 0 then return v_out; end if;
  select coalesce(sum((x->>'percentual')::numeric),0) into v_pct from jsonb_array_elements(b) x;
  v_total := round(p_valor * v_pct / 100, 2);
  for i in 0 .. n - 1 loop
    v := case when i < n - 1 then round(p_valor * (b->i->>'percentual')::numeric / 100, 2) else v_total - v_acc end;
    v_acc := v_acc + v;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'nome', b->i->>'nome', 'walletId', nullif(trim(coalesce(b->i->>'walletId','')), ''),
      'percentual', (b->i->>'percentual')::numeric, 'fixedValue', v));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- CONTRATAÇÃO (ferramenta da IA): cria o contrato e as cobranças
-- ---------------------------------------------------------------------
create or replace function public.iniciar_contratacao(p_conversa uuid, p_servico text, p_modalidade text, p_por text default 'ia')
returns jsonb language plpgsql as $$
declare
  l public.leads; v_lead uuid; v_mod text; v_parc numeric[]; v_total numeric; v_ct public.contratos;
  v_cob public.cobrancas; v_split jsonb; v_venc date; i int; v_tipo text; v_tem boolean;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  select * into l from public.leads where id = v_lead;
  if l.id is null then return jsonb_build_object('ok', false, 'orientacao', 'Conversa não encontrada.'); end if;
  if p_servico not in ('diagnostico','limpa_nome') then
    return jsonb_build_object('ok', false, 'orientacao', 'Defina o serviço: diagnostico ou limpa_nome.');
  end if;
  v_mod := public.normalizar_modalidade(p_servico, p_modalidade);
  if v_mod is null then
    return jsonb_build_object('ok', false, 'orientacao',
      'Pergunte ao lead qual forma prefere: à vista (avista), 2x (2x) ou entrada + 5x (tap).');
  end if;

  -- sem Asaas: links fixos configurados no CRM (comportamento anterior)
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return public.link_pagamento(p_conversa, p_servico, v_mod);
  end if;

  if l.nome is null or l.cpf_cnpj is null then
    return jsonb_build_object('ok', false, 'orientacao',
      'Antes de gerar o link, peça o nome completo e o CPF ou CNPJ (com a autorização LGPD) e salve com atualizar_ficha_lead.');
  end if;

  v_parc := public.plano_parcelas(p_servico, v_mod);
  if v_parc is null or array_length(v_parc,1) is null then
    return jsonb_build_object('ok', false, 'orientacao', 'Modalidade não configurada. Transfira para a equipe.');
  end if;
  select sum(x) into v_total from unnest(v_parc) x;

  -- split obrigatório e incompleto: não gera cobrança errada
  v_split := public.split_calcular(p_servico, v_parc[1]);
  if coalesce((public.cfg_txt('split_obrigatorio'))::boolean, true)
     and exists (select 1 from jsonb_array_elements(v_split) s where s->>'walletId' is null and (s->>'fixedValue')::numeric > 0) then
    perform public.criar_alerta('handoff', p_conversa,
      'Lead pronto para pagar o Limpa Nome, mas falta o walletId de um beneficiário do split em Configurações.');
    return jsonb_build_object('ok', false, 'orientacao',
      'O link ainda não está disponível. Diga que um consultor vai enviar o link em instantes e NÃO invente link.');
  end if;

  -- contrato em aberto deste serviço
  select * into v_ct from public.contratos
   where lead_id = l.id and servico = p_servico and status in ('aguardando_pagamento','ativo','inadimplente')
   for update;
  v_tem := found;
  if v_tem and v_ct.status in ('ativo','inadimplente') then
    return jsonb_build_object('ok', false, 'orientacao',
      'Este cliente já tem um contrato ativo deste serviço. Não gere novo link: transfira para a equipe (pedido_lead).');
  end if;
  if v_tem and v_ct.modalidade = v_mod then
    select * into v_cob from public.cobrancas where contrato_id = v_ct.id and numero = 1;
    if v_cob.status in ('pendente','vencida') and v_cob.invoice_url is not null then
      return jsonb_build_object('ok', true, 'link', v_cob.invoice_url, 'valor', v_cob.valor, 'total', v_ct.valor_total,
        'condicao', public.condicao_texto(p_servico, v_mod), 'cobranca_id', v_cob.id, 'acao', 'pronto');
    end if;
    if v_cob.status in ('a_gerar','gerando') then
      return jsonb_build_object('ok', true, 'acao', 'gerar_cobranca', 'cobranca_id', v_cob.id, 'valor', v_cob.valor,
        'total', v_ct.valor_total, 'condicao', public.condicao_texto(p_servico, v_mod));
    end if;
  end if;
  if v_tem then
    -- trocou de modalidade antes de pagar: cancela o contrato anterior
    update public.cobrancas set status = case when asaas_payment_id is null then 'cancelada' else 'a_cancelar' end,
           motivo_cancelamento = 'troca_modalidade'
     where contrato_id = v_ct.id and status in ('planejada','a_gerar','pendente','vencida');
    update public.contratos set status = 'cancelado' where id = v_ct.id;
  end if;

  insert into public.contratos (lead_id, servico, modalidade, valor_total, criado_por)
  values (l.id, p_servico, v_mod, v_total, coalesce(p_por,'ia')) returning * into v_ct;

  v_venc := public.hoje() + coalesce((public.cfg_txt('asaas_dias_vencimento'))::int, 2);
  for i in 1 .. array_length(v_parc,1) loop
    v_tipo := case when p_servico = 'diagnostico' then 'unica'
                   when v_mod = 'avista' then 'avista'
                   when v_mod = 'tap' and i = 1 then 'adesao'
                   else 'parcela' end;
    insert into public.cobrancas (contrato_id, lead_id, numero, tipo, valor, vencimento, status)
    values (v_ct.id, l.id, i, v_tipo, v_parc[i], case when i = 1 then v_venc end,
            case when i = 1 then 'a_gerar' else 'planejada' end);
  end loop;
  select * into v_cob from public.cobrancas where contrato_id = v_ct.id and numero = 1;

  update public.leads set servico = p_servico, forma_pagamento = v_mod, valor_previsto = v_total,
         pagamento_status = 'link_enviado'
   where id = l.id;
  perform public.avancar_etapa(l.id, 'proposta');

  return jsonb_build_object('ok', true, 'acao', 'gerar_cobranca', 'cobranca_id', v_cob.id, 'valor', v_cob.valor,
    'total', v_total, 'condicao', public.condicao_texto(p_servico, v_mod));
end $$;

-- Fallback sem Asaas (links fixos do CRM), agora com as 3 modalidades
create or replace function public.link_pagamento(p_conversa uuid, p_servico text, p_forma text)
returns jsonb language plpgsql as $$
declare v_lead uuid; v_chave text; v_link text; v_valor numeric; v_forma text;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  if p_servico not in ('diagnostico','limpa_nome') then
    return jsonb_build_object('ok', false, 'orientacao', 'Defina o serviço: diagnostico ou limpa_nome.');
  end if;
  v_forma := coalesce(public.normalizar_modalidade(p_servico, p_forma), 'avista');
  v_chave := case when p_servico = 'diagnostico' then 'link_pagamento_diagnostico'
                  when v_forma = 'tap' then 'link_pagamento_limpa_nome_tap'
                  when v_forma = '2x' then 'link_pagamento_limpa_nome_2x'
                  else 'link_pagamento_limpa_nome_avista' end;
  v_link  := nullif(public.cfg_txt(v_chave), '');
  select sum(x) into v_valor from unnest(public.plano_parcelas(p_servico, v_forma)) x;
  update public.leads set servico = p_servico, forma_pagamento = v_forma, valor_previsto = v_valor,
         pagamento_status = case when pagamento_status in ('nenhum') then 'link_enviado' else pagamento_status end
   where id = v_lead;
  perform public.avancar_etapa(v_lead, 'proposta');
  if v_link is null then
    perform public.criar_alerta('handoff', p_conversa,
      'Lead pronto para pagar (' || p_servico || ', ' || v_forma || ') mas o link de pagamento não está configurado no CRM.');
    return jsonb_build_object('ok', false, 'orientacao',
      'O link ainda não está disponível. Diga que um consultor vai enviar o link em instantes e NÃO invente link.');
  end if;
  return jsonb_build_object('ok', true, 'link', v_link, 'valor', v_valor, 'forma', v_forma,
                            'condicao', public.condicao_texto(p_servico, v_forma));
end $$;

-- ---------------------------------------------------------------------
-- CRIAÇÃO DA COBRANÇA NO ASAAS (usada pelo n8n)
-- ---------------------------------------------------------------------
-- Reserva a cobrança (evita duas criações ao mesmo tempo) e devolve tudo que o n8n
-- precisa para chamar o Asaas. Se já existe no Asaas, devolve o link.
create or replace function public.asaas_reservar_cobranca(p_cobranca uuid)
returns jsonb language plpgsql as $$
declare c public.cobrancas; ct public.contratos; l public.leads; v_split jsonb; v_tel text;
begin
  select * into c from public.cobrancas where id = p_cobranca for update;
  if c.id is null then return jsonb_build_object('ok', false, 'erro', 'cobranca_nao_encontrada'); end if;
  if c.asaas_payment_id is not null and c.invoice_url is not null then
    return jsonb_build_object('ok', true, 'pronta', true, 'link', c.invoice_url, 'cobranca_id', c.id, 'valor', c.valor);
  end if;
  if not (c.status = 'a_gerar' or (c.status = 'gerando' and c.atualizado_em < now() - interval '10 minutes')) then
    return jsonb_build_object('ok', false, 'erro', 'cobranca_ocupada', 'status', c.status);
  end if;
  select * into ct from public.contratos where id = c.contrato_id;
  select * into l from public.leads where id = c.lead_id;

  v_split := public.split_calcular(ct.servico, c.valor);
  if coalesce((public.cfg_txt('split_obrigatorio'))::boolean, true)
     and exists (select 1 from jsonb_array_elements(v_split) s where s->>'walletId' is null and (s->>'fixedValue')::numeric > 0) then
    update public.cobrancas set erro = 'split_sem_walletid', tentativas = tentativas + 1 where id = c.id returning * into c;
    if c.tentativas = 3 then
      perform public.criar_alerta('erro', (select id from public.conversas where lead_id = c.lead_id),
        'Cobrança do Limpa Nome parada: falta o walletId de um beneficiário do split em Configurações.');
    end if;
    return jsonb_build_object('ok', false, 'erro', 'split_sem_walletid');
  end if;
  v_split := coalesce((select jsonb_agg(s) from jsonb_array_elements(v_split) s where (s->>'fixedValue')::numeric > 0), '[]'::jsonb);

  update public.cobrancas set status = 'gerando', tentativas = tentativas + 1, split = v_split,
         vencimento = greatest(coalesce(vencimento, public.hoje()), public.hoje())
   where id = c.id returning * into c;

  v_tel := regexp_replace(l.telefone, '\D', '', 'g');
  if v_tel like '55%' and length(v_tel) >= 12 then v_tel := substr(v_tel, 3); end if;

  return jsonb_build_object(
    'ok', true, 'pronta', false, 'cobranca_id', c.id, 'lead_id', l.id,
    'base_url', coalesce(nullif(public.cfg_txt('asaas_base_url'), ''), 'https://api-sandbox.asaas.com/v3'),
    'asaas_customer_id', l.asaas_customer_id,
    'cliente', jsonb_build_object(
      'name', l.nome, 'cpfCnpj', l.cpf_cnpj, 'email', l.email, 'mobilePhone', v_tel,
      'externalReference', l.id::text,
      'notificationDisabled', not coalesce((public.cfg_txt('asaas_notificar_pelo_asaas'))::boolean, false)),
    'cobranca', jsonb_build_object(
      'billingType', coalesce(nullif(public.cfg_txt('asaas_forma_cobranca'), ''), 'BOLETO'),
      'value', c.valor,
      'dueDate', to_char(c.vencimento, 'YYYY-MM-DD'),
      'description', 'Advance · ' || case ct.servico when 'diagnostico' then 'Diagnóstico de crédito' else 'Limpa Nome' end
                     || ' · ' || public.rotulo_cobranca(c),
      'externalReference', c.id::text,
      'split', (select coalesce(jsonb_agg(jsonb_build_object('walletId', s->>'walletId', 'fixedValue', (s->>'fixedValue')::numeric,
                                  'description', 'Comissão ' || (s->>'nome'), 'externalReference', c.id::text || ':' || (s->>'nome'))), '[]'::jsonb)
                  from jsonb_array_elements(v_split) s)));
end $$;

create or replace function public.asaas_salvar_cliente(p_lead uuid, p_customer text)
returns void language sql as $$
  update public.leads set asaas_customer_id = p_customer where id = p_lead and nullif(p_customer,'') is not null
$$;

-- Registra a resposta do Asaas (cobrança criada) e as comissões previstas
create or replace function public.asaas_cobranca_criada(p_cobranca uuid, p_payment jsonb, p_origem text default 'agente')
returns jsonb language plpgsql as $$
declare c public.cobrancas; ct public.contratos; s jsonb; sp jsonb; v_nome text;
begin
  update public.cobrancas set
    asaas_payment_id = p_payment->>'id',
    invoice_url      = p_payment->>'invoiceUrl',
    bank_slip_url    = p_payment->>'bankSlipUrl',
    vencimento       = coalesce((p_payment->>'dueDate')::date, vencimento),
    status           = case when status in ('gerando','a_gerar') then 'pendente' else status end,
    erro             = null
  where id = p_cobranca returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'erro', 'cobranca_nao_encontrada'); end if;
  select * into ct from public.contratos where id = c.contrato_id;

  for s in select * from jsonb_array_elements(c.split) loop
    v_nome := s->>'nome';
    select x into sp from jsonb_array_elements(coalesce(p_payment->'split','[]'::jsonb)) x
     where x->>'walletId' = s->>'walletId' limit 1;
    insert into public.comissoes (cobranca_id, contrato_id, lead_id, beneficiario, wallet_id, base, percentual, valor, asaas_split_id)
    values (c.id, c.contrato_id, c.lead_id, v_nome, s->>'walletId', c.valor, (s->>'percentual')::numeric,
            coalesce((sp->>'fixedValue')::numeric, (s->>'fixedValue')::numeric), sp->>'id')
    on conflict (cobranca_id, beneficiario) do update
      set wallet_id = excluded.wallet_id, valor = excluded.valor,
          asaas_split_id = coalesce(excluded.asaas_split_id, public.comissoes.asaas_split_id);
  end loop;

  -- criada pela rotina (não na hora da conversa): manda o link para o cliente
  if p_origem = 'rotina' and c.invoice_url is not null and (c.numero = 1 or c.tipo = 'quitacao') then
    perform public.criar_notificacao(c.lead_id, c.contrato_id, c.id,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link_pagamento' end,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
      'link:' || c.id::text);
  end if;
  return jsonb_build_object('ok', true, 'link', c.invoice_url, 'valor', c.valor, 'cobranca_id', c.id,
                            'condicao', public.condicao_texto(ct.servico, ct.modalidade));
end $$;

create or replace function public.asaas_cobranca_falhou(p_cobranca uuid, p_erro text)
returns jsonb language plpgsql as $$
declare c public.cobrancas; v_conv uuid;
begin
  update public.cobrancas set status = case when status = 'gerando' then 'a_gerar' else status end,
         erro = left(coalesce(p_erro,'erro'), 500)
   where id = p_cobranca returning * into c;
  if c.tentativas = 3 then
    select id into v_conv from public.conversas where lead_id = c.lead_id;
    perform public.criar_alerta('erro', v_conv, 'Não consegui criar a cobrança no Asaas (' || public.brl(c.valor) || '): ' || left(coalesce(p_erro,''), 300));
  end if;
  return jsonb_build_object('ok', false, 'tentativas', c.tentativas);
end $$;

-- Trabalho pendente com o Asaas (a cada minuto): criar cobranças e cancelar substituídas
create or replace function public.asaas_sincronizacao()
returns jsonb language plpgsql as $$
declare v_dias int := coalesce((public.cfg_txt('asaas_gerar_dias_antes'))::int, 10);
begin
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return jsonb_build_object('gerar', '[]'::jsonb, 'cancelar', '[]'::jsonb);
  end if;
  -- parcelas que chegaram perto do vencimento
  update public.cobrancas c set status = 'a_gerar'
   where c.status = 'planejada' and c.vencimento is not null and c.vencimento - v_dias <= public.hoje()
     and exists (select 1 from public.contratos ct where ct.id = c.contrato_id and ct.status in ('ativo','inadimplente'));
  -- cobranças nunca criadas no Asaas não precisam ser canceladas lá
  update public.cobrancas set status = 'cancelada' where status = 'a_cancelar' and asaas_payment_id is null;
  return jsonb_build_object(
    'gerar', coalesce((select jsonb_agg(id order by vencimento) from (
                select id, vencimento from public.cobrancas
                 where (status = 'a_gerar' and tentativas < 5 and criado_em < now() - interval '1 minute')
                    or (status = 'gerando' and atualizado_em < now() - interval '10 minutes')
                 order by vencimento limit 20) x), '[]'::jsonb),
    'cancelar', coalesce((select jsonb_agg(jsonb_build_object('cobranca_id', id, 'payment_id', asaas_payment_id))
                 from (select id, asaas_payment_id from public.cobrancas where status = 'a_cancelar' limit 20) y), '[]'::jsonb),
    'base_url', coalesce(nullif(public.cfg_txt('asaas_base_url'), ''), 'https://api-sandbox.asaas.com/v3'));
end $$;

create or replace function public.asaas_cobranca_cancelada(p_cobranca uuid, p_ok boolean, p_erro text default null)
returns void language plpgsql as $$
begin
  if p_ok then
    update public.cobrancas set status = 'cancelada', erro = null where id = p_cobranca and status = 'a_cancelar';
    update public.comissoes set status = 'cancelada' where cobranca_id = p_cobranca and status = 'prevista';
  else
    update public.cobrancas set erro = left(coalesce(p_erro,'falha ao cancelar'), 500), tentativas = tentativas + 1
     where id = p_cobranca;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- WEBHOOK DO ASAAS (idempotente pelo id do evento)
-- ---------------------------------------------------------------------
create or replace function public.asaas_registrar_evento(p_body jsonb)
returns jsonb language plpgsql as $$
declare v_id text; v_res jsonb;
begin
  v_id := coalesce(nullif(p_body->>'id',''),
                   'sem_id:' || coalesce(p_body->>'event','') || ':' || coalesce(p_body#>>'{payment,id}','') || ':' || md5(p_body::text));
  insert into public.asaas_eventos (id, evento, payment_id, payload)
  values (v_id, coalesce(p_body->>'event','?'), p_body#>>'{payment,id}', p_body)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'evento_id', v_id);
  end if;
  v_res := public.asaas_processar_evento(v_id);
  return jsonb_build_object('ok', true, 'duplicado', false, 'evento_id', v_id, 'resultado', v_res);
end $$;

create or replace function public.asaas_processar_evento(p_evento_id text)
returns jsonb language plpgsql as $$
declare e public.asaas_eventos; v_res jsonb;
begin
  select * into e from public.asaas_eventos where id = p_evento_id for update;
  if e.id is null or e.status in ('processado','ignorado') then return jsonb_build_object('ok', true, 'ja_processado', true); end if;
  begin
    v_res := public.asaas_aplicar_evento(e.evento, e.payload);
    update public.asaas_eventos set status = case when v_res->>'ignorado' = 'true' then 'ignorado' else 'processado' end,
           resultado = v_res, processado_em = now(), tentativas = tentativas + 1
     where id = e.id;
    return v_res;
  exception when others then
    update public.asaas_eventos set status = 'erro', tentativas = tentativas + 1,
           resultado = jsonb_build_object('erro', sqlerrm) where id = e.id;
    perform public.criar_alerta('erro', null, 'Erro ao processar evento do Asaas ' || e.evento || ' (' || coalesce(e.payment_id,'') || '): ' || sqlerrm);
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end $$;

-- Regra de negócio de cada evento
create or replace function public.asaas_aplicar_evento(p_evento text, p_body jsonb)
returns jsonb language plpgsql as $$
declare
  p jsonb := p_body->'payment';
  c public.cobrancas; ct public.contratos; v_conv uuid; v_antes text; v_pago boolean; v_pago_em timestamptz;
  v_split jsonb; v_ref text; v_estornado numeric; n int;
begin
  v_ref := coalesce(p->>'externalReference', '');
  select * into c from public.cobrancas
   where asaas_payment_id = p->>'id'
      or (v_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id = v_ref::uuid)
   limit 1 for update;
  if c.id is null then
    return jsonb_build_object('ok', true, 'ignorado', true, 'motivo', 'cobranca_fora_do_sistema');
  end if;
  select * into ct from public.contratos where id = c.contrato_id for update;
  select id into v_conv from public.conversas where lead_id = c.lead_id;
  v_antes := c.status;
  if c.asaas_payment_id is null and p->>'id' is not null then
    update public.cobrancas set asaas_payment_id = p->>'id', invoice_url = coalesce(invoice_url, p->>'invoiceUrl') where id = c.id;
  end if;

  -- comissões: acompanha o status de cada split (DONE, CANCELLED, REFUNDED...)
  for v_split in select * from jsonb_array_elements(coalesce(p->'split','[]'::jsonb)) loop
    update public.comissoes set
      asaas_split_id = coalesce(asaas_split_id, v_split->>'id'),
      valor  = coalesce((v_split->>'totalValue')::numeric, (v_split->>'fixedValue')::numeric, valor),
      status = case v_split->>'status'
                 when 'DONE' then 'liquidada'
                 when 'CANCELLED' then case when status = 'estornada' then status else 'cancelada' end
                 when 'REFUSED' then 'cancelada'
                 when 'REFUNDED' then 'estornada'
                 else status end,
      liquidada_em = case when v_split->>'status' = 'DONE' then coalesce(liquidada_em, now()) else liquidada_em end
     where cobranca_id = c.id and (wallet_id = v_split->>'walletId' or asaas_split_id = v_split->>'id');
  end loop;

  if p_evento in ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') then
    v_pago := v_antes in ('confirmada','recebida');
    v_pago_em := coalesce((p->>'clientPaymentDate')::date, (p->>'paymentDate')::date, (p->>'confirmedDate')::date, public.hoje())::timestamptz
                 + interval '12 hours';
    update public.cobrancas set
      status = case when p_evento = 'PAYMENT_RECEIVED' then 'recebida'
                    when status = 'recebida' then 'recebida' else 'confirmada' end,
      valor_pago = coalesce((p->>'value')::numeric, valor_pago, valor),
      valor_liquido = coalesce((p->>'netValue')::numeric, valor_liquido),
      forma_paga = coalesce(p->>'billingType', forma_paga),
      pago_em = coalesce(pago_em, v_pago_em)
     where id = c.id returning * into c;
    update public.comissoes set status = 'a_liquidar' where cobranca_id = c.id and status = 'prevista';
    update public.notificacoes set status = 'cancelada' where cobranca_id = c.id and status = 'pendente';

    if v_pago then
      return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', c.status, 'ja_estava_pago', true);
    end if;
    if v_antes in ('a_cancelar','cancelada') then
      perform public.criar_alerta('handoff', v_conv, 'O cliente pagou uma cobrança que estava sendo substituída/cancelada ('
        || public.rotulo_cobranca(c) || ', ' || public.brl(c.valor_pago) || '). Confira a quitação no CRM.');
    end if;

    if ct.status = 'aguardando_pagamento' then
      update public.contratos set status = 'ativo', aderido_em = now() where id = ct.id;
      -- próximas parcelas: mês a mês a partir do 1º pagamento
      update public.cobrancas set vencimento = (c.pago_em at time zone 'America/Maceio')::date + make_interval(months => numero - 1)
       where contrato_id = ct.id and status = 'planejada';
      perform public.confirmar_pagamento(c.lead_id, ct.valor_total, ct.modalidade, 'asaas');
    end if;

    if c.tipo = 'quitacao' then
      update public.cobrancas set status = case when asaas_payment_id is null then 'cancelada' else 'a_cancelar' end,
             motivo_cancelamento = 'quitacao'
       where contrato_id = ct.id and status in ('planejada','a_gerar','pendente','vencida');
      update public.contratos set status = 'quitado', quitado_em = now() where id = ct.id;
    else
      select count(*) into n from public.cobrancas
       where contrato_id = ct.id and status in ('planejada','a_gerar','gerando','pendente','vencida');
      if n = 0 then
        update public.contratos set status = 'quitado', quitado_em = coalesce(quitado_em, now()) where id = ct.id;
      elsif (select status from public.contratos where id = ct.id) = 'inadimplente'
            and not exists (select 1 from public.cobrancas where contrato_id = ct.id and status = 'vencida') then
        update public.contratos set status = 'ativo' where id = ct.id;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', c.status, 'primeiro_pagamento', ct.status = 'aguardando_pagamento');

  elsif p_evento = 'PAYMENT_OVERDUE' then
    if c.status = 'pendente' then
      update public.cobrancas set status = 'vencida' where id = c.id;
      if ct.status = 'ativo' then update public.contratos set status = 'inadimplente' where id = ct.id; end if;
    end if;
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', 'vencida');

  elsif p_evento = 'PAYMENT_DELETED' then
    if c.status not in ('confirmada','recebida','estornada') then
      update public.cobrancas set status = 'cancelada' where id = c.id;
      update public.comissoes set status = 'cancelada' where cobranca_id = c.id and status = 'prevista';
      update public.notificacoes set status = 'cancelada' where cobranca_id = c.id and status = 'pendente';
    end if;
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', 'cancelada');

  elsif p_evento = 'PAYMENT_RESTORED' then
    update public.cobrancas set status = case when vencimento < public.hoje() then 'vencida' else 'pendente' end
     where id = c.id and status = 'cancelada';
    perform public.criar_alerta('erro', v_conv, 'Uma cobrança foi restaurada no Asaas (' || public.rotulo_cobranca(c)
      || '). O Asaas remove o split quando a cobrança é excluída: configure o split de novo nela antes do pagamento.');
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', 'restaurada');

  elsif p_evento in ('PAYMENT_REFUNDED','PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    update public.cobrancas set status = 'estornada', valor_estornado = coalesce(valor_pago, valor) where id = c.id;
    update public.comissoes set status = 'estornada' where cobranca_id = c.id and status <> 'cancelada';
    if not exists (select 1 from public.cobrancas where contrato_id = ct.id and status in ('confirmada','recebida')) then
      update public.contratos set status = 'estornado' where id = ct.id;
    end if;
    perform public.criar_alerta('handoff', v_conv, 'Cobrança estornada no Asaas (' || public.rotulo_cobranca(c) || ', '
      || public.brl(coalesce(c.valor_pago, c.valor)) || '). O split dela também é estornado. Confira o contrato.');
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', 'estornada');

  elsif p_evento = 'PAYMENT_PARTIALLY_REFUNDED' then
    select coalesce(sum((r->>'value')::numeric), 0) into v_estornado
      from jsonb_array_elements(coalesce(p->'refunds','[]'::jsonb)) r;
    update public.cobrancas set valor_estornado = nullif(v_estornado, 0) where id = c.id;
    perform public.criar_alerta('handoff', v_conv, 'Estorno parcial no Asaas (' || public.rotulo_cobranca(c)
      || '). Confira no Asaas como ficou o split desta cobrança e ajuste a comissão.');
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'status', 'estorno_parcial');

  elsif p_evento in ('PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
                     'PAYMENT_REFUND_IN_PROGRESS','PAYMENT_SPLIT_DIVERGENCE_BLOCK','PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED',
                     'PAYMENT_SPLIT_CANCELLED') then
    perform public.criar_alerta('handoff', v_conv, 'Asaas: ' || p_evento || ' na cobrança ' || public.rotulo_cobranca(c)
      || ' (' || public.brl(c.valor) || '). Verifique no Asaas.');
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'alerta', p_evento);

  elsif p_evento = 'PAYMENT_SPLIT_DONE' then
    update public.comissoes set status = 'liquidada', liquidada_em = coalesce(liquidada_em, now())
     where cobranca_id = c.id and asaas_split_id = p_body#>>'{additionalInfo,splitId}';
    return jsonb_build_object('ok', true, 'cobranca_id', c.id, 'split', p_body#>>'{additionalInfo,splitId}');

  elsif p_evento in ('PAYMENT_CREATED','PAYMENT_UPDATED') then
    update public.cobrancas set invoice_url = coalesce(p->>'invoiceUrl', invoice_url),
           vencimento = coalesce((p->>'dueDate')::date, vencimento)
     where id = c.id;
    return jsonb_build_object('ok', true, 'cobranca_id', c.id);
  end if;

  return jsonb_build_object('ok', true, 'ignorado', true, 'motivo', 'evento_sem_regra');
end $$;

-- ---------------------------------------------------------------------
-- RESUMO DO CONTRATO (saldo devedor) e QUITAÇÃO ANTECIPADA
-- ---------------------------------------------------------------------
create or replace function public.contrato_resumo(p_contrato uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'contrato_id', ct.id, 'servico', ct.servico, 'modalidade', ct.modalidade, 'status', ct.status,
    'valor_total', ct.valor_total,
    'pago', coalesce(sum(c.valor_pago) filter (where c.status in ('confirmada','recebida')), 0),
    'saldo_devedor', coalesce(sum(c.valor) filter (where c.status in ('planejada','a_gerar','gerando','pendente','vencida')), 0),
    'vencido', coalesce(sum(c.valor) filter (where c.status = 'vencida'), 0),
    'pagamentos_feitos', count(*) filter (where c.status in ('confirmada','recebida')),
    'pagamentos_total', count(*) filter (where c.status <> 'cancelada' and c.tipo <> 'quitacao'),
    'processo_etapa', ct.processo_etapa)
  from public.contratos ct left join public.cobrancas c on c.contrato_id = ct.id
  where ct.id = p_contrato
  group by ct.id
$$;

create or replace function public.crm_papel() returns text language sql stable security definer set search_path = public as $$
  select papel from public.crm_usuarios where lower(email) = lower(public.crm_email()) and ativo
$$;

create or replace function public.crm_quitar_contrato(p_contrato uuid, p_desconto numeric default 0, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ct public.contratos; r jsonb; v_saldo numeric; v_final numeric; v_num int; v_cob uuid; v_desc numeric := coalesce(p_desconto, 0);
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  if v_desc < 0 then return jsonb_build_object('ok', false, 'erro', 'O desconto não pode ser negativo.'); end if;
  if v_desc > 0 and coalesce(public.crm_papel(), '') not in ('ampliize','advance') then
    return jsonb_build_object('ok', false, 'erro', 'Só um administrador pode autorizar desconto na quitação.');
  end if;
  if v_desc > 0 and nullif(trim(coalesce(p_motivo,'')), '') is null then
    return jsonb_build_object('ok', false, 'erro', 'Informe o motivo/autorização do desconto.');
  end if;
  select * into ct from public.contratos where id = p_contrato for update;
  if ct.id is null or ct.status not in ('ativo','inadimplente') then
    return jsonb_build_object('ok', false, 'erro', 'Só dá para quitar um contrato ativo ou inadimplente.');
  end if;
  if exists (select 1 from public.cobrancas where contrato_id = ct.id and status = 'gerando') then
    return jsonb_build_object('ok', false, 'erro', 'Uma cobrança está sendo criada no Asaas agora. Tente de novo em 1 minuto.');
  end if;
  if exists (select 1 from public.cobrancas where contrato_id = ct.id and tipo = 'quitacao' and status in ('a_gerar','pendente','vencida')) then
    return jsonb_build_object('ok', false, 'erro', 'Já existe uma quitação em aberto para este contrato.');
  end if;
  r := public.contrato_resumo(ct.id);
  v_saldo := (r->>'saldo_devedor')::numeric;
  if v_saldo <= 0 then return jsonb_build_object('ok', false, 'erro', 'Não há saldo devedor.'); end if;
  v_final := round(v_saldo - v_desc, 2);
  if v_final < 5 then return jsonb_build_object('ok', false, 'erro', 'O valor final da quitação precisa ser de pelo menos R$ 5,00.'); end if;

  update public.cobrancas set status = case when asaas_payment_id is null then 'cancelada' else 'a_cancelar' end,
         motivo_cancelamento = 'quitacao'
   where contrato_id = ct.id and status in ('planejada','a_gerar','pendente','vencida');
  update public.notificacoes set status = 'cancelada'
   where contrato_id = ct.id and status = 'pendente' and tipo in ('lembrete','vencida','link_pagamento');
  select coalesce(max(numero), 0) + 1 into v_num from public.cobrancas where contrato_id = ct.id;
  insert into public.cobrancas (contrato_id, lead_id, numero, tipo, valor, vencimento, status)
  values (ct.id, ct.lead_id, v_num, 'quitacao', v_final,
          public.hoje() + coalesce((public.cfg_txt('asaas_dias_vencimento'))::int, 2), 'a_gerar')
  returning id into v_cob;
  update public.contratos set desconto_quitacao = nullif(v_desc, 0) where id = ct.id;
  insert into public.auditoria (acao, detalhe, por)
  values ('quitacao_solicitada', jsonb_build_object('contrato_id', ct.id, 'saldo', v_saldo, 'desconto', v_desc,
                                                    'valor_final', v_final, 'motivo', p_motivo), public.crm_email());
  return jsonb_build_object('ok', true, 'cobranca_id', v_cob, 'saldo', v_saldo, 'desconto', v_desc, 'valor_final', v_final);
end $$;

-- ---------------------------------------------------------------------
-- NOTIFICAÇÕES AOS CLIENTES (WhatsApp, enviadas pelas Rotinas)
-- ---------------------------------------------------------------------
create or replace function public.preencher_texto(p_tpl text, p jsonb)
returns text language plpgsql immutable as $$
declare k text; v_txt text := coalesce(p_tpl, '');
begin
  for k in select jsonb_object_keys(p) loop
    v_txt := replace(v_txt, '{' || k || '}', coalesce(p->>k, ''));
  end loop;
  v_txt := regexp_replace(v_txt, '\{[a-z_]+\}', '', 'g');
  v_txt := regexp_replace(v_txt, '[ ]{2,}', ' ', 'g');
  v_txt := regexp_replace(v_txt, '^\s*,\s*', '');
  return trim(v_txt);
end $$;

-- cria (uma única vez por chave) a notificação de uma cobrança a partir do modelo
create or replace function public.criar_notificacao(p_lead uuid, p_contrato uuid, p_cobranca uuid, p_tipo text,
                                                    p_modelo text, p_chave text, p_por text default 'sistema')
returns bigint language plpgsql as $$
declare c public.cobrancas; l public.leads; v_txt text; v_id bigint;
begin
  select * into l from public.leads where id = p_lead;
  if p_cobranca is not null then select * into c from public.cobrancas where id = p_cobranca; end if;
  v_txt := public.preencher_texto(coalesce(public.cfg('notif_textos')->>p_modelo, p_modelo), jsonb_build_object(
    'nome', split_part(coalesce(l.nome, l.nome_whatsapp, ''), ' ', 1),
    'parcela', case when c.id is not null then public.rotulo_cobranca(c) end,
    'valor', case when c.id is not null then public.brl(c.valor) end,
    'vencimento', case when c.vencimento is not null then to_char(c.vencimento, 'DD/MM') end,
    'link', c.invoice_url));
  insert into public.notificacoes (lead_id, contrato_id, cobranca_id, tipo, chave, texto, criado_por)
  values (p_lead, p_contrato, p_cobranca, p_tipo, p_chave, v_txt, coalesce(p_por, 'sistema'))
  on conflict (chave) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.notificacoes_devidas()
returns setof jsonb language plpgsql as $$
declare
  r record; d int; v_hoje date := public.hoje();
  v_lemb int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('notif_lembrete_dias'))::int), '{3,0}');
  v_venc int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('notif_vencida_dias'))::int), '{1,5}');
  v_jan jsonb := coalesce(public.cfg('notif_janela'), '{"inicio":"08:00","fim":"20:00"}'::jsonb);
  v_agora time := (now() at time zone 'America/Maceio')::time;
begin
  if public.sdr_pausado() then return; end if;

  -- lembretes antes do vencimento e avisos de atraso (só clientes com contrato ativo)
  for r in select c.*, ct.status as ct_status from public.cobrancas c join public.contratos ct on ct.id = c.contrato_id
            where ct.servico = 'limpa_nome' and ct.status in ('ativo','inadimplente')
              and c.status in ('pendente','vencida') and c.invoice_url is not null and c.vencimento is not null loop
    d := r.vencimento - v_hoje;
    if r.status = 'pendente' and d = any(v_lemb) then
      perform public.criar_notificacao(r.lead_id, r.contrato_id, r.id, 'lembrete',
        case when d = 0 then 'lembrete_hoje' else 'lembrete' end, 'lembrete:' || r.id || ':' || d);
    elsif d < 0 and (-d) = any(v_venc) then
      perform public.criar_notificacao(r.lead_id, r.contrato_id, r.id, 'vencida', 'vencida', 'vencida:' || r.id || ':' || (-d));
    end if;
  end loop;

  -- avisos automáticos que perderam o dia não são mais enviados
  update public.notificacoes set status = 'cancelada'
   where status = 'pendente' and tipo in ('lembrete','vencida') and criado_em < now() - interval '36 hours';

  if v_agora < (v_jan->>'inicio')::time or v_agora > (v_jan->>'fim')::time then return; end if;

  for r in select n.id, n.texto, n.tipo, cv.id as conversa_id
             from public.notificacoes n join public.conversas cv on cv.lead_id = n.lead_id
            where n.status = 'pendente' and n.agendada_para <= now()
            order by n.id limit 30
            for update of n skip locked loop
    update public.notificacoes set status = 'enviada', enviada_em = now() where id = r.id;
    return next jsonb_build_object('notificacao_id', r.id, 'conversa_id', r.conversa_id, 'texto', r.texto, 'tipo', r.tipo);
  end loop;
end $$;

-- Andamento do processo (CRM): atualiza a etapa e avisa o cliente
create or replace function public.crm_andamento_processo(p_contrato uuid, p_etapa text, p_detalhe text default null, p_enviar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ct public.contratos; l public.leads; v_et jsonb; v_txt text; v_id bigint;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  select * into ct from public.contratos where id = p_contrato for update;
  if ct.id is null then return jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado.'); end if;
  select x into v_et from jsonb_array_elements(coalesce(public.cfg('processo_etapas'), '[]'::jsonb)) x where x->>'id' = p_etapa;
  if v_et is null then return jsonb_build_object('ok', false, 'erro', 'Etapa desconhecida.'); end if;
  select * into l from public.leads where id = ct.lead_id;
  update public.contratos set processo_etapa = p_etapa, processo_detalhe = nullif(trim(coalesce(p_detalhe,'')), ''),
         processo_atualizado_em = now()
   where id = ct.id;
  if p_enviar then
    v_txt := public.preencher_texto(v_et->>'texto', jsonb_build_object(
      'nome', split_part(coalesce(l.nome, l.nome_whatsapp, ''), ' ', 1),
      'detalhe', nullif(trim(coalesce(p_detalhe,'')), '')));
    insert into public.notificacoes (lead_id, contrato_id, tipo, chave, texto, criado_por)
    values (ct.lead_id, ct.id, 'andamento', 'andamento:' || ct.id || ':' || p_etapa || ':' || extract(epoch from now())::bigint,
            v_txt, public.crm_email())
    returning id into v_id;
  end if;
  insert into public.auditoria (acao, detalhe, por)
  values ('andamento_processo', jsonb_build_object('contrato_id', ct.id, 'etapa', p_etapa, 'detalhe', p_detalhe, 'enviado', p_enviar), public.crm_email());
  return jsonb_build_object('ok', true, 'notificacao_id', v_id, 'texto', v_txt);
end $$;

-- Reenviar o link de uma cobrança (CRM)
create or replace function public.crm_reenviar_link(p_cobranca uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cobrancas; v_id bigint;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  select * into c from public.cobrancas where id = p_cobranca;
  if c.id is null or c.invoice_url is null or c.status not in ('pendente','vencida') then
    return jsonb_build_object('ok', false, 'erro', 'Esta cobrança não tem link em aberto.');
  end if;
  v_id := public.criar_notificacao(c.lead_id, c.contrato_id, c.id, 'manual',
            case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
            'manual:' || c.id || ':' || extract(epoch from now())::bigint, public.crm_email());
  return jsonb_build_object('ok', true, 'notificacao_id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- FICHA DO LEAD PARA A IA: dados do cliente (contrato, parcelas, links)
-- ---------------------------------------------------------------------
create or replace function public.perfil_lead(p_conversa uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'nome', coalesce(l.nome, l.nome_whatsapp),
    'nome_completo_informado', l.nome is not null,
    'cpf_cnpj_informado', l.cpf_cnpj is not null,
    'email', l.email,
    'servico', l.servico,
    'objetivo', l.objetivo,
    'urgencia', l.urgencia,
    'etapa', l.etapa,
    'consentimento_lgpd', l.consentimento_lgpd_em is not null,
    'pagamento_status', l.pagamento_status,
    'forma_pagamento', l.forma_pagamento,
    'documento_recebido', l.documento_recebido,
    'origem', l.origem,
    'anuncio', l.anuncio ->> 'titulo',
    'reuniao', (select jsonb_build_object('inicio', to_char(r.inicio at time zone 'America/Maceio','DD/MM/YYYY HH24:MI'),
                                          'link', r.meet_link, 'status', r.status)
                  from public.reunioes r where r.lead_id = l.id and r.status in ('agendada','reservando')
                  order by r.inicio desc limit 1),
    'contrato', (select public.contrato_resumo(ct.id)
                   || jsonb_build_object('proxima_cobranca',
                        (select jsonb_build_object('o_que', public.rotulo_cobranca(c), 'valor', public.brl(c.valor),
                                                   'vencimento', to_char(c.vencimento, 'DD/MM/YYYY'), 'link', c.invoice_url,
                                                   'status', c.status)
                           from public.cobrancas c where c.contrato_id = ct.id
                            and c.status in ('pendente','vencida','a_gerar','planejada')
                          order by c.vencimento nulls last, c.numero limit 1))
                   from public.contratos ct where ct.lead_id = l.id and ct.status <> 'cancelado'
                  order by ct.criado_em desc limit 1),
    'agora', public.data_pt(now(), true)
  )
  from public.conversas c join public.leads l on l.id = c.lead_id
  where c.id = p_conversa
$$;

-- ---------------------------------------------------------------------
-- VISÃO PARA O CRM
-- ---------------------------------------------------------------------
create or replace view public.vw_contratos with (security_invoker = true) as
select ct.*, l.nome, l.nome_whatsapp, l.telefone, l.cpf_cnpj, l.email,
       r.pago, r.saldo_devedor, r.vencido, r.pagamentos_feitos, r.pagamentos_total
from public.contratos ct
join public.leads l on l.id = ct.lead_id
cross join lateral (
  select coalesce(sum(c.valor_pago) filter (where c.status in ('confirmada','recebida')), 0) as pago,
         coalesce(sum(c.valor) filter (where c.status in ('planejada','a_gerar','gerando','pendente','vencida')), 0) as saldo_devedor,
         coalesce(sum(c.valor) filter (where c.status = 'vencida'), 0) as vencido,
         count(*) filter (where c.status in ('confirmada','recebida')) as pagamentos_feitos,
         count(*) filter (where c.status <> 'cancelada' and c.tipo <> 'quitacao') as pagamentos_total
  from public.cobrancas c where c.contrato_id = ct.id) r;

-- ---------------------------------------------------------------------
-- BASE DE CONHECIMENTO: novas modalidades do Limpa Nome
-- ---------------------------------------------------------------------
update public.kb set resposta =
  'Três formas, só por PIX ou boleto: à vista R$ 597,00; em 2x de R$ 400,00 (a 1ª na contratação e a 2ª em 30 dias, total R$ 800,00); ou na condição TAP: entrada de R$ 297,00 + 5x de R$ 150,00 mensais (total R$ 1.047,00). Não há outro desconto.'
 where pergunta = 'Quanto custa o Limpa Nome?';
update public.kb set resposta =
  'Somente PIX ou boleto (não trabalhamos com cartão). Diagnóstico: R$ 67,00 à vista. Limpa Nome: à vista R$ 597,00, 2x de R$ 400,00 ou TAP (entrada de R$ 297,00 + 5x de R$ 150,00). Não há outro desconto ou negociação além disso.'
 where pergunta = 'Formas de pagamento';
update public.kb set resposta = replace(resposta,
  'No Limpa Nome, ofereça a condição TAP (entrada R$ 297 + 5x R$ 150).',
  'No Limpa Nome, ofereça as condições parceladas: 2x de R$ 400 ou TAP (entrada R$ 297 + 5x R$ 150).')
 where resposta like '%No Limpa Nome, ofereça a condição TAP (entrada R$ 297 + 5x R$ 150).%';
update public.kb set resposta = replace(replace(resposta, 'R$ 797,00', 'R$ 597,00'), 'R$ 797', 'R$ 597')
 where resposta like '%R$ 797%';
update public.config set descricao = 'Link de pagamento do Limpa Nome à vista (R$ 597) — usado só sem o Asaas'
 where chave = 'link_pagamento_limpa_nome_avista';
update public.config set descricao = 'Link de pagamento da entrada TAP (R$ 297 + 5x R$ 150) — usado só sem o Asaas'
 where chave = 'link_pagamento_limpa_nome_tap';
update public.config set descricao = 'Link de pagamento do Diagnóstico (R$ 67) — usado só sem o Asaas'
 where chave = 'link_pagamento_diagnostico';

-- propostas abertas de Limpa Nome à vista passam ao novo valor
update public.leads set valor_previsto = 597
 where servico = 'limpa_nome' and forma_pagamento = 'avista' and valor_previsto = 797 and pagamento_status <> 'confirmado';

-- ---------------------------------------------------------------------
-- SEGURANÇA E TEMPO REAL
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contratos','cobrancas','comissoes','asaas_eventos','notificacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_all on public.%I', t);
    execute format('create policy crm_all on public.%I for all to authenticated using (public.is_crm_user()) with check (public.is_crm_user())', t);
  end loop;
end $$;

revoke all on public.contratos, public.cobrancas, public.comissoes, public.asaas_eventos, public.notificacoes from anon;
grant select, insert, update, delete on public.contratos, public.cobrancas, public.comissoes, public.notificacoes to authenticated;
grant select on public.asaas_eventos, public.vw_contratos to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.crm_quitar_contrato(uuid, numeric, text), public.crm_andamento_processo(uuid, text, text, boolean),
                           public.crm_reenviar_link(uuid), public.crm_papel() from public, anon;
grant execute on function public.crm_quitar_contrato(uuid, numeric, text), public.crm_andamento_processo(uuid, text, text, boolean),
                          public.crm_reenviar_link(uuid), public.crm_papel(), public.contrato_resumo(uuid),
                          public.brl(numeric), public.rotulo_cobranca(public.cobrancas), public.hoje()
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.contratos; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.cobrancas; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notificacoes; exception when duplicate_object then null; end;
  end if;
end $$;
