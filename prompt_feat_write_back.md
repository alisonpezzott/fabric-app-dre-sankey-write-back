# Simulação de cenários e write-back na DRE com Microsoft Fabric Apps

## Contexto do projeto

Você está trabalhando no projeto existente **Blacksmith | DRE em Sankey**, um **Microsoft Fabric App** feito com o **Rayfin SDK** (template `dataapp`).

O app já apresenta a Demonstração do Resultado do Exercício (DRE) com KPIs, tendência, regiões, tabela da DRE, indicadores operacionais e um **Sankey** interativo, tudo lido do modelo semântico `dre-sankey` (modo Import) por consultas DAX.

O objetivo é evoluir o app com **simulação de premissas financeiras, persistência das simulações (write-back) e comparação entre realizado e simulado**, inclusive no Sankey.

É uma evolução incremental. **Não recrie o app, não troque a arquitetura e não reconstrua o que já existe.**

A solução será usada numa demonstração técnica no YouTube: a experiência precisa ser intuitiva e profissional, e mostrar com clareza o valor de transformar uma análise do Power BI numa aplicação de planejamento.

> **Por que "simulação" e não "cenário":** o modelo já tem `dim_cenario` (realizado e orçado). Para não colidir na UI nem no código, o que o usuário cria aqui se chama **simulação**.

---

## Fase 1 — Análise do repositório

Antes de alterar qualquer arquivo, leia o `CLAUDE.md` (raiz), o `app-dre-sankey/AGENTS.md` e as skills em `app-dre-sankey/.agents/skills/`. Eles são a autoridade sobre convenções, tema, filtragem cruzada e consultas.

Depois examine:

1. Estrutura do app, dependências e versão do Rayfin (`app-dre-sankey/package.json`).
2. `rayfin/rayfin.yml`: quais serviços estão ligados hoje.
3. Autenticação (`AuthGate`, `use-auth`, `src/services/rayfin-auth.service.ts`, `src/lib/rayfin-client.ts`).
4. Leitura do modelo (`src/dados/cliente_modelo.ts`, `consultas_dax.ts`, `construtor_filtros.ts`).
5. Sankey (`src/componentes/grafico_sankey.tsx`, `src/dados/layout_sankey.ts`) e a medida `sankey_valor` (seção 7.3 do `CLAUDE.md`).
6. Testes (`*.spec.ts` com vitest, fixtures em `src/dados/fixtures/`) e o fluxo de deploy (seção 8.6 do `CLAUDE.md`).

Consulte a documentação **da versão instalada** do Rayfin antes de usar qualquer API: `npx rayfin docs search '<tema>'` e `npx rayfin docs get --symbol '<nome>'`. Leia `known limitations`, `data permissions` e `writing functions`.

Não invente medidas, tabelas, contas, métodos do SDK nem recursos não documentados do Rayfin. Se faltar informação essencial, diga o que falta antes de propor a implementação.

**Resultado esperado:** diagnóstico da arquitetura atual e os pontos de extensão para a nova funcionalidade.

---

## Fase 2 — Requisitos funcionais

### 2.1. Realizado continua oficial e somente leitura

O modelo `dre-sankey` continua sendo a fonte oficial do realizado. Preserve integralmente medidas DAX, contas, Sankey, filtros, filtragem cruzada, autenticação e tema.

**O modelo semântico não muda** e nenhuma escrita toca os lançamentos (`fato_lancamentos`). O write-back grava só no banco do próprio app.

### 2.2. Gerenciamento de simulações

O usuário autenticado deve conseguir:

- criar uma simulação com nome e descrição;
- escolher o período (ano e intervalo de meses);
- alterar as premissas e ver o impacto na hora;
- salvar, reabrir e duplicar simulações;
- arquivar (e restaurar) simulações que não usa mais. Não há exclusão.

| `status` | significado |
|---|---|
| `rascunho` | em elaboração (justificativa ainda pode faltar) |
| `salvo` | salvo com todas as justificativas |
| `arquivado` | fora da lista principal, só leitura |

Cada simulação guarda o dono, a data de criação, a data da última alteração e uma versão (controle de concorrência).

A simulação é sempre aplicada sobre o cenário **realizado**.

