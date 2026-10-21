# Implementação dos controles de estudo

Base: `8dd950512dab8b6439e4391b8064bb060632a72d`. Branch: `feat/study-controls-vocabulary`.

Antes da implementação: checkout limpo; typecheck e build aprovados; 298 testes em 21 arquivos aprovados (Node 24.19.0, npm 11.9.0).

## Blocos

1. Concluído: schema V2, migração idempotente, fila de persistência no worker e clientes. Verificados migração/falhas/reinício/concorrência, settings, vocabulário, protocolo de páginas públicas, integração content/overlay e boundaries de background/frames. Typecheck e build aprovados. As chaves de estudo só são gravadas pelo serviço central.

Os resultados de players reais serão registrados separadamente dos testes controlados. A especificação original previa commits locais. Em seguida, o usuário pediu explicitamente um checkpoint no GitHub com o trabalho atual e um plano para outra IA continuar. Este envio preserva a branch de trabalho; não faz merge nem publica a extensão.

2. Concluído: lista canônica de 100 palavras, fontes locais, resolvedor de prioridade pessoal/especial/nova, controles de especiais e cores aprendidas. 84 testes direcionados passaram; typecheck/build aprovados. Commit anterior: `a46e7c2`.

3. Concluído: renderizador compartilhado sem perda de texto, clique direito offline, cartão persistente acessível com ações assíncronas e remoção explícita de marca. 53 testes de content/overlay aprovados; typecheck/build aprovados. Commit do bloco 2: `d733fd1`.

4. Concluído: biblioteca com frases/difíceis/aprendidas, busca/filtros, ações confirmadas, atualização entre páginas, deep links e renderização literal. 19 testes de biblioteca/storage/background aprovados; typecheck/build aprovados. Commit do bloco 3: `3b67053`.


5. **Em andamento, preservado como checkpoint**: controlador compartilhado de reprodução e contexto de estudo; exposição de alvos/tempos da navegação; ponte Netflix com enum fechado seek/play/pause e verificação de caminho; métodos play/pause dos adaptadores. Os testes unitários do controlador existem, mas os módulos novos ainda não são instanciados por content.ts nem pelo HTML5. Não considerar o bloco 5 aceito nem os blocos 6–10 implementados.

## Validação do checkpoint de transferência

Em 18/10/2026, após o pedido de passagem para outra IA:

- `npm run typecheck`: aprovado.
- `npm test -- --maxWorkers=2`: **334 testes em 26 arquivos passaram**.
- `npm run build`: aprovado, os quatro bundles e os arquivos públicos foram gerados.
- `git diff --check`: aprovado.
- Node.js 24.19.0; npm 11.9.0.
- Nenhum player real Netflix/Max/Cinetaro foi validado nesta implementação. Não houve teste de browser da fixture nesta etapa.

Esses resultados validam o código presente e os testes controlados, não a conclusão das funcionalidades ainda sem integração. O guia de retomada está em `docs/CONTINUAR-AQUI.md`, e a especificação integral foi preservada em `docs/StreamFluent-especificacao-implementacao.md`. Checkpoint do código parcial do bloco 5: `c20091b074460ea831706a84eca8631fbb12fe2f`.

## Objetivo adicional: conta e sincronização

Plano em `docs/account-sync-plan.md` (commit `66699d2`). C1: documento versionado, backup estrito e merge em três vias implementados; 7 testes direcionados e typecheck passaram. Histórico de palavras não marcadas excluído do documento. Controles 5–10 mantêm os estados anteriores.

C2: migração `account_study_sync` aplicada pelo MCP ao projeto confirmado. `supabase/tests/account_rls.sql` executado no banco real em transação com rollback: 8 verificações aprovadas (CAS, inserção cruzada, troca de dono, leitura/update/RPC cruzados, isolamento B, DELETE, SELECT e RPC anônimos). Fixtures sintéticas, sem sessões/e-mails reais. Advisor de segurança retornou zero lints. Ainda não é teste de login HTTP nem de Chrome. C1 commit: `101b33d`.

