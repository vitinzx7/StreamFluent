# Retomada da implementação do StreamFluent

Este é um **checkpoint de trabalho incompleto**, criado a pedido do usuário para outra IA continuar sem depender do chat anterior.

## Prompt pronto para a próxima IA

> Continue a implementação do StreamFluent na branch `feat/study-controls-vocabulary`. Leia `AGENTS.md`, este arquivo, `docs/study-controls-progress.md` e a especificação integral em `docs/StreamFluent-especificacao-implementacao.md`. Os blocos 1–4 foram implementados e commitados; o bloco 5 tem uma implementação inicial preservada como WIP e ainda precisa de revisão e integração. Retome pelo bloco 5, depois execute os blocos 6–10 e a matriz de aceite. Preserve os commits e o trabalho existentes, execute os testes relevantes e registre resultados reais. Não reinicie o projeto nem declare os controles concluídos só porque os módulos unitários existem. Não faça merge ou publique a extensão sem um novo pedido do usuário.

## Localização e histórico

- Repositório: https://github.com/vitinzx7/StreamFluent
- Branch de retomada: `feat/study-controls-vocabulary` (não partir de `main`).
- Base original inspecionada: `8dd950512dab8b6439e4391b8064bb060632a72d`.
- Checkpoint do código: `c20091b074460ea831706a84eca8631fbb12fe2f`.
- A especificação anexa foi copiada integralmente, sem edição, para este repositório. Os caminhos `/workspace/attachments/...` do chat anterior não são necessários.
- Os hashes abaixo são commits reais; o último commit documental da branch pode ser posterior ao checkpoint de código.

| Bloco | Commit | Estado |
|---|---|---|
| 1 — persistência/migração | `a46e7c2` | Implementado com testes |
| 2 — especiais/cores | `d733fd1` | Implementado com testes |
| 3 — mouse/cartão | `3b67053` | Implementado com testes |
| 4 — biblioteca | `5137a49` | Implementado com testes |
| 5 — reprodução/contexto | `c20091b` | **WIP: revisar e concluir** |
| 6–10 | Ainda sem commits | Pendentes |

A especificação originalmente pedia dez commits locais e nenhum push automático. O pedido posterior do usuário autorizou explicitamente enviar este checkpoint e o plano ao GitHub. Por isso existe um commit WIP adicional; não reescrever o histórico para fingir que o bloco 5 foi concluído.

## Preparar outra máquina

Use o checkout existente se estiver disponível. Neste ambiente o caminho é `/workspace/StreamFluent`; outros ambientes podem usar outro diretório. Uma tarefa cloud já é isolada; não criar worktree sem necessidade explícita.

Confira primeiro `git status` e a branch. Se a branch ainda não existir localmente e não houver trabalho a preservar, busque e acompanhe `origin/feat/study-controls-vocabulary`. Não use reset nem limpeza destrutiva para trocar de branch.

Node 24.19.0 e npm 11.9.0 foram usados. Não houve mudança de dependências nem de `package-lock.json`.

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

No ambiente original, `npm ci --cache /workspace/.npm-cache --no-audit --no-fund` também foi validado. O parâmetro de cache é opcional em outra máquina.

`dist/` e `node_modules/` são ignorados pelo Git e precisam ser gerados/instalados em uma nova máquina. Não precisam ser enviados ao repositório. Carregue `dist/` como extensão não compactada no Chrome para testes manuais. Não há backend, banco ou chave de API a configurar para a suíte automatizada.

## Estado observado e limites

Em 18/10/2026, no código do checkpoint:

- `npm run typecheck`: passou.
- `npm test -- --maxWorkers=2`: **334 testes em 26 arquivos passaram**.
- `npm run build`: passou.
- `git diff --check`: passou.
- Base anterior à implementação: 298 testes em 21 arquivos passaram.
- Não foi executada validação em player real Netflix, Max ou Cinetaro.
- Não foi executada uma sessão de browser da fixture neste checkpoint.

A suíte usa mocks/DOM controlados. Ela não comprova compatibilidade com APIs Netflix reais, CORS, fullscreen real ou os novos atalhos integrados — alguns ainda não existem.

## O que já existe

### Persistência

`src/core/study-storage.ts` contém o serviço serializado: leitura + migração + aplicação + gravação. O worker em `src/background/background.ts` é o único gravador de `vocabulary`, `phrases`, `settings` e `studyRevision`.

O protocolo é `{ type: "sf:study:<ação>", requestId, payload }`, com resposta `{ ok: true, requestId, revision, data }` somente após persistência, ou `{ ok: false, requestId, error }`. Remetentes são validados por identidade da extensão, página/host e frame admitido.