### 2.3. Premissas financeiras

Três premissas, ligadas às contas reais de `dim_conta`:

| `cod_premissa` | rótulo | contas afetadas | observação |
|---|---|---|---|
| `receita_liquida` | Receita líquida | as 5 contas `rec_*` **e** as 2 `ded_*` | o mesmo fator nas receitas e nas deduções, que acompanham a venda; a receita líquida varia exatamente o ajuste |
| `custos` | Custos (CPV/CSP) | as 4 contas `cst_*` (grupo `custos_cpv_csp`) | |
| `despesas_administrativas` | Despesas administrativas | `opx_pessoal_administrativo` e `opx_gerais_administrativas` | não existe grupo próprio: são 2 das 5 contas de `despesas_operacionais` |

O mapa premissa → contas fica num único módulo e é validado contra as contas devolvidas pelo modelo. Conta ausente derruba a simulação com erro, nunca com valor inventado.

Cada premissa aceita duas modalidades:

- **`percentual`:** aumento ou redução sobre o valor da categoria. Ex.: −8% em despesas administrativas.
- **`absoluto`:** valor em R$ somado ou subtraído do total da categoria **no período da simulação**. Ex.: −R$ 20.000 em despesas administrativas.

O usuário sempre digita o aumento (+) ou a redução (−) do valor da categoria. O motor converte para `valor_dre` (receita positiva, despesa negativa) pela `natureza` da conta.

O período fica só na simulação, e as premissas herdam esse período.

### 2.4. Motor de simulação

Um módulo TypeScript puro, determinístico e testável, que recalcula a DRE a partir das contas, nunca a partir dos totais:

1. **Base:** valor por conta no período da simulação, consolidado (todas as regiões), cenário realizado. Reaproveite a consulta `q_dre` (coluna `realizado`) com os filtros do período, acrescentando `dim_conta[natureza]` ao agrupamento (mesmo grão), para converter `valor` ↔ `valor_dre` sem adivinhar o sinal.
2. **Fator por conta:** percentual → `p / 100`; absoluto → `valor / total da categoria na base` (na receita, sobre a receita líquida base). Total zero com ajuste absoluto é premissa inválida (mensagem na UI), nunca divisão por zero.
3. **Aplicação no recorte:** o fator multiplica cada conta afetada no recorte atual da tela (reaproveita a consulta `q_dre`). Como o fator é uniforme, a soma dos recortes é o total, e o filtro de regiões e a filtragem cruzada continuam válidos.
4. **Subtotais:** mesma cascata das medidas da pasta `01_dre` (receita líquida → lucro bruto → EBITDA → EBIT → LAIR → lucro líquido). Margens com divisão segura (`null` quando o denominador é zero).
5. **IR & CSLL incremental:** `ir_simulado = max ( 0, ir_realizado + alíquota × ( lair_simulado − lair_realizado ) )`, com `alíquota = ir / lair` da base. Se o LAIR da base for ≤ 0 ou a alíquota sair de [0, 1], a alíquota vale 0 (IR fixo) e a UI avisa.
6. **Inalterados:** depreciação e amortização, resultado financeiro e indicadores operacionais. Medidas não aditivas (clientes ativos, headcount) e as `_aa` não são simuladas.
7. **Sankey simulado:** porte em TypeScript da cascata da medida `sankey_valor` (saldos s0…s5, links de `prejuizo_liquido`, limiar 0,005), aplicado sobre os valores **já agregados** do recorte, com a lista de links de `dim_link_sankey` (consulta nova com `cod_conta`). É a mesma regra 5 do `CLAUDE.md` (nunca somar links pré-calculados).

Capture fixtures novas do modelo com `scripts/capturar_fixtures.mjs` (só leitura; exige `az login`): `q_dre` e `q_dre_subtotais` de mar/2025, abr/2025, abr/2025 só Sudeste e 2025, os links do Sankey desses recortes e a lista de `dim_link_sankey`.

**Invariante:** sem premissas, o simulado é idêntico ao realizado em qualquer recorte (DRE, KPIs e cada link do Sankey). Isso vira teste.

