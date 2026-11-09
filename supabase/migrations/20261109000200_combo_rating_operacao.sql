-- =====================================================================
-- 09/11 · correções da operação real
--  1) Novos produtos: Combo Limpa Nome + Rating e Rating (sozinho)
--  2) 2x e TAP: parcelas depois da 1ª só começam quando o nome estiver limpo
--     (andamento "Restrições baixadas"/"Processo concluído"), depois a cada 30 dias
--  3) Custo do produto por serviço (Limpa Nome 197, Combo 197, Rating 150)
--  4) Data de pagamento escolhida pelo lead (ex.: "pago dia 20")
--  5) Conversa iniciada pela equipe: a IA não entra até "Devolver para a IA";
--     mensagens da equipe não viram nome do lead ("Advance")
--  6) Dados do contrato (endereço, e-mail) depois do pagamento
-- =====================================================================

-- 1) serviços
alter table public.leads drop constraint if exists leads_servico_check;
alter table public.leads add constraint leads_servico_check
  check (servico in ('indefinido','diagnostico','limpa_nome','combo','rating'));
alter table public.contratos drop constraint if exists contratos_servico_check;
alter table public.contratos add constraint contratos_servico_check
  check (servico in ('diagnostico','limpa_nome','combo','rating'));
alter table public.leads add column if not exists endereco text;

insert into public.config (chave, valor, descricao) values
  ('planos_combo', '{"avista":{"nome":"À vista","parcelas":[1500]},"2x":{"nome":"2x de R$ 900","parcelas":[900,900]},"tap":{"nome":"TAP: entrada + 5x","parcelas":[597,297,297,297,297,297]}}',
   'Combo Limpa Nome + Rating: valores de cada pagamento por modalidade (tabela R$ 1.797)'),
  ('planos_rating', '{"avista":{"nome":"À vista","parcelas":[997]},"2x":{"nome":"2x de R$ 600","parcelas":[600,600]}}',
   'Rating sozinho (para quem já tem o nome limpo): valores por modalidade (tabela R$ 1.200)'),
  ('combo_valor_tabela', '1797', 'Valor de tabela do Combo Limpa Nome + Rating'),
  ('rating_valor_tabela', '1200', 'Valor de tabela do Rating sozinho')
on conflict (chave) do nothing;

update public.config set valor = '["limpa_nome","combo","rating"]'::jsonb
 where chave = 'split_servicos' and not (valor ? 'combo');
update public.config set valor = valor || '{"servicos":["limpa_nome","combo","rating"],"por_servico":{"limpa_nome":197,"combo":197,"rating":150}}'::jsonb
 where chave = 'custo_produto' and not (valor ? 'por_servico');

create or replace function public.servico_nome(p_servico text)
returns text language sql immutable as $$
  select case p_servico when 'diagnostico' then 'Diagnóstico de crédito' when 'limpa_nome' then 'Limpa Nome'
                        when 'combo' then 'Limpa Nome + Rating' when 'rating' then 'Atualização de Rating' else p_servico end
$$;

create or replace function public.plano_parcelas(p_servico text, p_modalidade text)
returns numeric[] language sql stable as $$
  select case
    when p_servico = 'diagnostico' then array[coalesce((public.cfg_txt('valor_diagnostico'))::numeric, 67)]
    else array(select jsonb_array_elements_text(public.cfg(case p_servico when 'combo' then 'planos_combo'
                                                                         when 'rating' then 'planos_rating'
                                                                         else 'planos_limpa_nome' end)
                                                -> p_modalidade -> 'parcelas')::numeric)
  end
$$;

create or replace function public.normalizar_modalidade(p_servico text, p_modalidade text)
returns text language sql immutable as $$
  select case
    when p_servico = 'diagnostico' then 'avista'
    when p_servico <> 'rating' and lower(coalesce(p_modalidade,'')) ~ '(tap|entrada|5x|cinco)' then 'tap'
    when lower(coalesce(p_modalidade,'')) ~ '(2x|duas|2 vezes|dois)' then '2x'
    when lower(coalesce(p_modalidade,'')) ~ '(vista|unico|único|avista)' then 'avista'
    else null end
$$;

