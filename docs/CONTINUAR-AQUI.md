# Retomada da implementação do StreamFluent

Os dez blocos da [especificação](StreamFluent-especificacao-implementacao.md) foram implementados na branch `feat/study-controls-vocabulary`. O registro detalhado de cada bloco, dos testes executados e da execução em browser está em [study-controls-progress.md](study-controls-progress.md). A arquitetura atual está descrita no `AGENTS.md`/`CLAUDE.md`.

**Branch com tudo: `feat/levels-fullscreen-local-data`** (controles de estudo, rodada 2 e conta opcional). A `feat/study-controls-vocabulary` do GitHub tem só a conta sobre o checkpoint antigo; não continue por ela.

## Histórico

- Base original: `8dd950512dab8b6439e4391b8064bb060632a72d` (`main`).
- Blocos 1–4 e um WIP do bloco 5 foram feitos por outra sessão e enviados ao GitHub como checkpoint (`c20091b`, documentação em `27e2791`). Esse histórico foi preservado; o WIP não foi reescrito.
- Os blocos 5–10 foram concluídos em seguida, um commit por bloco.

| Bloco | Commit |
|---|---|
| 1 — persistência/migração | `a46e7c2` |
| 2 — especiais/cores | `d733fd1` |
| 3 — mouse/cartão | `3b67053` |
| 4 — biblioteca | `5137a49` |
| 5 — reprodução/contexto (WIP `c20091b`, concluído em) | `a27f6b2` |
| 6 — teclado, salvar e copiar | `61aa901` |
| 7 — pausa automática | `fa7bb57` |
| 8 — HTML5 e frames | `e87b1d7` |
| 9 — integração e robustez | `300750c` |
| 10 — documentação | commit `docs(study): …` seguinte a `300750c` |

Uma segunda rodada (níveis A1–C2, tela cheia, histórico no IndexedDB, backup e tradução) está na branch `feat/levels-fullscreen-local-data`, descrita na seção "Rodada 2" do [progresso](study-controls-progress.md). O que ficou para depois está em [proximos-passos.md](proximos-passos.md).

Enquanto isso, outra sessão (Codex na nuvem) fez a conta opcional C1–C4 a partir de `27e2791`, no GitHub, sem ver os blocos 5–10 nem a rodada 2, que ainda não tinham sido enviados. Em 21/10/2026 a rodada 2 foi enviada e a conta foi juntada a ela por merge; o que o merge mudou está em "Junção da conta com a rodada 2" no [progresso](study-controls-progress.md). Nada foi mesclado em `main` nem publicado na Chrome Web Store.

## Conta opcional (Supabase)

Plano e regras de segurança em [account-sync-plan.md](account-sync-plan.md). A aba **Conta** (botão no topo do popup e última aba da biblioteca) tem login por e-mail/senha, consentimento separado, restauração, conflitos, o backup em arquivo e as opções de apagar dados. Nunca sai para a conta o histórico de palavras vistas nem as traduções guardadas das falas.

### Estado registrado pela sessão que fez a conta (20/10/2026)

- Projeto **Streamfluent**, ref `ttzpioosgfacsutwmhif`. URL e chave **publicável** em `src/core/account-remote.ts`; host exato em `public/manifest.json`.
- Migração `supabase/migrations/20261021000717_account_study_sync.sql` aplicada pelo MCP: tabela `study_accounts` (uma linha por usuário, documento até 4 MB), RLS por `auth.uid()`, trigger de revisão e RPC `save_study_account` (gravação condicional por revisão).
- `supabase/tests/account_rls.sql` rodado no banco real em transação revertida: 8 verificações aprovadas. Advisor de segurança sem lints.
- Auth: e-mail/senha habilitado, cadastro aberto, confirmação de e-mail obrigatória; Google desabilitado. Nenhum cadastro, e-mail ou login real; zero linhas e zero usuários de teste no fim.

**O merge não muda o banco.** O documento continua `{ schemaVersion: 1, phrases, vocabulary, settings }`; `settings` ganhou `level` (o SQL só confere os tipos do topo) e o cliente agora completa preferências ausentes. Nenhuma migração nova é necessária.

### Conferir ou reconfigurar o Supabase