`src/core/study-messages.ts` exporta `requestStudy<T>()`, que devolve o envelope de sucesso; os dados estão em `.data`. Ações atuais:

- `read`: `{ vocabulary, phrases, settings }`.
- `observe`: payload `{ language, keys, occurrenceId }`; resultado `{ freshKeys }`.
- `set-mark`: `{ language, word, mark, details? }`; resultado `{ vocabulary, changed }`.
- `save-phrase`: `{ phrase }`; resultado `{ phrase, duplicate }`.
- `remove-phrase`, `clear-phrases`, `patch-settings` e `toggle-auto-pause`.

Clientes TS: `settings.ts`, `storage.ts`, `vocabulary.ts`. `PhraseRepository.saveResult()` preserva o indicador de duplicata; `.save()` devolve só a frase. `VocabularyStore.observeLine()` é assíncrono e deduplica a ocorrência no cliente. `setMark()` aguarda confirmação; o store mantém snapshots confirmados.

`study-data.ts` normaliza/migra os dados. `types.ts` contém `VocabularyV2`, `PersonalMark`, `WordDetails`, `WordContext`, `SavedPhrase` discriminada (`word`/`sentence`) e `SavedPhraseInput`. `word-normalization.ts` centraliza identidade/tokenização. `translation.cleanWord()` reutiliza essa normalização.

`public/study-client.js` implementa o mesmo transporte para as páginas JS sem bundle. Não voltar a usar `chrome.storage.local.set` nessas páginas.

### Palavras, cartão e biblioteca

- Dataset canônico: `src/data/special-words.en.json`, exatamente as 100 entradas do anexo, com metadados e links preservados.
- `special-words.ts` consulta um Set local; `word-status.ts` resolve pessoal > especial > nova > normal.
- Novas preferências: `highlightSpecialWords: false`, `autoPause: false`; novas permanecem ligadas por padrão.
- Renderizador compartilhável: `ui/word-renderer.ts`, preserva espaços/pontuação/quebras, recebe root e callbacks, com interação de teclado e contexto direito.
- Cartão compartilhável: `ui/word-card.ts`, usa texto literal para dados recebidos, suporta marcação e salvamento durante loading/erro, e aguarda confirmação.
- `ui/subtitle-overlay.ts` usa esses componentes no caminho Netflix/Max.
- `content.ts` integra clique direito difícil, contexto capturado e consulta por clique esquerdo.
- Biblioteca pública tem três vistas, busca, idioma, filtro de plataforma nas frases, transição de marcas e atualizações via storage. Links `library.html?tab=difficult` existem no popup/painel.

**Os novos recursos de palavra ainda não foram integrados ao caminho HTML5.**

## Ponto exato do bloco 5

Estes arquivos foram salvos no commit WIP:

- `src/core/playback-controller.ts`: driver, limites de seek, fila de comandos, alvos pendentes, confirmação de posição, repetir/avançar/toggle/pause.
- `src/core/study-context.ts`: snapshots e separação inicial live/retained/study; utilitários de conversão para contexto de palavra.
- `src/core/line-navigation.ts`: acrescenta `backTarget`, `current`, `reset` e opção `{ keyboard: false }`; o listener legado de A continua habilitado por padrão.
- `src/core/line-timeline.ts`: expõe tempos da fala atual, preservando o algoritmo anterior.
- `src/core/netflix-bridge.ts`: enum fechado seek/play/pause, validação de parâmetros e caminho, timeout; Netflix nunca recebe fallback em `video.currentTime`.
- Adaptadores Netflix/Max com métodos play/pause; entrada MAIN evita duplicar listener na reinjeção.
- `src/__tests__/playback-controller.test.ts` e novos casos da ponte Netflix.

**Ainda não há nenhuma instância de `createPlaybackController` ou `createStudyContext` em `content.ts` ou `timed-subtitles.ts`.** O A atual continua vindo do listener legado. Os módulos novos passaram nos testes unitários, mas não estão ligados à interface.

## Plano para continuar

### 1. Revisar e concluir o bloco 5

Leia as seções 7 e 11 da especificação e revise o WIP antes de ampliar a integração. Confirme os testes de A e timeline, S após seek realmente estabilizado, D +5/+10 em sequência, limites com duração/janela/lacunas, Space serializado e cancelamento por sessão. Mantenha segundos no domínio e milissegundos somente na fronteira Netflix.

Pontos de revisão que ainda não foram demonstrados pela integração:

- `repeat(snapshot)` ainda não valida a identidade da sessão do snapshot por si só; definir e testar o contrato com a orquestração.
- Conferir promises de drivers penduradas/cancelamento, pedidos rápidos, resposta antiga e seek externo durante um seek próprio; não tratar ack da ponte como posição estabilizada.
- Na Netflix, a disponibilidade real de play/pause continua desconhecida; ausência/rejeição precisa falhar de modo controlado.
- Não duplicar o listener de A ao instalar o roteador central.

### 2. Bloco 6 — contexto e teclado central

Criar o roteador central em capture no documento/defaultView correto. Integrar A/S/D/Espaço/Q/R e Ctrl/Cmd+C. Respeitar composedPath, IME, campos editáveis, controles focados, modificadores, seleção nativa e eventos repetidos.

Ligar `R` a `kind: sentence`, capturando o snapshot no keydown, sem esperar tradução. Implementar clipboard com fallback selecionável, sem permissões amplas. Botões de salvar/copiar precisam compartilhar os handlers. Remover definitivamente o listener legado de A só quando a integração estiver pronta.

Os controles de pausa automática já aparecem no popup/painel e salvam a preferência, **mas não causam pausa ainda**. Q ainda não está instalado.

### 3. Bloco 7 — pausa automática e retenção

Implementar `auto-pause.ts` ou módulo equivalente. Usar o relógio do vídeo para fontes temporais, offset, grupos com sobreposição positiva e fronteiras contíguas separadas. DOM Netflix/Max tem start/end zerados: tratar como tempo desconhecido e pausar aproximadamente por desaparecimento/substituição, sem estimar um término fictício.

Reter somente após pausa confirmada. Consumir cada término uma vez por passagem; S permite nova passagem. Retomar libera retenção sem ciclo; Q desligado não dá play. Invalidar por seek, buffering relevante, sessão, idioma, fonte e cleanup. Palavras de uma fala escondida atrás da retenção só devem ser observadas quando ela for exibida.

### 4. Bloco 8 — HTML5 e frames

Integrar os mesmos componentes de palavra, cartão, contexto, atalhos e auto-pause a `ui/timed-subtitles.ts`, dentro de seu Shadow DOM. Usar o idioma efetivo (`en`/`pt-BR`) e os tempos/offset do controlador existente. Manter tradução automática opt-in, independente da consulta explícita por palavra.

Expor identidade/timing dos cues em `subtitles.ts` sem criar nova ocorrência a cada tradução/recoloração. Não montar outro overlay Netflix em cima do HTML5.

Preservar importação UTF-8 até 2 MB, restauração de TextTracks, propriedade única e lease do Cinetaro. O relay continua só com IDs opacos. Instalar atalhos no documento que recebe foco. Fullscreen nativo do video deve restaurar tracks e suspender ações dependentes de legendas invisíveis; fullscreen do contêiner pode manter a camada.

### 5. Bloco 9 — testes combinados e robustez

Executar a matriz da seção 12 e acrescentar regressões de integração reais para especial → difícil → aprendida → remover, migração + primeiro cue, duas abas + biblioteca, auto-pause + R/cópia e mudança de sessão com operações pendentes.

Revisar listeners duplicados, consultas DOM globais, writers antigos, seleção/foco, geração de respostas de tradução e operações concorrentes. Os testes existentes são evidência parcial, não prova de todos os itens da matriz.

### 6. Bloco 10 — documentação e fechamento

Atualizar README e as seções antigas do AGENTS que ainda descrevem `marked`, amarelo, debounce de writers distribuídos e HTML5 sem cores. Documentar atalhos, comportamento aproximado DOM, lista fixa e limitações.

Rodar typecheck, suíte completa e build. Inspecionar manifesto e bundles; não commitar dist. Usar a fixture em browser quando disponível e registrar separadamente o que foi realmente observado em players reais. Só declarar a implementação completa quando as integrações e a matriz estiverem resolvidas.

## Restrições a preservar

- Nenhum download de vídeo/DRM, telemetria ou nova API externa.
- Manter os três hosts atuais de tradução/dicionário; Linglify/Oxford são procedência local, não chamadas de runtime.
- Sem novas permissões wildcard, clipboardRead ou chave de API inventada.
- Estado pessoal somente local; não enviar biblioteca/metadados a provedores.
- Marcas pessoais e frases são independentes; excluir uma não apaga a outra.
- Especiais só em inglês; learned/difficult exclusivos; remover marca conserva seen.
- Validar storage/mensagens e schema futuro; não apagar legado em falhas.
- Respeitar arquivos/commits existentes e não fazer reset, force push ou merge automático.

## Referências

- [Especificação integral](StreamFluent-especificacao-implementacao.md)
- [Progresso e verificações](study-controls-progress.md)
- [Procedência da lista especial](special-words-sources.md)