Os resultados atualizam a cada alteração de premissa, sem precisar salvar. Trate valores negativos (meses com prejuízo), nulos, divisão por zero, contas sem movimento e períodos sem dados.

### 2.5. Persistência (write-back)

Use o **SQL Database gerenciado pelo Fabric App**: `services.data.enabled: true` com `dialect: mssql` no `rayfin/rayfin.yml`, entidades com decoradores em `app-dre-sankey/rayfin/data/` registradas em `schema.ts` e acesso pelo cliente tipado `getRayfinClient().data.<entidade>` (GraphQL gerado pelo Rayfin). Nada de `fetch` manual nem infraestrutura extra.

Três armadilhas já conhecidas neste projeto:

- **`rayfin/tsconfig.json`:** o template `dataapp` não traz esse arquivo, e sem ele o deploy falha com "No rayfin/.temp/compiled/data/*.js files found". Copie o do template `data-app` da CLI (`node_modules/@microsoft/rayfin-cli/templates/data-app/rayfin/tsconfig.json`).
- **Leituras devolvem só o `id`:** no Rayfin 1.36.2, uma consulta sem `.select([...])` e o `findById` trazem apenas a chave. Toda leitura usa `select([...todos os campos]).where(...).execute()`; depois de criar, releia o registro. O cliente falso dos testes deve imitar isso (devolver só os campos selecionados e só o `id` nas mutações), senão o teste esconde o erro.
- **Tipagem do cliente:** o singleton `getRayfinClient()` do template é usado pelo login; não troque o tipo dele. Tipe só o acesso a `data` num adaptador próprio.

| entidade | campos |
|---|---|
| `simulacao` | `id` · `nome` · `descricao` · `ano` · `mes_inicio` · `mes_fim` · `status` · `usuario_id` · `email_usuario` · `criado_em` · `alterado_em` · `versao` |
| `premissa_simulacao` | `id` · `simulacao` (relação → `simulacao_id`) · `cod_premissa` · `chave_premissa` · `tipo_ajuste` · `valor_ajuste` · `justificativa` · `usuario_id` · `criado_em` · `alterado_em` |
| `auditoria_simulacao` | `id` · `simulacao` (relação) · `premissa_id` · `acao` · `valor_anterior` · `valor_novo` · `usuario_id` · `email_usuario` · `alterado_em` |

Regras:

- Todo `@text` com `max`. Valores fechados (`status`, `cod_premissa`, `tipo_ajuste`, `acao`) com `@set`. Faixas (`mes_*` de 1 a 12) com `min`/`max`.
- **Toda entidade com decorador de permissão explícito**: sem ele, qualquer usuário autenticado ganha CRUD completo.
- As três premissas nascem com a simulação (valor 0), e "remover" uma premissa é zerá-la.
- Unicidade simulação × premissa: o Rayfin não aceita constraint composta, então `chave_premissa = "<simulacao_id>:<cod_premissa>"` com `unique: true`.
- Cada filha guarda o próprio `usuario_id`, porque a policy não navega relações.
- Nenhuma credencial ou token privilegiado no frontend. A autenticação é a nativa do Fabric (Rayfin).

### 2.6. Justificativas e auditoria

Premissa diferente de zero só é salva (`status = salvo`) com justificativa. Exemplos: renegociação de contratos, corte de despesas administrativas, revisão da previsão de receita.

A justificativa fica na premissa e aparece na UI. Toda ação relevante (criar, alterar premissa, salvar, duplicar, arquivar, restaurar) grava uma linha em `auditoria_simulacao` com o valor anterior e o novo (JSON).

### 2.7. Comparação

- DRE realizada × simulada (colunas Realizado, Simulado, Δ e Δ%).
- Sankey realizado × simulado: **o mesmo componente** `GraficoSankey`, com um alternador `Realizado | Simulado`. Nada de duplicar a renderização.
- KPIs originais × ajustados (EBITDA, lucro líquido e margens).
- Diferença visual clara do que é simulado: selo "Simulado", contorno tracejado nos nós alterados e tooltip "realizado → simulado (Δ, Δ%)". Não basta a cor.

---

## Fase 3 — Experiência do usuário