create or replace function public.condicao_texto(p_servico text, p_modalidade text)
returns text language sql stable as $$
  select case
    when p_servico = 'diagnostico' then public.brl((public.plano_parcelas('diagnostico','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = 'avista' then public.brl((public.plano_parcelas(p_servico,'avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = '2x' then '2x de ' || public.brl((public.plano_parcelas(p_servico,'2x'))[1])
                                  || case when p_servico = 'rating' then ': a 1ª agora e a 2ª na entrega do serviço (PIX ou boleto)'
                                          else ': a 1ª agora e a 2ª só quando o seu nome estiver limpo (PIX ou boleto)' end
    else 'Entrada de ' || public.brl((public.plano_parcelas(p_servico,'tap'))[1]) || ' agora + '
         || (array_length(public.plano_parcelas(p_servico,'tap'),1) - 1) || 'x de '
         || public.brl((public.plano_parcelas(p_servico,'tap'))[2])
         || ': a 1ª quando o seu nome estiver limpo e as outras a cada 30 dias (PIX ou boleto)'
  end
$$;

-- 3) custo por serviço
create or replace function public.tg_contrato_custo() returns trigger language plpgsql as $$
declare v_cfg jsonb := coalesce(public.cfg('custo_produto'), '{}'::jsonb);
begin
  if coalesce(new.custo_produto, 0) = 0 and coalesce(v_cfg->'servicos', '["limpa_nome"]'::jsonb) ? new.servico then
    new.custo_produto := least(coalesce((v_cfg->'por_servico'->>new.servico)::numeric, (v_cfg->>'valor')::numeric, 0), new.valor_total);
  end if;
  return new;
end $$;

-- 2) parcelas depois da 1ª esperam o nome limpo / a entrega (2x e TAP)
create or replace function public.tg_2x_aguarda_nome_limpo()
returns trigger language plpgsql as $$
declare ct public.contratos;
begin
  if new.status = 'planejada' and new.numero > 1 and new.vencimento is not null then
    select * into ct from public.contratos where id = new.contrato_id;
    if ct.modalidade in ('2x','tap') and coalesce(ct.processo_etapa, '') not in ('baixa', 'concluido') then
      new.vencimento := null;
    end if;
  end if;
  return new;
end $$;

create or replace function public.liberar_parcela_final_2x(p_contrato uuid)
returns int language plpgsql as $$
declare n int; v_ini date := public.hoje() + coalesce((public.cfg_txt('asaas_dias_vencimento'))::int, 2);
begin
  update public.cobrancas c
     set vencimento = v_ini + make_interval(months => c.numero - 2)
    from public.contratos ct
   where ct.id = c.contrato_id and ct.id = p_contrato and ct.modalidade in ('2x','tap')
     and ct.status in ('ativo', 'inadimplente')
     and ct.processo_etapa in ('baixa', 'concluido')
     and c.status = 'planejada' and c.vencimento is null and c.numero > 1;
  get diagnostics n = row_count;
  return n;
end $$;

-- contratos TAP já ativos: parcelas ainda não geradas passam a esperar o nome limpo
update public.cobrancas c set vencimento = null
  from public.contratos ct
 where ct.id = c.contrato_id and ct.modalidade = 'tap' and c.status = 'planejada' and c.numero > 1
   and coalesce(ct.processo_etapa, '') not in ('baixa', 'concluido');

-- 6) dados do contrato
create or replace function public.dados_contrato_faltando(p_lead uuid)
returns text[] language sql stable as $$
  select array_remove(array[
    case when l.nome is null then 'nome_completo' end,
    case when l.cpf_cnpj is null then 'cpf_cnpj' end,
    case when nullif(trim(coalesce(l.endereco,'')),'') is null then 'endereco' end,
    case when l.email is null then 'email' end], null)
  from public.leads l where l.id = p_lead
$$;