1. Projeto ativo e migração presente na lista de migrações aplicadas. Se faltar (projeto pausado, restaurado ou novo), aplicar o arquivo da migração como está, sem editar.
2. Rodar `supabase/tests/account_rls.sql` (termina em rollback) e o advisor de segurança.
3. Auth → URL Configuration: o link de confirmação do e-mail volta para a Site URL. A confirmação vale mesmo que essa página não abra, mas o ideal é uma página que diga para voltar à extensão.
4. E-mail: o provedor padrão do Supabase tem limites baixos e pode aceitar só endereços da equipe do projeto (conferir na documentação atual). Antes de amigos criarem conta, configurar SMTP próprio. Não desligar a confirmação para contornar.
5. Trocar de projeto exige mudar juntos: `ACCOUNT_ORIGIN` e `PUBLISHABLE_KEY` em `src/core/account-remote.ts`, `host_permissions` em `public/manifest.json`, o teste S02 em `src/__tests__/study-integration.test.ts` e esta documentação; depois aplicar a migração e rodar o teste RLS. Nunca usar `service_role`, senha do banco ou chave administrativa na extensão.
6. Ainda não existe: excluir a conta e os dados da nuvem pela extensão (ver [próximos passos](proximos-passos.md)), login com Google, trocar de conta no mesmo perfil Chrome.

## Preparar outra máquina

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

`dist/` e `node_modules/` são ignorados pelo Git. Carregue `dist/` como extensão não compactada no Chrome para testes manuais. O único backend é o Supabase opcional; a chave no código é a publicável, não há segredo para configurar.

## O que falta de verdade

Validação em players reais — nada disso pôde ser feito no ambiente de desenvolvimento:

1. **Netflix:** se `videoPlayer` ainda expõe `seek`/`play`/`pause` (o `probe` responde), se A/S/D/Espaço não acionam também o handler da Netflix (ordem de listeners), se os seletores de legenda ainda funcionam e quanto atrasa a pausa automática aproximada.
2. **Max:** se escrever `currentTime` e chamar `play/pause` no `<video>` é aceito pelo player, e os seletores.
3. **Cinetaro / `cinextream.cc`:** a "Legenda do player" (Artplayer) vir escolhida e acompanhar a troca de idioma no menu do player, a legenda do Artplayer sumir só com a camada ativa, troca de servidor do HLS no meio do episódio, foco dos atalhos dentro do frame, permissão de clipboard no frame (senão aparece o campo de cópia manual) e tela cheia do Artplayer.
4. **Conta:** a lista "Próxima validação manual de conta" do [progresso](study-controls-progress.md): cadastro e confirmação por e-mail, sincronização entre dois perfis, conflitos, alarmes do MV3 e cores atualizando nas abas com o storage restrito.

Se uma plataforma real falhar num requisito central, corrigir antes de considerá-la pronta. Não declarar compatibilidade a partir de mocks, da fixture ou da página com forma de Netflix usada na execução headless.

## Restrições a preservar

- Nenhum download de vídeo/DRM ou telemetria. Além dos três hosts de tradução/dicionário, somente o Supabase opcional e visível do plano de conta. Linglify/Oxford são procedência local, não chamadas de runtime.
- Sem novas permissões wildcard, `clipboardRead` ou chave de API inventada.
- Estado pessoal local por padrão; sincronização Supabase somente após consentimento. Nunca enviar biblioteca/metadados aos provedores de tradução. O worker é o único gravador das chaves de estudo; a conta grava só pela fila `exclusive()` do serviço de estudo.
- Netflix nunca recebe escrita em `video.currentTime`.
- Marcas pessoais e frases são independentes; excluir uma não apaga a outra. Especiais só em inglês; `learned`/`difficult` exclusivos; remover marca conserva `seen`.
- Validar storage/mensagens e schema futuro; não apagar legado em falhas.
- Respeitar arquivos/commits existentes; sem reset, force push ou merge automático.

## Referências

- [Especificação integral](StreamFluent-especificacao-implementacao.md)
- [Progresso e verificações](study-controls-progress.md)
- [Plano da conta](account-sync-plan.md)
- [Próximos passos](proximos-passos.md)
- [Procedência da lista especial](special-words-sources.md)

## Prompt pronto para o Codex

> Trabalhe na branch `feat/levels-fullscreen-local-data` do StreamFluent; ela já contém a conta opcional (C1–C4) juntada com os controles de estudo e a rodada 2. Leia `AGENTS.md`, `docs/CONTINUAR-AQUI.md`, `docs/account-sync-plan.md` e a seção "Junção da conta com a rodada 2" de `docs/study-controls-progress.md`. Com o MCP do Supabase, siga "Conferir ou reconfigurar o Supabase" no projeto `ttzpioosgfacsutwmhif`: migração aplicada, teste RLS, advisor e configuração de Auth (confirmação, Site URL, SMTP). Só aplique a migração se ela faltar; o merge não mudou o banco, então não crie migração nova sem um motivo concreto. Não crie contas reais nem envie e-mails sem pedido do usuário. Rode `npm ci`, `npm run typecheck`, `npm test` e `npm run build` e registre os resultados reais no progresso. Não faça merge em `main` nem force push, e não continue pela branch `feat/study-controls-vocabulary`.
