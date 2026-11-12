-- Cobrança gerada pela equipe dentro do CRM (aba Conversas) + ajustes do diagnóstico de 11/11/2026.
-- 1) crm_gerar_cobranca: produto da tabela (Limpa Nome, Combo, Rating, Diagnóstico) ou cobrança
--    personalizada (descrição, valor, vencimento, parcelas, com ou sem comissão). O link sai pelo Asaas.
-- 2) Serviço "personalizada" nos contratos; split forçado por contrato (com_split).
-- 3) Data inválida vinda da IA não derruba mais o ADV · Contratar (data_segura).
-- 4) Aviso opcional do 1º pagamento (vence hoje / venceu), desligado por padrão.
-- Nada aqui altera cobranças, contratos ou comissões que já existem.

create or replace function public.data_segura(p text)
returns date language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

alter table public.contratos drop constraint if exists contratos_servico_check;
alter table public.contratos add constraint contratos_servico_check
  check (servico in ('diagnostico','limpa_nome','combo','rating','personalizada'));
alter table public.contratos drop constraint if exists contratos_modalidade_check;
alter table public.contratos add constraint contratos_modalidade_check
  check (modalidade in ('avista','2x','tap','personalizada'));
alter table public.contratos add column if not exists descricao text;
alter table public.contratos add column if not exists com_split boolean not null default true;
alter table public.contratos add column if not exists parcelas_aguardam_entrega boolean not null default false;
alter table public.cobrancas add column if not exists enviar_link boolean not null default true;
-- pagamento de cobrança personalizada confirma o lead sem quebrar a regra de forma de pagamento
alter table public.leads drop constraint if exists leads_forma_pagamento_check;
alter table public.leads add constraint leads_forma_pagamento_check
  check (forma_pagamento in ('avista','2x','tap','personalizada'));

-- um cliente pode ter mais de uma cobrança personalizada em aberto
drop index if exists public.contratos_aberto_uq;
create unique index contratos_aberto_uq on public.contratos (lead_id, servico)
  where status in ('aguardando_pagamento','ativo','inadimplente') and servico <> 'personalizada';

insert into public.config (chave, valor, descricao) values
  ('notif_primeira_cobranca', 'false', 'Avisar o lead quando o link do 1º pagamento vence hoje ou venceu (usa os dias de atraso dos avisos)')
on conflict (chave) do nothing;
update public.config set valor = valor || jsonb_build_object(
    'primeira_hoje', 'Oi, {nome}! O link de pagamento do seu {servico}, de {valor}, vence hoje. Dá pra pagar por PIX ou boleto aqui: {link}',
    'primeira_vencida', '{nome}, o link de pagamento do seu {servico}, de {valor}, venceu em {vencimento}. Ainda dá pra pagar por ele: {link}. Se preferir outra data, é só me dizer.')
 where chave = 'notif_textos' and not (valor ? 'primeira_hoje');

drop function if exists public.split_calcular(text, numeric);

create or replace function public.split_calcular(p_servico text, p_valor numeric, p_forcar boolean default false)
returns jsonb language plpgsql stable as $$
declare b jsonb := coalesce(public.cfg('split_beneficiarios'), '[]'::jsonb);
        n int; i int; v numeric; v_total numeric; v_acc numeric := 0; v_pct numeric; v_out jsonb := '[]'::jsonb;
begin
  if not p_forcar and not (coalesce(public.cfg('split_servicos'), '["limpa_nome"]'::jsonb) ? p_servico) then return v_out; end if;
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

create or replace function public.servico_nome(p_servico text)
returns text language sql immutable as $$
  select case p_servico when 'diagnostico' then 'Diagnóstico de crédito' when 'limpa_nome' then 'Limpa Nome'
                        when 'combo' then 'Limpa Nome + Rating' when 'rating' then 'Atualização de Rating'
                        when 'personalizada' then 'Cobrança personalizada' else p_servico end
$$;

create or replace function public.condicao_texto(p_servico text, p_modalidade text)
returns text language sql stable as $$
  select case
    when p_servico = 'personalizada' then 'cobrança personalizada (PIX ou boleto)'
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