drop function if exists public.iniciar_contratacao(uuid, text, text, text);
create or replace function public.iniciar_contratacao(p_conversa uuid, p_servico text, p_modalidade text, p_por text default 'ia', p_vencimento date default null)
returns jsonb language plpgsql as $$
declare
  l public.leads; v_lead uuid; v_mod text; v_parc numeric[]; v_total numeric; v_ct public.contratos;
  v_cob public.cobrancas; v_split jsonb; v_venc date; i int; v_tipo text; v_tem boolean;
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  select * into l from public.leads where id = v_lead;
  if l.id is null then return jsonb_build_object('ok', false, 'orientacao', 'Conversa não encontrada.'); end if;
  if p_servico not in ('diagnostico','limpa_nome','combo','rating') then
    return jsonb_build_object('ok', false, 'orientacao', 'Defina o serviço: diagnostico, limpa_nome, combo (Limpa Nome + Rating) ou rating.');
  end if;
  v_mod := public.normalizar_modalidade(p_servico, p_modalidade);
  if v_mod is null then
    return jsonb_build_object('ok', false, 'orientacao',
      case when p_servico = 'rating' then 'Pergunte ao lead qual forma prefere: à vista (avista) ou 2x (2x).' else 'Pergunte ao lead qual forma prefere: à vista (avista), 2x (2x) ou entrada + 5x (tap).' end);
  end if;

  -- sem Asaas: links fixos configurados no CRM (comportamento anterior)
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return public.link_pagamento(p_conversa, p_servico, v_mod);
  end if;

  if l.nome is null or l.cpf_cnpj is null then
    return jsonb_build_object('ok', false, 'orientacao',
      'Antes de gerar o link, peça o nome completo e o CPF ou CNPJ (só para emitir o pagamento no nome da pessoa) e salve com atualizar_ficha_lead.');
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
      'Lead pronto para pagar ' || public.servico_nome(p_servico) || ', mas falta o walletId de um beneficiário do split em Configurações.');
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
  if p_vencimento is not null and p_vencimento >= public.hoje() and p_vencimento <= public.hoje() + 45 then
    v_venc := p_vencimento;
  end if;
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
    'total', v_total, 'condicao', public.condicao_texto(p_servico, v_mod), 'vencimento', to_char(v_venc, 'DD/MM/YYYY'));
end $$;

create or replace function public.asaas_reservar_cobranca(p_cobranca uuid)
returns jsonb language plpgsql as $$
declare c public.cobrancas; ct public.contratos; l public.leads; v_split jsonb; v_tel text; v_custo numeric; v_base numeric; v_wcusto text;
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

  -- custo do produto: sai primeiro (até o total do contrato); comissão só sobre o que sobra
  select greatest(0, ct.custo_produto - coalesce(sum(x.custo_alocado), 0)) into v_custo
    from public.cobrancas x
   where x.contrato_id = ct.id and x.id <> c.id and x.status not in ('cancelada','a_cancelar','estornada');
  v_custo := least(coalesce(v_custo, 0), c.valor);
  v_base  := c.valor - v_custo;
  v_split := public.split_calcular(ct.servico, v_base);
  v_wcusto := nullif(trim(coalesce(public.cfg('custo_produto')->>'walletId', '')), '');
  if v_wcusto is not null and v_custo > 0 then
    v_split := v_split || jsonb_build_array(jsonb_build_object('nome', 'Custo do produto', 'walletId', v_wcusto,
                 'percentual', null, 'fixedValue', v_custo, 'tipo', 'custo'));
  end if;
  if coalesce((public.cfg_txt('split_obrigatorio'))::boolean, true)
     and exists (select 1 from jsonb_array_elements(v_split) s where s->>'walletId' is null and (s->>'fixedValue')::numeric > 0) then
    update public.cobrancas set erro = 'split_sem_walletid', tentativas = tentativas + 1 where id = c.id returning * into c;
    if c.tentativas = 3 then
      perform public.criar_alerta('erro', (select id from public.conversas where lead_id = c.lead_id),
        'Cobrança de ' || public.servico_nome(ct.servico) || ' parada: falta o walletId de um beneficiário do split em Configurações.');
    end if;
    return jsonb_build_object('ok', false, 'erro', 'split_sem_walletid');
  end if;
  v_split := coalesce((select jsonb_agg(s) from jsonb_array_elements(v_split) s where (s->>'fixedValue')::numeric > 0), '[]'::jsonb);

  update public.cobrancas set status = 'gerando', tentativas = tentativas + 1, split = v_split, custo_alocado = v_custo,
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
      'description', 'Advance · ' || public.servico_nome(ct.servico)
                     || ' · ' || public.rotulo_cobranca(c),
      'externalReference', c.id::text,
      'split', (select coalesce(jsonb_agg(jsonb_build_object('walletId', s->>'walletId', 'fixedValue', (s->>'fixedValue')::numeric,
                                  'description', case when s->>'tipo' = 'custo' then 'Custo do produto' else 'Comissão ' || (s->>'nome') end, 'externalReference', c.id::text || ':' || (s->>'nome'))), '[]'::jsonb)
                  from jsonb_array_elements(v_split) s)));
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
            where ct.servico <> 'diagnostico' and ct.status in ('ativo','inadimplente')
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