Siga o tema **IBM Carbon** do `CLAUDE.md` (seção 9): tokens e paleta do tema ativo, IBM Plex, cantos retos, sem gradiente, brilho ou vidro, escuro como padrão e claro disponível, contraste AA nos dois. Textos em pt-BR e valores em BRL pelos formatos de `src/dados/formatacao.ts`. Estados de carregamento, vazio, erro, salvando, salvo e conflito de versão.

Organização sugerida, integrada à página atual e com o Sankey como destaque:

1. **Visão geral:** a página de hoje, intacta no modo Realizado.
2. **Painel "Simulação":** gaveta lateral (empilha no mobile) com as abas:
   - *Premissas:* simulação aberta, nome, descrição, período, as 3 premissas (tipo %/R$, valor e justificativa) e o impacto ao vivo;
   - *Simulações salvas:* abrir, duplicar, arquivar e restaurar, com filtro por status;
   - *Histórico:* a auditoria da simulação aberta.
3. **Modo Simulado:** KPIs, DRE e Sankey passam a mostrar o simulado. A barra de filtros trava ano e intervalo no período da simulação e o cenário em realizado. Regiões e filtragem cruzada continuam funcionando. Tendência e detalhe do nó ficam no realizado nesta versão.

---

## Fase 4 — Segurança e integridade

1. Reutilizar a autenticação existente do Fabric/Rayfin, sem outro fluxo de login.
2. Cada usuário lê e altera **só as próprias simulações**: policy `claims.sub = usuario_id` em leitura, criação e alteração. Sem permissão de exclusão.
3. `auditoria_simulacao` só aceita criação e leitura (append-only para o usuário).
4. Validação no banco: tipos, `@set`, `min`/`max`, `unique`, chave estrangeira e não nulo. Validação de negócio (justificativa, mapa de contas, faixa de valores) no cliente, num módulo testado.
5. Concorrência otimista pelo campo `versao`: reler, comparar, gravar `versao + 1` e, se divergir, avisar "alterada em outra aba" sem sobrescrever.
6. Erros sem detalhes internos na UI.
7. **O RLS do modelo semântico não protege o SQL Database do app.** A segurança das simulações é implementada e testada à parte.

### Limitações do Rayfin 1.36.2 (documentar, não contornar com gambiarra)

- `@entity()` não aceita constraint composta (daí a `chave_premissa`).
- O update do Data API Builder é por chave primária, sem ETag nem update condicional: a checagem de `versao` tem uma pequena janela de corrida.
- Functions rodam com a identidade do chamador (`ctx.getDataClient()`), então não blindam nada que o GraphQL direto não permita. Por isso esta versão não usa functions.
- A auditoria é gravada pelo app: o banco impede alterar ou apagar linhas, mas não garante que toda ação gere uma.
- Uma consulta devolve uma página (100 linhas): lista e histórico mostram até 100 itens.
- O `usuario_id` gravado é `session.user.id` (de `useAuth()`); no deploy de 08/11/2026 ele bateu com o `claims.sub` das policies (criar e salvar funcionaram). Falta provar com uma segunda conta que um usuário não enxerga as simulações do outro.

---

## Fase 5 — Testes e validação

Testes vitest ao lado de cada módulo, no padrão do projeto, cobrindo:

1. Criação, persistência e recuperação de simulações (cliente de dados falso).
2. Ajustes percentuais e absolutos.
3. Agregação da DRE e IR incremental (inclusive alíquota inválida → IR fixo).
4. Valores negativos: mar/2025 e abr/2025 têm prejuízo no realizado.
5. Conta ausente, categoria sem movimento com ajuste absoluto e período sem dados.
6. **Invariante:** sem premissas, a DRE simulada bate com `q_dre`/`q_dre_subtotais` e o Sankey simulado bate com as fixtures de `sankey_valor` (tabela "Cenários de teste do Sankey" do `CLAUDE.md`: mar/2025, abr/2025 e 2025).
7. Fechamento do Sankey simulado: entrada = saída em todo nó.
8. Conflito de versão rejeitado.
9. Nenhuma escrita fora das três entidades (o modelo semântico não é tocado).
10. Depois do deploy autorizado: outro usuário não lê nem altera a simulação de um dono.

