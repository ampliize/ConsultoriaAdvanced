-- =====================================================================
-- Volta para produção: remove o que foi criado no Asaas SANDBOX.
-- - o contrato de teste (criado_por = 'teste_sandbox') e tudo dele vira cancelado,
--   sem chamar o Asaas (as cobranças de sandbox não existem em produção);
-- - os IDs de cliente do Asaas guardados nos leads eram do sandbox: são apagados
--   para o sistema buscar/criar o cliente de novo na conta de produção.
-- =====================================================================
update public.cobrancas set status = 'cancelada', motivo_cancelamento = 'teste_sandbox'
 where contrato_id in (select id from public.contratos where criado_por = 'teste_sandbox')
   and status <> 'cancelada';
update public.comissoes set status = 'cancelada'
 where contrato_id in (select id from public.contratos where criado_por = 'teste_sandbox');
update public.notificacoes set status = 'cancelada'
 where contrato_id in (select id from public.contratos where criado_por = 'teste_sandbox') and status = 'pendente';
update public.contratos set status = 'cancelado' where criado_por = 'teste_sandbox';
update public.leads set asaas_customer_id = null where asaas_customer_id is not null;