create or replace function public.atualizar_lead(p_conversa uuid, p jsonb)
returns jsonb language plpgsql as $$
declare v_lead uuid; l public.leads; v_doc text; v_erros text[] := '{}'; v_falta text[] := '{}';
begin
  select lead_id into v_lead from public.conversas where id = p_conversa;
  if v_lead is null then return jsonb_build_object('ok', false, 'erro','conversa_nao_encontrada'); end if;

  v_doc := nullif(regexp_replace(coalesce(p->>'cpf_cnpj',''), '\D', '', 'g'), '');
  if v_doc is not null and not public.documento_valido(v_doc) then
    v_erros := array_append(v_erros, 'cpf_cnpj_invalido');
    v_doc := null;
  end if;

  update public.leads set
    nome     = coalesce(nullif(trim(p->>'nome'),''), nome),
    cpf_cnpj = coalesce(v_doc, cpf_cnpj),
    email    = coalesce(nullif(lower(trim(p->>'email')),''), email),
    servico  = case when p->>'servico' in ('diagnostico','limpa_nome','combo','rating') then p->>'servico' else servico end,
    objetivo = coalesce(nullif(p->>'objetivo',''), objetivo),
    urgencia = case when p->>'urgencia' in ('alta','media','baixa') then p->>'urgencia' else urgencia end,
    consentimento_lgpd_em = case when coalesce((p->>'consentimento_lgpd')::boolean,false)
                                 then coalesce(consentimento_lgpd_em, now()) else consentimento_lgpd_em end,
    documento_recebido = documento_recebido or coalesce((p->>'documento_recebido')::boolean,false),
    endereco = coalesce(nullif(trim(p->>'endereco'),''), endereco),
    resumo   = coalesce(nullif(p->>'resumo',''), resumo)
  where id = v_lead
  returning * into l;

  -- com nome e documento já salvos, urgência não informada vira "media" (não trava o funil)
  if l.urgencia is null and l.nome is not null and l.cpf_cnpj is not null then
    update public.leads set urgencia = 'media' where id = v_lead returning * into l;
  end if;

  if l.nome is null then v_falta := array_append(v_falta, 'nome_completo'); end if;
  if l.cpf_cnpj is null then v_falta := array_append(v_falta, 'cpf_cnpj'); end if;
  if l.servico = 'indefinido' and l.objetivo is null then v_falta := array_append(v_falta, 'objetivo'); end if;

  if array_length(v_falta,1) is null then
    perform public.avancar_etapa(v_lead, 'qualificado');
  end if;

  return jsonb_build_object('ok', array_length(v_erros,1) is null, 'erros', v_erros,
                            'faltando', v_falta, 'qualificado', array_length(v_falta,1) is null,
                            'orientacao', 'Pergunte só o que falta, um por vez, e só se fizer sentido agora. Não repita perguntas já feitas. Endereço e e-mail só depois do pagamento, para o contrato.',
                            'dados_contrato_faltando', public.dados_contrato_faltando(v_lead),
                            'etapa', (select etapa from public.leads where id = v_lead));
end $$;

-- ficha do lead para a IA
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
    'servico_nome', public.servico_nome(l.servico),
    'endereco_informado', nullif(trim(coalesce(l.endereco,'')),'') is not null,
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
    'dados_contrato_faltando', case when l.pagamento_status = 'confirmado' and l.servico in ('limpa_nome','combo','rating')
                                    then public.dados_contrato_faltando(l.id) end,
    'equipe_ja_conversou', exists (select 1 from public.mensagens m where m.conversa_id = c.id and m.autor = 'humano'),
    'voce_ja_se_apresentou', exists (select 1 from public.mensagens m where m.conversa_id = c.id and m.autor in ('ia','humano')),
    'agora', public.data_pt(now(), true)
  )
  from public.conversas c join public.leads l on l.id = c.lead_id
  where c.id = p_conversa
