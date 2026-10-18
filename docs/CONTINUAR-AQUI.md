# Retomada da implementação do StreamFluent

Os dez blocos da [especificação](StreamFluent-especificacao-implementacao.md) foram implementados na branch `feat/study-controls-vocabulary`. O registro detalhado de cada bloco, dos testes executados e da execução em browser está em [study-controls-progress.md](study-controls-progress.md). A arquitetura atual está descrita no `AGENTS.md`/`CLAUDE.md`.

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

Nada foi mesclado em `main` nem publicado. Os commits dos blocos 5–10 estão na branch local até um novo pedido de envio.

## Preparar outra máquina

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

`dist/` e `node_modules/` são ignorados pelo Git. Carregue `dist/` como extensão não compactada no Chrome para testes manuais. Não há backend nem chave de API.

## O que falta de verdade

Validação em players reais — nada disso pôde ser feito no ambiente de desenvolvimento:

1. **Netflix:** se `videoPlayer` ainda expõe `seek`/`play`/`pause` (o `probe` responde), se A/S/D/Espaço não acionam também o handler da Netflix (ordem de listeners), se os seletores de legenda ainda funcionam e quanto atrasa a pausa automática aproximada.
2. **Max:** se escrever `currentTime` e chamar `play/pause` no `<video>` é aceito pelo player, e os seletores.
3. **Cinetaro / `cinextream.cc`:** faixas acessíveis, foco dos atalhos dentro do frame, permissão de clipboard no frame (senão aparece o campo de cópia manual) e tela cheia.

Se uma plataforma real falhar num requisito central, corrigir antes de considerá-la pronta. Não declarar compatibilidade a partir de mocks, da fixture ou da página com forma de Netflix usada na execução headless.

## Restrições a preservar

- Nenhum download de vídeo/DRM, telemetria ou nova API externa; manter os três hosts atuais de tradução/dicionário. Linglify/Oxford são procedência local, não chamadas de runtime.
- Sem novas permissões wildcard, `clipboardRead` ou chave de API inventada.
- Estado pessoal somente local; o worker é o único gravador das chaves de estudo.
- Netflix nunca recebe escrita em `video.currentTime`.
- Marcas pessoais e frases são independentes; especiais só em inglês; `learned`/`difficult` exclusivos; remover marca conserva `seen`.
- Sem reset, force push ou merge automático.