C3: cliente Supabase fixado em `2.118.0`, login/cadastro por e-mail e senha, consentimento separado, sincronização com revisão condicional, fila local compartilhada, base durável e resolução explícita de conflitos implementados. Logout não exclui conta e bloqueio de mistura de contas no mesmo perfil. Sessões no storage restrito a contextos confiáveis; players recebem apenas invalidação de settings/vocabulário e releem pelo protocolo validado. Rede da conta limitada ao projeto e caminhos Auth/Data necessários, sem cookies e sem redirects. Testes de falhas/reinício/restauração controlada, CAS, exclusão, importação, fronteiras de mensagens/rede e edição durante envio adicionados. Suíte parcial de referência: 357 testes/30 arquivos, typecheck e build aprovados. Sem login real de usuário e sem player real nesta etapa.

C4: página Conta e backup acessível pelo popup e biblioteca, com consentimento, estados distintos de salvamento, data da última confirmação, escolha explícita de conflitos e prévia/confirmação de importação. Documentação AGENTS/README/retomada atualizada. C2 commit: `ba7d09c`; C3 commit: `4416d13`.

### Verificação final do objetivo de conta

- `npm ci --no-audit --no-fund`: aprovado com o lockfile; nenhuma versão de dependência existente alterada. Nova dependência direta fixada em `@supabase/supabase-js@2.118.0`.
- `npm run typecheck`: aprovado.
- `npm test -- --maxWorkers=2`: **366 testes em 31 arquivos aprovados**. Inclui reinício com base durável, resposta perdida após commit remoto, falha de gravação local após commit remoto, SDK real com HTTP/storage controlados, fronteiras de rede, conflito/exclusão e interface em jsdom.
- `npm run build` e `git diff --check`: aprovados. Cinco bundles; `dist/` e `node_modules/` não versionados.
- Supabase real: 8 verificações SQL de isolamento/revisão aprovadas; advisor de segurança sem lints. Consulta posterior confirmou zero documentos de conta e zero usuários de teste remanescentes. Nenhuma biblioteca pessoal foi enviada durante desenvolvimento.
- API pública Auth consultada com chave publicável: e-mail habilitado, cadastro permitido, confirmação obrigatória; Google desabilitado. Não houve cadastro, envio de e-mail ou login real.
- Chrome/Playwright: navegador ausente; tentativa de instalar Chromium falhou com download truncado. **Não executado:** Chrome com extensão carregada, e-mail/SMTP real, alarmes MV3, eventos entre abas após restrição do storage, instalação/reinstalação real ou players Netflix/Max/Cinetaro. DOM controlado não comprova esses itens.
- Implementação C1–C4 presente; aceite de ponta a ponta ainda depende da lista manual abaixo. Nenhum merge ou publicação da extensão. Blocos de controles 5–10 seguem pendentes conforme o checkpoint original.

### Próxima validação manual de conta

1. Gerar `dist/`, recarregar extensão e abas de streaming; conferir a nova permissão exata do projeto Supabase.
2. Sem login, salvar frase e difícil offline, exportar/importar backup; conferir cópia local e ausência de requests para Supabase.
3. Criar conta com endereço próprio, confirmar e-mail e entrar. Conferir que login sozinho não envia dados. Se o e-mail não chegar, verificar configuração Auth/SMTP do projeto; não remover confirmação para contornar isso.
4. Aceitar consentimento, ativar e conferir o estado sincronizado; em outro perfil/dispositivo entrar na mesma conta e restaurar. Não desinstalar a única cópia antes da confirmação da conta ou de obter backup.
5. Em dois perfis da mesma conta, testar edição offline contra exclusão e duas alterações na mesma marca; conferir escolha explícita e rejeição de escolha antiga após nova alteração.
6. Testar falha de rede, reconexão, suspensão/reinício do worker e atualização por alarmes. Verificar cores/preferências em duas abas e biblioteca com local storage restrito, sem tokens em scripts de player.
7. Sair/desinstalar um perfil descartável e confirmar que os dados sincronizados continuam na conta; reinstalar e restaurar. Conta diferente no mesmo perfil deve ser bloqueada. Não reutilizar o perfil principal para este teste.
8. Repetir validações de reprodução dos controles em players reais separadamente; conta não altera DRM, arquivos de legenda ou ponte Netflix.
