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

Esses resultados validam o código presente e os testes controlados, não a conclusão das funcionalidades ainda sem integração. O guia de retomada será salvo em `docs/CONTINUAR-AQUI.md` com a especificação integral no mesmo repositório.
