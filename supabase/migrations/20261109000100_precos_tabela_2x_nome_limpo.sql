-- Tabela de preços do Limpa Nome (documento de precificação, 09/11/2026)
--   Tabela (preço cheio): R$ 797,00
--   À vista: R$ 597,00 (R$ 200,00 de desconto promocional)
--   2x: R$ 400,00 na contratação + R$ 400,00 quando o nome estiver limpo (total R$ 800,00)
--   TAP: entrada R$ 297,00 (Taxa Administrativa Processual) + 5x R$ 150,00 (total R$ 1.047,00)
-- Mudança no sistema: a 2ª parcela do 2x NÃO vence em 30 dias. Ela fica sem data até o
-- CRM marcar o processo em "Restrições baixadas" (ou "Processo concluído"); aí é gerada no Asaas.

insert into public.config (chave, valor, descricao) values
  ('limpa_nome_valor_tabela', '797', 'Valor de tabela (preço cheio) do Limpa Nome, usado como referência pela IA')
on conflict (chave) do nothing;

create or replace function public.condicao_texto(p_servico text, p_modalidade text)
returns text language sql stable as $$
  select case
    when p_servico = 'diagnostico' then public.brl((public.plano_parcelas('diagnostico','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = 'avista' then public.brl((public.plano_parcelas('limpa_nome','avista'))[1]) || ' à vista (PIX ou boleto)'
    when p_modalidade = '2x' then '2x de ' || public.brl((public.plano_parcelas('limpa_nome','2x'))[1])
                                  || ': a 1ª agora e a 2ª só quando o seu nome estiver limpo (PIX ou boleto)'
    else 'Entrada de ' || public.brl((public.plano_parcelas('limpa_nome','tap'))[1]) || ' + '
         || (array_length(public.plano_parcelas('limpa_nome','tap'),1) - 1) || 'x de '
         || public.brl((public.plano_parcelas('limpa_nome','tap'))[2]) || ' mensais (PIX ou boleto)'
  end
$$;

-- 2ª parcela do 2x: só ganha vencimento depois da baixa das restrições
create or replace function public.tg_2x_aguarda_nome_limpo()
returns trigger language plpgsql as $$
declare ct public.contratos;
begin
  if new.status = 'planejada' and new.numero > 1 and new.vencimento is not null then
    select * into ct from public.contratos where id = new.contrato_id;
    if ct.modalidade = '2x' and coalesce(ct.processo_etapa, '') not in ('baixa', 'concluido') then
      new.vencimento := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_2x_aguarda_nome_limpo on public.cobrancas;
create trigger tg_2x_aguarda_nome_limpo before insert or update of vencimento, status on public.cobrancas
  for each row execute function public.tg_2x_aguarda_nome_limpo();

-- libera a 2ª parcela quando o andamento chega em "baixa" ou "concluido"
create or replace function public.liberar_parcela_final_2x(p_contrato uuid)
returns int language plpgsql as $$
declare n int;
begin
  update public.cobrancas c
     set vencimento = public.hoje() + coalesce((public.cfg_txt('asaas_dias_vencimento'))::int, 2)
    from public.contratos ct
   where ct.id = c.contrato_id and ct.id = p_contrato and ct.modalidade = '2x'
     and ct.status in ('ativo', 'inadimplente')
     and ct.processo_etapa in ('baixa', 'concluido')
     and c.status = 'planejada' and c.vencimento is null and c.numero > 1;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'crm_andamento_processo_base') then
    alter function public.crm_andamento_processo(uuid, text, text, boolean) rename to crm_andamento_processo_base;
  end if;
end $$;

create or replace function public.crm_andamento_processo(p_contrato uuid, p_etapa text, p_detalhe text default null, p_enviar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := public.crm_andamento_processo_base(p_contrato, p_etapa, p_detalhe, p_enviar);
  if coalesce((r->>'ok')::boolean, false) then
    n := public.liberar_parcela_final_2x(p_contrato);
    if n > 0 then r := r || jsonb_build_object('parcela_final_liberada', true); end if;
  end if;
  return r;
end $$;
revoke all on function public.crm_andamento_processo(uuid, text, text, boolean) from public;
grant execute on function public.crm_andamento_processo(uuid, text, text, boolean) to authenticated;
revoke all on function public.crm_andamento_processo_base(uuid, text, text, boolean) from public, anon, authenticated;

-- contratos 2x já ativos: a 2ª parcela ainda não gerada volta a esperar o nome limpo
update public.cobrancas c set vencimento = null
  from public.contratos ct
 where ct.id = c.contrato_id and ct.modalidade = '2x' and c.status = 'planejada' and c.numero > 1
   and coalesce(ct.processo_etapa, '') not in ('baixa', 'concluido');

-- base de conhecimento
update public.kb set resposta =
  'O valor de tabela do Limpa Nome é R$ 797,00. Hoje são três formas, só por PIX ou boleto: à vista R$ 597,00, com R$ 200,00 de desconto promocional; em 2x de R$ 400,00, a 1ª na contratação e a 2ª só quando o nome estiver limpo (total R$ 800,00); ou na condição TAP: entrada de R$ 297,00 + 5x de R$ 150,00 mensais (total R$ 1.047,00). Não há outro desconto.'
 where pergunta = 'Quanto custa o Limpa Nome?';
update public.kb set resposta =
  'Somente PIX ou boleto (não trabalhamos com cartão). Diagnóstico: R$ 67,00 à vista. Limpa Nome: à vista R$ 597,00, 2x de R$ 400,00 (a 2ª só com o nome limpo) ou TAP (entrada de R$ 297,00 + 5x de R$ 150,00). Não há outro desconto ou negociação além disso.'
 where pergunta = 'Formas de pagamento';

insert into public.kb (categoria, pergunta, resposta, palavras)
select v.categoria, v.pergunta, v.resposta, v.palavras
  from (values
    ('limpa_nome', 'Como funciona o pagamento em 2x do Limpa Nome?',
     'São 2x de R$ 400,00. A 1ª é paga na contratação e a 2ª só quando o seu nome estiver limpo, com as restrições baixadas. Assim você divide o pagamento entre o início do processo e a entrega do serviço. Total R$ 800,00.',
     '2x duas vezes parcela segunda parcela sinal entrada nome limpo baixa quando pago depois'),
    ('limpa_nome', 'O que é a TAP? Por que a entrada é R$ 297?',
     'TAP é a Taxa Administrativa Processual: a entrada de R$ 297,00 cobre a abertura e o custeio inicial das rotinas do processo. Depois são 5x de R$ 150,00 mensais. O total de R$ 1.047,00 é o valor de tabela (R$ 797,00) mais R$ 250,00 do parcelamento estendido.',
     'tap taxa administrativa processual entrada 297 parcelado parcelamento 5x 150 por que mais caro juros acréscimo'),
    ('limpa_nome', 'Por que à vista é mais barato? Qual o valor normal?',
     'O valor de tabela é R$ 797,00. À vista sai por R$ 597,00 porque tem R$ 200,00 de desconto promocional para quem paga na contratação.',
     'desconto à vista avista valor normal tabela cheio 797 597 mais barato promoção promocional')
  ) as v(categoria, pergunta, resposta, palavras)
 where not exists (select 1 from public.kb k where k.pergunta = v.pergunta);