create or replace function public.rotulo_cobranca(c public.cobrancas)
returns text language sql stable as $$
  select case
    when c.tipo = 'adesao' then 'entrada'
    when c.tipo = 'quitacao' then 'quitação do saldo'
    when c.tipo = 'avista' then 'pagamento à vista'
    when c.tipo = 'unica' then 'Diagnóstico de crédito'
    when ct.modalidade = 'tap' or (ct.modalidade = 'personalizada' and exists (select 1 from public.cobrancas x where x.contrato_id = c.contrato_id and x.tipo = 'adesao')) then 'parcela ' || (c.numero - 1) || ' de '
         || (select count(*) - 1 from public.cobrancas x where x.contrato_id = c.contrato_id and x.tipo in ('adesao','parcela'))
    else 'parcela ' || c.numero || ' de '
         || (select count(*) from public.cobrancas x where x.contrato_id = c.contrato_id and x.tipo = 'parcela')
  end
  from public.contratos ct where ct.id = c.contrato_id
$$;

create or replace function public.tg_2x_aguarda_nome_limpo()
returns trigger language plpgsql as $$
declare ct public.contratos;
begin
  if new.status = 'planejada' and new.numero > 1 and new.vencimento is not null then
    select * into ct from public.contratos where id = new.contrato_id;
    if (ct.modalidade in ('2x','tap') or ct.parcelas_aguardam_entrega) and coalesce(ct.processo_etapa, '') not in ('baixa', 'concluido') then
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
   where ct.id = c.contrato_id and ct.id = p_contrato and (ct.modalidade in ('2x','tap') or ct.parcelas_aguardam_entrega)
     and ct.status in ('ativo', 'inadimplente')
     and ct.processo_etapa in ('baixa', 'concluido')
     and c.status = 'planejada' and c.vencimento is null and c.numero > 1;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.criar_notificacao(p_lead uuid, p_contrato uuid, p_cobranca uuid, p_tipo text,
                                                    p_modelo text, p_chave text, p_por text default 'sistema')
returns bigint language plpgsql as $$
declare c public.cobrancas; l public.leads; v_txt text; v_id bigint; v_serv text;
begin
  select * into l from public.leads where id = p_lead;
  select coalesce(nullif(trim(descricao), ''), public.servico_nome(servico)) into v_serv from public.contratos where id = p_contrato;
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

create or replace function public.notificacoes_devidas()
returns setof jsonb language plpgsql as $$
declare
  r record; d int; v_hoje date := public.hoje();
  v_lemb int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('notif_lembrete_dias'))::int), '{3,0}');
  v_venc int[] := coalesce(array(select jsonb_array_elements_text(public.cfg('notif_vencida_dias'))::int), '{1,5}');
  v_jan jsonb := coalesce(public.cfg('notif_janela'), '{"inicio":"08:00","fim":"20:00"}'::jsonb);
  v_agora time := (now() at time zone 'America/Maceio')::time;
  v_prim boolean := coalesce((public.cfg_txt('notif_primeira_cobranca'))::boolean, false);
  v_pri boolean;
begin
  if public.sdr_pausado() then return; end if;

  -- lembretes antes do vencimento e avisos de atraso (só clientes com contrato ativo)
  for r in select c.*, ct.status as ct_status from public.cobrancas c join public.contratos ct on ct.id = c.contrato_id
            where ((ct.servico <> 'diagnostico' and ct.status in ('ativo','inadimplente'))
                   -- 1º pagamento ainda não feito: só com a opção ligada em Configurações · Avisos
                   or (v_prim and ct.status = 'aguardando_pagamento' and c.numero = 1))
              and c.status in ('pendente','vencida') and c.invoice_url is not null and c.vencimento is not null loop
    d := r.vencimento - v_hoje;
    v_pri := r.ct_status = 'aguardando_pagamento';
    if v_pri and d > 0 then
      null;  -- link recém-enviado: não lembra antes do dia
    elsif r.status = 'pendente' and d = any(v_lemb) then
      perform public.criar_notificacao(r.lead_id, r.contrato_id, r.id, 'lembrete',
        case when v_pri then 'primeira_hoje' when d = 0 then 'lembrete_hoje' else 'lembrete' end, 'lembrete:' || r.id || ':' || d);
    elsif d < 0 and (-d) = any(v_venc) then
      perform public.criar_notificacao(r.lead_id, r.contrato_id, r.id, 'vencida', case when v_pri then 'primeira_vencida' else 'vencida' end, 'vencida:' || r.id || ':' || (-d));
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
  v_split := case when ct.servico = 'personalizada'
               then case when ct.com_split then public.split_calcular('personalizada', v_base, true) else '[]'::jsonb end
               else public.split_calcular(ct.servico, v_base) end;
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
        'Cobrança de ' || coalesce(nullif(trim(ct.descricao), ''), public.servico_nome(ct.servico)) || ' parada: falta o walletId de um beneficiário do split em Configurações.');
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
      'description', 'Advance · ' || coalesce(nullif(trim(ct.descricao), ''), public.servico_nome(ct.servico))
                     || ' · ' || public.rotulo_cobranca(c),
      'externalReference', c.id::text,
      'split', (select coalesce(jsonb_agg(jsonb_build_object('walletId', s->>'walletId', 'fixedValue', (s->>'fixedValue')::numeric,
                                  'description', case when s->>'tipo' = 'custo' then 'Custo do produto' else 'Comissão ' || (s->>'nome') end, 'externalReference', c.id::text || ':' || (s->>'nome'))), '[]'::jsonb)
                  from jsonb_array_elements(v_split) s)));