### Exemplo ilustrativo (só para o teste unitário do motor)

| indicador | valor |
|---|---:|
| Receita líquida | R$ 1.000.000 |
| Custos | R$ 600.000 |
| Despesas administrativas | R$ 250.000 |
| Resultado (equivale ao EBITDA, sem as demais despesas) | R$ 150.000 |
| Premissa: despesas administrativas | −8% |
| Resultado simulado | R$ 170.000 |
| Impacto | +R$ 20.000 |

São valores fictícios de teste: nunca entram no app nem substituem os dados do modelo.

Ao final: `npm run build`, `npm test` e `npm run lint` sem novas falhas, e a `_qualidade` do modelo continua com 0 falhas.

---

## Fase 6 — Documentação

- Criar `docs/simulacao_write_back.md`, com diagramas mermaid onde ajudarem: arquitetura, fluxo de leitura (DAX) e escrita (GraphQL), regras do motor, entidades e permissões, desenvolvimento local, testes, deploy e limitações conhecidas.
- Atualizar o `CLAUDE.md`:
  - nova fase "Simulação e write-back";
  - exceção explícita à regra 5 (a cascata em TypeScript só sobre valores agregados, testada contra `sankey_valor`);
  - complemento à regra 6 (o write-back vai para o SQL do app, nunca para o modelo; sem mock).
- Preservar a documentação existente.

---

## Diretrizes obrigatórias

- Trabalhar incrementalmente e preservar o que existe.
- Reutilizar componentes, hooks, formatos e paleta do projeto. Evitar dependências novas.
- **Não alterar o modelo semântico.**
- **Não fazer deploy (`npx rayfin up`, que provisiona o SQL Database) nem migração destrutiva (`--force`) sem autorização explícita.** Lembre que `npm run dev` também provisiona um backend real.
- Não versionar IDs do tenant, URLs de hospedagem nem o `fabric.yaml`. Conferir o `git diff` antes de cada commit.
- Usar apenas dados fictícios da Blacksmith.

## Estratégia de execução

**Não implemente tudo de uma vez.** Primeiro apresente:

1. resumo da arquitetura atual;
2. arquitetura proposta;
3. arquivos a alterar e arquivos novos;
4. modelagem dos dados;
5. estratégia dos cálculos;
6. riscos e limitações;
7. etapas;
8. dúvidas em aberto.

**Aguarde a aprovação.** Depois implemente em etapas pequenas e testáveis:

1. motor de simulação puro e testes (com as fixtures do modelo);
2. entidades, `rayfin.yml`, `rayfin/tsconfig.json` e repositório de simulações, depois **pausa para autorizar o deploy** (e, depois dele, retire do `rayfin.yml` a URL de hospedagem que o `rayfin up` acrescenta);
3. painel de simulação (premissas, impacto ao vivo, salvar, duplicar, arquivar e histórico);
4. modo Simulado em KPIs, DRE e Sankey;
5. documentação e validação final.

## Resultado esperado

O usuário consegue:

1. consultar o realizado;
2. criar uma simulação;
3. ajustar receita, custos e despesas administrativas;
4. ver o impacto na hora;
5. justificar cada premissa;
6. salvar com write-back;
7. reabrir simulações anteriores;
8. comparar simulado e realizado;
9. ver o impacto no Sankey.

### Roteiro do "momento simulação" (vídeo)

1. Abrir 2025 no modo Realizado e clicar em mar/2025 na tendência: o nó vermelho de prejuízo aparece no Sankey.
2. Abrir o painel, criar "Plano de contenção 2025" e aplicar −8% em despesas administrativas e −3% em custos.
3. Alternar para Simulado: o prejuízo encolhe no Sankey, os KPIs mostram o Δ e a DRE ganha as colunas simuladas.
4. Salvar sem justificativa (bloqueado), justificar e salvar. Recarregar a página e reabrir a simulação.
5. Mostrar o histórico e as linhas no SQL Database do app (query editor, só leitura), com o modelo semântico intocado.

O resumo para o vídeo: **o Microsoft Fabric Apps transforma uma análise do Power BI numa aplicação de planejamento e decisão, sem tocar nos dados financeiros oficiais.**
