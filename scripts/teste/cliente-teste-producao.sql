-- Cria um cliente de TESTE em produção, vinculado ao admin, já na etapa de proposta do kanban.
-- Tudo numa transação: se algo não bater (admin ou etapa não encontrados), nada é gravado.
-- Ajuste só a linha do admin_username se quiser outro admin.
BEGIN;

DO $$
DECLARE
  admin_username TEXT := NULL;  -- ex.: 'weber'. NULL = primeiro admin ativo
  v_admin INTEGER;
  v_etapa INTEGER;
  v_cliente INTEGER;
  v_lead INTEGER;
BEGIN
  SELECT id INTO v_admin FROM users
   WHERE role = 'admin' AND active = TRUE AND (admin_username IS NULL OR username = admin_username)
   ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Admin não encontrado'; END IF;

  -- Etapa do closer: "PROPOSTA DIGITADA" se existir, senão "PROPOSTA SISTEMA"
  SELECT id INTO v_etapa FROM crm_kanban_estagios
   WHERE pipeline_tipo = 'closer' AND UPPER(nome) IN ('PROPOSTA DIGITADA', 'PROPOSTA SISTEMA')
   ORDER BY (UPPER(nome) = 'PROPOSTA DIGITADA') DESC LIMIT 1;
  IF v_etapa IS NULL THEN RAISE EXCEPTION 'Etapa de proposta não encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM crm_clientes WHERE cpf = '00000000191') THEN
    RAISE EXCEPTION 'Já existe cliente com o CPF de teste 000.000.001-91';
  END IF;

  INSERT INTO crm_clientes (nome, cpf, telefone)
  VALUES ('CLIENTE TESTE', '00000000191', '(71) 90000-0000')
  RETURNING id INTO v_cliente;

  INSERT INTO crm_kanban_leads (cliente_id, closer_id, estagio_id, status_atendimento)
  VALUES (v_cliente, v_admin, v_etapa, 'em_atendimento')
  RETURNING id INTO v_lead;

  RAISE NOTICE 'Criado: cliente % / lead % / admin % / etapa %', v_cliente, v_lead, v_admin, v_etapa;
END $$;

COMMIT;

-- Para apagar depois do teste (operações e contratos do cliente caem junto, se houver):
-- DELETE FROM contratos WHERE operacao_id IN (SELECT id FROM contratos_operacoes WHERE cliente_id = (SELECT id FROM crm_clientes WHERE cpf = '00000000191'));
-- DELETE FROM contratos_operacoes WHERE cliente_id = (SELECT id FROM crm_clientes WHERE cpf = '00000000191');
-- DELETE FROM crm_clientes WHERE cpf = '00000000191';