end $$;

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
  if p_origem = 'rotina' and c.invoice_url is not null and c.enviar_link
     and (c.numero = 1 or c.tipo = 'quitacao' or c.vencimento <= public.hoje() + 3) then
    perform public.criar_notificacao(c.lead_id, c.contrato_id, c.id,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link_pagamento' end,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
      'link:' || c.id::text);
  end if;
  return jsonb_build_object('ok', true, 'link', c.invoice_url, 'valor', c.valor, 'cobranca_id', c.id,
                            'condicao', public.condicao_texto(ct.servico, ct.modalidade));
end $$;

-- ---------------------------------------------------------------------
-- CRM · Gerar cobrança (aba Conversas)
-- ---------------------------------------------------------------------
create or replace function public.crm_gerar_cobranca(p_lead uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.leads; v_conv uuid; v_doc text; v_nome text; v_email text; v_end text; r jsonb; v_tipo text := coalesce(p->>'tipo', 'produto');
  v_venc date; v_valor numeric; v_desc text; v_n int; v_vparc numeric; v_aguarda boolean; v_split boolean; v_custo numeric;
  v_total numeric; v_ct public.contratos; v_cob uuid; v_enviar boolean := coalesce((p->>'enviar_link')::boolean, true); i int; s jsonb;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  if coalesce((public.cfg_txt('asaas_ativo'))::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'erro', 'Ligue a cobrança pelo Asaas em Configurações para gerar cobranças pelo CRM.');
  end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then return jsonb_build_object('ok', false, 'erro', 'Lead não encontrado.'); end if;
  select id into v_conv from public.conversas where lead_id = p_lead;
  if v_conv is null then return jsonb_build_object('ok', false, 'erro', 'Este lead não tem conversa no WhatsApp.'); end if;

  -- dados do cliente (o que vier preenchido substitui; vazio mantém o que já existe)
  v_nome  := nullif(trim(coalesce(p->>'nome', '')), '');
  v_doc   := nullif(regexp_replace(coalesce(p->>'cpf_cnpj', ''), '\D', '', 'g'), '');
  v_email := nullif(lower(trim(coalesce(p->>'email', ''))), '');
  v_end   := nullif(trim(coalesce(p->>'endereco', '')), '');
  if v_doc is not null and not public.documento_valido(v_doc) then
    return jsonb_build_object('ok', false, 'erro', 'CPF ou CNPJ inválido. Confira os números.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'erro', 'E-mail inválido.');
  end if;
  if coalesce(v_nome, l.nome) is null or coalesce(v_doc, l.cpf_cnpj) is null then
    return jsonb_build_object('ok', false, 'erro', 'Preencha o nome completo e o CPF ou CNPJ do cliente.');
  end if;
  update public.leads set nome = coalesce(v_nome, nome), cpf_cnpj = coalesce(v_doc, cpf_cnpj),
         email = coalesce(v_email, email), endereco = coalesce(v_end, endereco)
   where id = p_lead returning * into l;

  v_venc := public.data_segura(p->>'vencimento');
  if v_venc is not null and (v_venc < public.hoje() or v_venc > public.hoje() + 60) then
    return jsonb_build_object('ok', false, 'erro', 'O vencimento precisa ser de hoje até 60 dias.');
  end if;

  -- produto da tabela: mesma regra da IA (contrato, parcelas, custo e split do produto)
  if v_tipo = 'produto' then
    r := public.iniciar_contratacao(v_conv, p->>'servico', p->>'modalidade', public.crm_email(),
                                    case when v_venc is not null then least(v_venc, public.hoje() + 45) end);
    if (r->>'ok')::boolean is not true then
      return jsonb_build_object('ok', false, 'erro', coalesce(r->>'orientacao', 'Não foi possível gerar a cobrança.'));
    end if;
    v_cob := (r->>'cobranca_id')::uuid;
    update public.cobrancas set enviar_link = v_enviar where id = v_cob;
    insert into public.auditoria (acao, detalhe, por)
    values ('cobranca_crm', jsonb_build_object('lead_id', p_lead, 'tipo', 'produto', 'servico', p->>'servico', 'modalidade', p->>'modalidade',
            'vencimento', v_venc, 'enviar_link', v_enviar), public.crm_email());
    return jsonb_build_object('ok', true, 'cobranca_id', v_cob, 'link', r->>'link', 'valor', (r->>'valor')::numeric,
                              'condicao', r->>'condicao', 'enviar_link', v_enviar);
  end if;

  if v_tipo <> 'personalizada' then return jsonb_build_object('ok', false, 'erro', 'Tipo de cobrança desconhecido.'); end if;

  -- cobrança personalizada
  v_desc  := nullif(trim(regexp_replace(coalesce(p->>'descricao', ''), '\s+', ' ', 'g')), '');
  v_valor := round(coalesce((p->>'valor')::numeric, 0), 2);
  v_n     := coalesce((p->>'parcelas')::int, 0);
  v_vparc := round(coalesce((p->>'valor_parcela')::numeric, 0), 2);
  v_aguarda := coalesce((p->>'aguardar_entrega')::boolean, false) and v_n > 0;
  v_split := coalesce((p->>'com_split')::boolean, true);
  v_custo := round(coalesce((p->>'custo')::numeric, 0), 2);
  if v_desc is null or length(v_desc) < 3 then return jsonb_build_object('ok', false, 'erro', 'Descreva o que está sendo cobrado.'); end if;
  if length(v_desc) > 120 then return jsonb_build_object('ok', false, 'erro', 'Descrição muito longa (até 120 letras).'); end if;
  if v_valor < 5 then return jsonb_build_object('ok', false, 'erro', 'O valor mínimo é R$ 5,00.'); end if;
  if v_valor > 50000 or v_vparc > 50000 then return jsonb_build_object('ok', false, 'erro', 'Valor acima do limite de R$ 50.000,00. Confira.'); end if;
  if v_n < 0 or v_n > 12 then return jsonb_build_object('ok', false, 'erro', 'Parcelas adicionais: de 0 a 12.'); end if;
  if v_n > 0 and v_vparc < 5 then return jsonb_build_object('ok', false, 'erro', 'Informe o valor de cada parcela (mínimo R$ 5,00).'); end if;
  v_total := v_valor + v_n * v_vparc;
  if v_custo < 0 or v_custo > v_total then return jsonb_build_object('ok', false, 'erro', 'O custo não pode ser maior que o total cobrado.'); end if;

  if v_split and coalesce((public.cfg_txt('split_obrigatorio'))::boolean, true) then
    for s in select * from jsonb_array_elements(public.split_calcular('personalizada', v_valor, true)) loop
      if s->>'walletId' is null and (s->>'fixedValue')::numeric > 0 then
        return jsonb_build_object('ok', false, 'erro', 'Falta a carteira (walletId) de um beneficiário em Configurações · Split e comissões.');
      end if;
    end loop;
  end if;

  insert into public.contratos (lead_id, servico, modalidade, valor_total, criado_por, descricao, com_split, custo_produto, parcelas_aguardam_entrega)
  values (p_lead, 'personalizada', 'personalizada', v_total, public.crm_email(), v_desc, v_split, v_custo, v_aguarda)
  returning * into v_ct;

  v_venc := coalesce(v_venc, public.hoje() + coalesce((public.cfg_txt('asaas_dias_vencimento'))::int, 2));
  insert into public.cobrancas (contrato_id, lead_id, numero, tipo, valor, vencimento, status, enviar_link)
  values (v_ct.id, p_lead, 1, case when v_n > 0 then 'adesao' else 'avista' end, v_valor, v_venc, 'a_gerar', v_enviar)
  returning id into v_cob;
  for i in 1 .. v_n loop
    insert into public.cobrancas (contrato_id, lead_id, numero, tipo, valor, vencimento, status)
    values (v_ct.id, p_lead, i + 1, 'parcela', v_vparc,
            case when v_aguarda then null else (v_venc + make_interval(months => i))::date end, 'planejada');
  end loop;

  update public.leads set valor_previsto = v_total,
         pagamento_status = case when pagamento_status = 'nenhum' then 'link_enviado' else pagamento_status end
   where id = p_lead;
  perform set_config('adv.por', public.crm_email(), true);
  perform public.avancar_etapa(p_lead, 'proposta');
  insert into public.auditoria (acao, detalhe, por)
  values ('cobranca_crm', jsonb_build_object('lead_id', p_lead, 'tipo', 'personalizada', 'contrato_id', v_ct.id, 'descricao', v_desc,
          'valor', v_valor, 'parcelas', v_n, 'valor_parcela', v_vparc, 'aguardar_entrega', v_aguarda, 'com_split', v_split,
          'custo', v_custo, 'vencimento', v_venc, 'enviar_link', v_enviar), public.crm_email());
  return jsonb_build_object('ok', true, 'cobranca_id', v_cob, 'valor', v_valor, 'total', v_total, 'enviar_link', v_enviar);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'erro', 'Confira os valores digitados.');
end $$;
revoke execute on function public.crm_gerar_cobranca(uuid, jsonb) from public, anon;
grant execute on function public.crm_gerar_cobranca(uuid, jsonb) to authenticated;

-- a equipe manda o link de uma cobrança já gerada para o cliente (botão "Enviar na conversa")
create or replace function public.crm_enviar_link_cobranca(p_cobranca uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cobrancas; v_id bigint;
begin
  if not public.is_crm_user() then raise exception 'sem acesso'; end if;
  select * into c from public.cobrancas where id = p_cobranca;
  if c.id is null or c.invoice_url is null then return jsonb_build_object('ok', false, 'erro', 'O link ainda não foi gerado.'); end if;
  if c.status not in ('pendente','vencida') then return jsonb_build_object('ok', false, 'erro', 'Esta cobrança não está mais em aberto.'); end if;
  v_id := public.criar_notificacao(c.lead_id, c.contrato_id, c.id,
            case when c.tipo = 'quitacao' then 'quitacao' else 'link_pagamento' end,
            case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
            'link:' || c.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), public.crm_email());
  return jsonb_build_object('ok', true, 'notificacao_id', v_id);
end $$;
revoke execute on function public.crm_enviar_link_cobranca(uuid) from public, anon;
grant execute on function public.crm_enviar_link_cobranca(uuid) to authenticated;

-- visão dos contratos com os campos novos (descrição, com_split)
drop view if exists public.vw_contratos;
create view public.vw_contratos with (security_invoker = true) as
select ct.*, l.nome, l.nome_whatsapp, l.telefone, l.cpf_cnpj, l.email,
       r.pago, r.saldo_devedor, r.vencido, r.pagamentos_feitos, r.pagamentos_total, r.custo_recuperado
from public.contratos ct
join public.leads l on l.id = ct.lead_id
cross join lateral (
  select coalesce(sum(c.valor_pago) filter (where c.status in ('confirmada','recebida')), 0) as pago,
         coalesce(sum(c.valor) filter (where c.status in ('planejada','a_gerar','gerando','pendente','vencida')), 0) as saldo_devedor,
         coalesce(sum(c.valor) filter (where c.status = 'vencida'), 0) as vencido,
         count(*) filter (where c.status in ('confirmada','recebida')) as pagamentos_feitos,
         count(*) filter (where c.status <> 'cancelada' and c.tipo <> 'quitacao') as pagamentos_total,
         coalesce(sum(c.custo_alocado) filter (where c.status in ('confirmada','recebida')), 0) as custo_recuperado
  from public.cobrancas c where c.contrato_id = ct.id) r;
grant select on public.vw_contratos to authenticated;
