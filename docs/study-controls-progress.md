# Implementação dos controles de estudo

Base: `8dd950512dab8b6439e4391b8064bb060632a72d`. Branch: `feat/study-controls-vocabulary`.

Antes da implementação: checkout limpo; typecheck e build aprovados; 298 testes em 21 arquivos aprovados (Node 24.19.0, npm 11.9.0).

## Blocos

1. Concluído: schema V2, migração idempotente, fila de persistência no worker e clientes. Verificados migração/falhas/reinício/concorrência, settings, vocabulário, protocolo de páginas públicas, integração content/overlay e boundaries de background/frames. Typecheck e build aprovados. As chaves de estudo só são gravadas pelo serviço central.

Os resultados de players reais serão registrados separadamente dos testes controlados. Nenhuma publicação ou push faz parte desta implementação.

2. Concluído: lista canônica de 100 palavras, fontes locais, resolvedor de prioridade pessoal/especial/nova, controles de especiais e cores aprendidas. 84 testes direcionados passaram; typecheck/build aprovados. Commit anterior: `a46e7c2`.
