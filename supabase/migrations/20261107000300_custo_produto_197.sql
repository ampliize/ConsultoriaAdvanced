-- =====================================================================
-- Custo fixo do produto (R$ 197 por contrato do Limpa Nome)
-- O custo é recuperado do primeiro pagamento efetivamente cobrado; a
-- comissão (12,5% + 12,5%) incide só sobre o que sobra de cada pagamento:
--   base distribuível = valor do pagamento - custo ainda não recuperado
--   TAP: entrada 297 → base 100 → comissão 25,00 · parcelas 150 → 37,50 cada (total 212,50)
--   À vista 597 → base 400 → 100,00 · 2x: 400 → 203 → 50,75 e 400 → 100,00 (total 150,75)
-- O custo fica na conta que emite a cobrança; se 'custo_produto.walletId' for
-- preenchido, ele vai por split para essa carteira (fornecedor).
-- =====================================================================

insert into public.config (chave, valor, descricao) values
  ('custo_produto', '{"valor":197,"walletId":"","servicos":["limpa_nome"]}',
   'Custo fixo por contrato, recuperado do 1º pagamento antes da comissão (walletId opcional para repassar ao fornecedor)')
on conflict (chave) do nothing;

alter table public.contratos add column if not exists custo_produto numeric(10,2) not null default 0;
alter table public.cobrancas add column if not exists custo_alocado numeric(10,2) not null default 0;

-- novo contrato recebe o custo vigente do serviço
create or replace function public.tg_contrato_custo() returns trigger language plpgsql as $$
begin
  if coalesce(new.custo_produto, 0) = 0
     and coalesce(public.cfg('custo_produto')->'servicos', '["limpa_nome"]'::jsonb) ? new.servico then
    new.custo_produto := least(coalesce((public.cfg('custo_produto')->>'valor')::numeric, 0), new.valor_total);
  end if;
  return new;
end $$;
drop trigger if exists contratos_custo on public.contratos;
create trigger contratos_custo before insert on public.contratos for each row execute function public.tg_contrato_custo();

-- contratos de Limpa Nome já existentes ainda sem pagamento passam a ter o custo
update public.contratos set custo_produto = least(197, valor_total)
 where servico = 'limpa_nome' and custo_produto = 0 and status = 'aguardando_pagamento';

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
        'Cobrança do Limpa Nome parada: falta o walletId de um beneficiário do split em Configurações.');
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
      'description', 'Advance · ' || case ct.servico when 'diagnostico' then 'Diagnóstico de crédito' else 'Limpa Nome' end
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
  if p_origem = 'rotina' and c.invoice_url is not null and (c.numero = 1 or c.tipo = 'quitacao') then
    perform public.criar_notificacao(c.lead_id, c.contrato_id, c.id,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link_pagamento' end,
      case when c.tipo = 'quitacao' then 'quitacao' else 'link' end,
      'link:' || c.id::text);
  end if;
  return jsonb_build_object('ok', true, 'link', c.invoice_url, 'valor', c.valor, 'cobranca_id', c.id,
                            'condicao', public.condicao_texto(ct.servico, ct.modalidade));
end $$;

-- resumo e visão do CRM com o custo
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
