# Conta, sincronização e backup — plano adicional

Base confirmada: `27e279183ed009ef0a91a40b104126341e0ca403`, branch `feat/study-controls-vocabulary`.
Projeto consultado pelo MCP: Streamfluent, `ttzpioosgfacsutwmhif`, ativo; nenhuma tabela pública na inspeção inicial.

## Encaixe no plano existente

Os blocos 1–4 permanecem implementados, o 5 permanece WIP e 6–10 permanecem pendentes. Este objetivo acrescenta os blocos C1–C4, sem declarar os controles de player concluídos nem reescrever a especificação original. O pedido atual autoriza o destino Supabase opcional e visível; o modo padrão continua local. Os provedores de tradução não recebem a biblioteca nem metadados.

1. **C1 — contrato e backup**: documento versionado com frases, marcas pessoais e preferências; exportação sem sessão/senha/tokens; importação validada e aditiva; comparação em três vias e conflitos visíveis. Histórico `seen` continua local, exceto as palavras explicitamente marcadas.
2. **C2 — banco e isolamento**: uma linha por conta, RLS por `auth.uid()`, gravação condicional por revisão e limite de tamanho. Testes SQL com duas identidades e papel anônimo, em transação revertida. Guardar resultados e SQL reexecutável.
3. **C3 — conta e sincronização**: cliente Supabase somente no worker, e-mail/senha, credenciais de sessão em área restrita da extensão, consentimento separado de login. Persistência local continua no mesmo serviço serializado. Sincronizar após gravações, em alarmes e por ação manual, com timeout. Manter base confirmada para reconhecer exclusões e modificações offline; CAS evita perder atualizações concorrentes. Conflitos interrompem o envio e exigem escolha explícita por item. Conta diferente não pode receber o conjunto local vinculado à conta anterior. Nesta versão, trocar de conta requer outro perfil Chrome; sair mantém cópia local e vínculo.
4. **C4 — interface, regressões e documentação**: página Conta e backup ligada ao popup/biblioteca, estado local/pendente/sincronizado/conflito/erro, consentimento e exportação/importação. Typecheck, suíte e build; registrar limites de validação real.

## Contrato de segurança e recuperação

- Somente URL e chave **publicável** no bundle; nenhuma senha de banco, `service_role` ou chave administrativa.
- Somente a página interna de conta pode autenticar, ativar sincronização, importar ou resolver conflitos; content scripts não recebem tokens.
- Limitar `chrome.storage.local` a contextos confiáveis antes de guardar sessões. Content scripts usam o protocolo do worker e eventos de alterações.
- Login não autoriza upload. Consentimento explícito permite sincronizar frases, palavras marcadas e seus contextos, traduções já salvas e preferências para este Supabase.
- Desinstalação e logout não fazem DELETE no servidor. Excluir frase/marca com sincronização ativa é uma alteração sincronizável; excluir conta inteira não faz parte desta versão.
- Documento remoto limitado a 4 MB; backup a 4 MB. Falhas de rede/quota/versão preservam a cópia local e a última base; nenhum status de sucesso antecipado.
- Sincronização compara a última base confirmada, o estado atual e o remoto. Exclusão contra edição é conflito; exclusão contra item inalterado é propagada. Não usar relógios de dispositivos para decidir quem vence.
- Receber respostas antigas nunca substitui alterações locais posteriores: aplicação remota e persistência compartilham a fila do serviço de estudo.
- Backup é arquivo pessoal em texto, sem criptografia própria; a interface informa isso. Importação não exclui itens existentes nem substitui preferências sem opção explícita.
- Preservar allowlist de mídia/frames, ausência de acesso a DRM e ponte Netflix sem fallback `video.currentTime`.

## Autenticação e operação

Escolha inicial: e-mail/senha, sem dependência de Google OAuth/ID fixo da extensão. Cadastro depende da configuração de confirmação de e-mail/SMTP do projeto e deve ser validado em Chrome com um endereço do próprio usuário. Não cadastrar contas reais nem enviar mensagens no teste de implementação. Google permanece fora desta entrega.

Fontes oficiais consultadas: changelog Supabase (incluindo mudanças TLS/PG 17.11), documentação Auth e RLS. Chrome usa TLS moderno; esta mudança não instala extensões PG atingidas pelo aviso de 17.11. Dependências novas serão fixadas e lockfile versionado.

## Evidências

Plano registrado antes da alteração arquitetural. Resultados C1–C4 serão acrescentados ao progresso. Testes unitários, isolamento SQL no Supabase e browser/player real serão descritos separadamente.

Implementação C1–C4 registrada no progresso. Limites deliberados: um perfil Chrome por conta; sem Google OAuth, sem criptografia ponta a ponta e sem upload de arquivos de legenda/histórico `seen`. O estado remoto é um documento pessoal limitado a 4 MB, adequado ao escopo atual; migrar para itens separados exige novo contrato e testes de migração, não trocar o formato silenciosamente.

Documentação oficial consultada:
- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://developer.chrome.com/docs/extensions/reference/api/storage