$$;

-- notificações com o nome do serviço
create or replace function public.criar_notificacao(p_lead uuid, p_contrato uuid, p_cobranca uuid, p_tipo text,
                                                    p_modelo text, p_chave text, p_por text default 'sistema')
returns bigint language plpgsql as $$
declare c public.cobrancas; l public.leads; v_txt text; v_id bigint; v_serv text;
begin
  select * into l from public.leads where id = p_lead;
  select public.servico_nome(servico) into v_serv from public.contratos where id = p_contrato;
  if p_cobranca is not null then select * into c from public.cobrancas where id = p_cobranca; end if;
  v_txt := public.preencher_texto(coalesce(public.cfg('notif_textos')->>p_modelo, p_modelo), jsonb_build_object(
    'nome', split_part(coalesce(l.nome, l.nome_whatsapp, ''), ' ', 1),
    'servico', coalesce(v_serv, 'Limpa Nome'),
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
update public.config set valor = replace(valor::text, 'seu Limpa Nome', 'seu {servico}')::jsonb
 where chave = 'notif_textos' and valor::text like '%seu Limpa Nome%';

-- CRM: criar contrato (mensagem de erro sem LGPD)
create or replace function public.crm_criar_contrato(p_lead uuid, p_servico text, p_modalidade text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_conv uuid; r jsonb;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'erro', 'Ligue a cobrança pelo Asaas em Configurações para criar contratos pelo CRM.');
  end if;
  select id into v_conv from public.conversas where lead_id = p_lead;
  if v_conv is null then return jsonb_build_object('ok', false, 'erro', 'Este lead não tem conversa no WhatsApp.'); end if;
  r := public.iniciar_contratacao(v_conv, p_servico, p_modalidade, public.crm_email());
  if (r->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'erro', case when r->>'orientacao' like 'Antes de gerar o link%'
      then 'Preencha o nome completo e o CPF/CNPJ do lead antes de criar o contrato.'
      else coalesce(r->>'orientacao', 'Não foi possível criar o contrato.') end);
  end if;
  insert into public.auditoria (acao, detalhe, por)
  values ('contrato_criado_crm', jsonb_build_object('lead_id', p_lead, 'servico', p_servico, 'modalidade', p_modalidade), public.crm_email());
  return jsonb_build_object('ok', true, 'cobranca_id', r->>'cobranca_id', 'condicao', r->>'condicao', 'link', r->>'link');
end $$;

-- 5) conversa iniciada pela equipe: IA fica fora; o nome do WhatsApp da equipe não vira nome do lead
create or replace function public.registrar_mensagem_entrada(p jsonb)
returns jsonb language plpgsql as $$
declare v_me boolean := coalesce((p->>'from_me')::boolean, false); r jsonb;
        v_tel text := regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g');
begin
  if public.eh_numero_equipe(p->>'telefone')
     and not exists (select 1 from public.leads l
                      where l.telefone = v_tel
                        and exists (select 1 from public.contratos ct where ct.lead_id = l.id)) then
    return jsonb_build_object('acao', 'ignorar', 'motivo', 'numero_da_equipe');
  end if;
  if v_me then p := p - 'push_name'; end if;
  r := public.registrar_mensagem_entrada_base(p);
  if v_me and r->>'motivo' = 'humano_respondeu' then
    update public.conversas c set assumida_manual = true, assumida_por = 'equipe (iniciou a conversa)', assumida_em = now()
     where c.id = (r->>'conversa_id')::uuid and not c.assumida_manual
       and not exists (select 1 from public.mensagens m where m.conversa_id = c.id and m.autor in ('lead','ia'));
  end if;
  return r;
end $$;

-- dados atuais: nome "Advance" veio do WhatsApp da equipe; conversas abertas pela equipe ficam com a equipe
update public.leads l set nome_whatsapp = null
 where l.nome_whatsapp = 'Advance'
   and not exists (select 1 from public.mensagens m where m.lead_id = l.id and m.autor = 'lead' and m.id = (
         select min(id) from public.mensagens x where x.lead_id = l.id));
update public.conversas c set assumida_manual = true, assumida_por = 'equipe (iniciou a conversa)', assumida_em = now()
 where not c.assumida_manual
   and (select m.autor from public.mensagens m where m.conversa_id = c.id order by m.id limit 1) = 'humano';

-- base de conhecimento
update public.kb set ativo = false where pergunta in ('Formas de pagamento');
insert into public.kb (categoria, pergunta, resposta, palavras)
select v.categoria, v.pergunta, v.resposta, v.palavras
  from (values
    ('pagamento', 'Formas de pagamento',
     'Somente PIX ou boleto (não trabalhamos com cartão). Diagnóstico: R$ 67,00 à vista. Limpa Nome: à vista R$ 597,00, 2x de R$ 400,00 (a 2ª com o nome limpo) ou TAP (entrada de R$ 297,00 + 5x de R$ 150,00, a 1ª com o nome limpo). Combo Limpa Nome + Rating: à vista R$ 1.500,00, 2x de R$ 900,00 ou TAP (R$ 597,00 + 5x de R$ 297,00). Rating sozinho: à vista R$ 997,00 ou 2x de R$ 600,00. Dá pra escolher o dia do pagamento.',
     'forma pagamento pix boleto cartão cartao parcelar parcelado dia data vencimento'),
    ('rating', 'O que é o Rating? O que é a atualização de Rating?',
     'Rating é a nota interna que os bancos dão a cada cliente, de A a E. A nota A é a melhor e facilita a aprovação de qualquer crédito. Na atualização a gente faz um levantamento do seu perfil, você envia alguns documentos, a gente corrige os mais de 27 fatores que derrubam o rating e te entrega um relatório com o antes e depois, junto com um guia prático do que fazer nos 45 dias seguintes pra consolidar a nova nota.',
     'rating nota banco a b c d e score crédito credito atualizar atualização aprovar financiamento'),
    ('rating', 'Para quem é o Rating?',
     'Para quem quer crédito, financiamento de imóvel ou veículo, empréstimo ou cartão e continua sendo recusado pelos bancos por causa do rating baixo.',
     'rating para quem crédito negado recusado financiamento empréstimo cartão'),
    ('rating', 'Quanto custa o Combo Limpa Nome + Rating?',
     'O valor de tabela do combo é R$ 1.797,00. À vista sai por R$ 1.500,00, com R$ 297,00 de desconto. Em 2x fica R$ 900,00 na contratação e R$ 900,00 na entrega do serviço. Ou na condição TAP: entrada de R$ 597,00 + 5x de R$ 297,00, a 1ª quando o nome estiver limpo. Prazo de até 30 dias.',
     'combo limpa nome rating preço preco valor quanto custa pacote'),
    ('rating', 'Quanto custa o Rating sozinho?',
     'O Rating sozinho é para quem já está com o nome limpo e quer crédito. Valor de tabela R$ 1.200,00: à vista sai por R$ 997,00 ou em 2x de R$ 600,00. Ele já inclui o diagnóstico. Prazo de até 30 dias.',
     'rating sozinho avulso nome limpo preço preco valor quanto custa'),
    ('limpa_nome', 'Vocês fazem limpa Bacen?',
     'Não. A gente trabalha só com a limpeza nos órgãos de proteção ao crédito: SPC, Serasa e Boa Vista. Não fazemos o chamado limpa Bacen.',
     'bacen banco central scr limpa bacen'),
    ('diagnostico', 'O valor do Diagnóstico é abatido do Limpa Nome?',
     'Não. O Diagnóstico é um produto à parte, de R$ 67,00, e não é abatido do Limpa Nome. Ele dá direito a uma reunião exclusiva com um gerente de crédito.',
     'diagnóstico diagnostico abate abatido desconta desconto 67 incluso embutido'),
    ('diagnostico', 'Como funciona o Diagnóstico? Vocês consultam meu CPF de graça?',
     'O Diagnóstico custa R$ 67,00. Depois do pagamento a gente puxa todas as informações do seu CPF, te envia o relatório completo em PDF e você pode agendar uma reunião com um gerente de crédito para analisar e montar a estratégia. A consulta só é feita depois do pagamento.',
     'diagnóstico diagnostico consulta consultar cpf grátis gratis pendências pendencias restrições pdf relatório'),
    ('limpa_nome', 'Em quanto tempo o nome fica limpo? (prazo)',
     'O prazo é de até 30 dias, mas nas últimas listas a gente tem entregado em cerca de 7 dias úteis. Você recebe um link de acompanhamento pra ver em tempo real como está o processo, e o contrato.',
     'prazo tempo quanto tempo demora dias limpo acompanhamento'),
    ('limpa_nome', 'Como funciona o Limpa Nome? É legal?',
     'É uma ação judicial baseada no Código de Defesa do Consumidor (Lei 8.078). Pelo processo é concedida uma liminar que retira as restrições do seu nome nos órgãos de proteção ao crédito: Serasa, SPC e Boa Vista.',
     'como funciona legal lei liminar ação acao judicial código defesa consumidor 8078')
  ) as v(categoria, pergunta, resposta, palavras)
 where not exists (select 1 from public.kb k where k.pergunta = v.pergunta and k.ativo);
update public.kb set resposta = 'Não. Cenprot e protestos que estão só no cartório não saem no momento. Saem os protestos que estiverem aparecendo no Serasa.'
 where pergunta = 'Remove protesto do Cenprot / cartório?';
update public.kb set resposta =
  'O valor de tabela do Limpa Nome é R$ 797,00. Hoje são três formas, só por PIX ou boleto: à vista R$ 597,00, com R$ 200,00 de desconto promocional; em 2x de R$ 400,00, a 1ª na contratação e a 2ª só quando o nome estiver limpo (total R$ 800,00); ou na condição TAP: entrada de R$ 297,00 na contratação e 5x de R$ 150,00, a 1ª quando o nome estiver limpo e as outras a cada 30 dias (total R$ 1.047,00). Não há outro desconto.'
 where pergunta = 'Quanto custa o Limpa Nome?';
update public.kb set resposta =
  'TAP é a Taxa Administrativa Processual: a entrada de R$ 297,00 cobre a abertura e o custeio inicial do processo. Depois são 5x de R$ 150,00: a 1ª quando o seu nome estiver limpo e as outras a cada 30 dias. O total de R$ 1.047,00 é o valor de tabela (R$ 797,00) mais R$ 250,00 do parcelamento estendido.'
 where pergunta = 'O que é a TAP? Por que a entrada é R$ 297?';

-- parcela liberada com vencimento próximo (ex.: nome limpo): o link vai na hora
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
    continue when s->>'tipo' = 'custo';
    v_nome := s->>'nome';
    select x into sp from jsonb_array_elements(coalesce(p_payment->'split','[]'::jsonb)) x
     where x->>'walletId' = s->>'walletId' limit 1;
    insert into public.comissoes (cobranca_id, contrato_id, lead_id, beneficiario, wallet_id, base, percentual, valor, asaas_split_id)
    values (c.id, c.contrato_id, c.lead_id, v_nome, s->>'walletId', c.valor - c.custo_alocado, (s->>'percentual')::numeric,
            coalesce((sp->>'fixedValue')::numeric, (s->>'fixedValue')::numeric), sp->>'id')
    on conflict (cobranca_id, beneficiario) do update
      set wallet_id = excluded.wallet_id, valor = excluded.valor,
          asaas_split_id = coalesce(excluded.asaas_split_id, public.comissoes.asaas_split_id);
  end loop;

  -- criada pela rotina (não na hora da conversa): manda o link para o cliente
  if p_origem = 'rotina' and c.invoice_url is not null
     and (c.numero = 1 or c.tipo = 'quitacao' or c.vencimento <= public.hoje() + 3) then
    perform public.criar_notificacao(c.lead_id, c.contrato_id, c.id,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link_pagamento' end,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
      'link:' || c.id::text);
  end if;
  return jsonb_build_object('ok', true, 'link', c.invoice_url, 'valor', c.valor, 'cobranca_id', c.id,
                            'condicao', public.condicao_texto(ct.servico, ct.modalidade));
end $$;
