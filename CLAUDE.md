# CLAUDE.md — Blacksmith | DRE em Sankey no Microsoft Fabric

> Instruções do projeto para o Claude (Claude Code) executar a implantação de ponta a ponta:
> modelo semântico Import (Power Query + DAX + testes) → report de conferência → Fabric App (IBM Carbon, tema escuro padrão e tema claro, com filtragem cruzada).
> Leia este arquivo inteiro antes de executar qualquer fase. Execute uma fase por vez e valide antes de avançar.

---

## 1. Contexto

- **Empresa (fictícia):** Blacksmith — tecnologia (hardware, software, cloud e serviços), atuação nas 5 regiões do Brasil.
- **Objetivo:** um Fabric App que mostre, em um gráfico de **Sankey**, como a receita da Blacksmith se transforma em lucro (estilo dos gráficos de resultado de Apple/IBM), com KPIs, tendência, comparação realizado × orçado, visão por região e indicadores operacionais.
- **Dados:** 100% sintéticos (seed 42), 36 meses (jan/2024 a dez/2026), cenários `realizado` e `orcado`, valores em R$.
- **Evento de prejuízo (gancho da demo):** recall de hardware + multa contratual lançados em `opx_nao_recorrentes` (só no realizado; o orçado não previa):
  - mar/2025: R$ 4,8 mi → a Blacksmith fecha o mês com **prejuízo de R$ 2,59 mi** (o EBITDA zera);
  - abr/2025: R$ 2,6 mi → **prejuízo de R$ 0,61 mi** (só o Sudeste fica negativo; as outras regiões lucram);
  - 70% do evento no Sudeste; o ano de 2025 continua lucrativo (R$ 13,09 mi).
- **Arquivos de origem:** os 7 CSVs em `dataset/`, lidos pelo refresh do modelo direto do GitHub. Os números de referência abaixo são testes da tabela `_qualidade` do modelo (seção 6).

### Números de referência (realizado, consolidado) — usar para validar cada fase

| métrica | 2024 | 2025 | 2026 |
|---|---|---|---|
| receita_bruta | 153.265.935,72 | 175.027.678,18 | 198.798.380,44 |
| receita_liquida | 135.461.230,60 | 154.819.681,80 | 175.717.045,70 |
| lucro_bruto | 75.880.220,52 | 88.283.003,38 | 103.402.997,28 |
| ebitda | 28.577.873,76 | 26.606.624,76 | 42.330.126,46 |
| lucro_liquido | 15.882.255,48 | 13.088.163,15 | 24.560.318,22 |
| margem_liquida | 11,7% | 8,5% | 14,0% |

Esses valores são testes da tabela `_qualidade` (seção 6). Diferença tolerada: R$ 1,00.

### Cenários de teste do Sankey (realizado, todas as regiões)

| recorte | links que devem aparecer | valor |
|---|---|---|
| mar/2025 | `prejuizo_liquido → despesas_operacionais` | 2.071.798,75 |
| | `prejuizo_liquido → depreciacao_amortizacao` | 388.600,04 |
| | `prejuizo_liquido → resultado_financeiro_liquido` | 134.368,48 |
| | nós `ebitda`, `ebit_lucro_operacional`, `lair`, `lucro_liquido` | não aparecem (zero) |
| abr/2025 | `lucro_bruto → ebitda` | 20.950,98 |
| | `prejuizo_liquido → depreciacao_amortizacao` | 345.079,38 |
| | `prejuizo_liquido → resultado_financeiro_liquido` | 165.351,45 |
| | `prejuizo_liquido → ir_csll` | 101.830,17 |
| ano 2025 | `lair → lucro_liquido` | 13.088.163,15 (sem nó de prejuízo) |

---

## 2. Regras do projeto (obrigatórias)

1. **Idioma:** português do Brasil em tudo (tabelas, colunas, medidas, pastas, textos da UI, comentários de código).
2. **Nomenclatura:** `snake_case` em todos os identificadores: tabelas, colunas, medidas, pastas de exibição, arquivos, variáveis, componentes e funções do app. Rótulos de exibição para o usuário final ficam nas colunas `nome_*` (com acentos).
3. **Nomes:** `dim_` dimensões e `fato_` fatos. Repositório e itens do Fabric em kebab-case: repositório e workspace `fabric-app-dre-sankey-write-back` (nova versão do `fabric-app-dre-sankey`, que continua no workspace original), app `app-dre-sankey`, modelo semântico e report `dre-sankey` (mesmo nome; o tipo do item os distingue).
4. **Segurança de dados:** nunca colar, versionar ou enviar dados reais de clientes em prompts, commits ou logs. Este projeto usa apenas dados fictícios. Se for adaptado para um cliente real, mascarar/anonimizar antes e seguir a política da Power Tuning.
5. **Sankey dinâmico:** o valor de cada link é sempre calculado pela medida `sankey_valor` sobre os valores já agregados do filtro. Nunca somar links pré‑calculados por mês ou região, porque um mês com prejuízo somado a meses com lucro (ou uma região negativa somada a regiões positivas) mostraria lucro e prejuízo ao mesmo tempo. **Exceção única:** o Sankey simulado (seção 8.7) usa `simulacao/cascata_sankey.ts`, um porte da mesma cascata que roda sobre os valores por conta já agregados do recorte, e é testado contra as fixtures de `sankey_valor` (sem premissas, os links são idênticos).
6. **Sem mock no app:** o app consome somente o modelo semântico para os números da DRE. Se uma query falhar, mostrar estado de erro, nunca dados fictícios embutidos. O write-back das simulações (seção 8.7) grava só no SQL Database do próprio app, nunca no modelo.
7. **Sem credenciais no código:** usar apenas a autenticação nativa do Fabric Apps (Rayfin).
8. **Validar antes de avançar:** cada fase tem um checklist de pronto. Não pule.
9. **Visual IBM Carbon:** cores, tipografia e superfícies seguem o Carbon Design System (seção 9): paletas de visualização da Carbon, IBM Plex, cantos retos, sem brilho, vidro, gradiente ou neon. O tema **escuro (g100) é o padrão** e o **claro (g10)** fica disponível no cabeçalho; nenhuma cor de dado pode ser fixada para um tema só.
10. **Filtragem cruzada:** clicar num ponto de dados filtra os demais visuais, como no Power BI (seção 8.4.1). Todo visual novo declara se é fonte, alvo ou as duas coisas, e a seleção passa pelo `construtor_filtros.ts` (whitelist), nunca por texto livre.

---

## 3. Arquitetura

Toda a engenharia fica dentro do modelo semântico: sem lakehouse, notebook ou pipeline.

```
dataset/*.csv (GitHub)
                 │  refresh: Power Query (url_dataset + ler_csv)
                 ▼
            dre-sankey  (Import, medidas DAX, tabela _qualidade)
                 │                       │
                 │                       └──► dre-sankey (report PBIR)
                 │  Execute DAX Queries API (fabric-app-data)
                 ▼
            app-dre-sankey (Fabric App, template dataapp, TypeScript)
                 │  GraphQL do Rayfin (client.data.*, Fabric SSO)
                 ▼
            SQL Database do app (simulações, premissas e auditoria: write-back, seção 8.7)
```

| item | nome |
|---|---|
| workspace | `fabric-app-dre-sankey-write-back` (capacidade Fabric) |
| modelo semântico | `dre-sankey` |
| report de conferência | `dre-sankey` |
| fabric app | `app-dre-sankey` |

**Publicação pelo Power BI Desktop (PBIP).** Os itens ficam em `fabric-workspace/` como projeto PBIP (`dre-sankey.pbip`). Quem reproduz o projeto baixa o ZIP do repositório, abre o `dre-sankey.pbip` no Power BI Desktop, atualiza e publica no workspace. Não há `.env` nem ID versionado:

- o modelo lê os CSVs pelo parâmetro `url_dataset` (repositório público), com `Web.Contents` + `RelativePath` para o serviço aceitar o refresh;
- o report aponta para o modelo por caminho (`definition.pbir`, `byPath`);
- o PBIP não guarda dados (`cache.abf` fora do git): atualizar no Desktop antes de publicar.

Para mudar um item: editar em `fabric-workspace/` (TMDL/PBIR) ou no Desktop, atualizar e publicar de novo. A conexão do app com o modelo fica em `app-dre-sankey/fabric.yaml` (fora do git), gerada por `npm run bind`. O `rayfin up` acrescenta a URL de hospedagem do app em `rayfin.yml` (`allowedRedirectUris`): não versionar essa linha.

Histórico: até 27/10/2026 o projeto tinha lakehouse (`lh_blacksmith`), três notebooks (`nb_01_ingestao`, `nb_02_qualidade`, `nb_03_atualizar_modelo`), o pipeline `pl_blacksmith_carga`, o modelo em Direct Lake on OneLake e a pasta `validacao/` (gabarito `referencias.json` e scripts Python). Tudo foi substituído pelo modelo Import, pela `_qualidade` e pelo report.

---

## 4. Fase 0 — Pré‑requisitos

- [x] Capacidade numa região com Fabric Apps disponível: https://learn.microsoft.com/en-us/fabric/admin/region-availability.
- [x] Workspace em **capacidade Fabric** (Fabric Apps não funcionam em capacidade compartilhada/Pro).
- [x] Permissão Contributor, Member ou Admin no workspace.
- [x] Portal de administração do Fabric (tenant):
  - [x] Workload **Fabric Apps** habilitado.
  - [x] Configuração de integração **Semantic Model Execute Queries REST API** (pode aparecer como *Dataset Execute Queries REST API*) habilitada.
- [x] Node.js 20 ou superior e npm na máquina de desenvolvimento (usado: v24).
- [ ] Power BI Desktop, para abrir e publicar o `fabric-workspace/dre-sankey.pbip`.
- [ ] Azure CLI logado (`az login`): exigido por `npm run validate:visual`.
- [ ] Credencial **Anônima** da fonte Web `github.com` no Power BI Desktop (pedida no primeiro refresh).
- [x] VS Code com o Claude Code.
- [ ] Usuários finais com permissões **Build** e **Read** no `dre-sankey` (adiado: por enquanto só o dono usa o app).

> Fabric Apps está em preview. Versões usadas: Rayfin CLI 1.36.2, `@microsoft/fabric-app-data` 1.1.0,
> `@microsoft/fabric-visuals` 4.2.0. Em versões novas, confira https://learn.microsoft.com/fabric/apps/ e `npx rayfin --help`.

---

## 5. Fase 1 — Carga no modelo (Power Query)

### 5.1 Fonte
O refresh do modelo `dre-sankey` baixa os 7 CSVs de `dataset/` do GitHub. Duas expressões compartilhadas em `expressions.tmdl`:

- `url_dataset` (parâmetro, texto): `https://github.com/alisonpezzott/fabric-app-dre-sankey/raw/main/dataset`. Para ler de outro repositório, trocar o parâmetro no Desktop antes de publicar. Esta versão continua lendo os CSVs do repositório original.
- `ler_csv(arquivo, tipos)` (função): `Web.Contents(url_dataset, [RelativePath = arquivo & ".csv"])` → `Csv.Document` UTF-8 → cabeçalho → confere se as colunas são exatamente as esperadas → `Text.Trim` em tudo → tipos com cultura `en-US` → **falha o refresh** se alguma linha tiver valor que não converte (o equivalente ao antigo `FAILFAST`).

### 5.2 Dicionário de dados

| tabela | colunas (tipo) | grão |
|---|---|---|
| `dim_calendario` | data (date), ano (int), mes (int), indice_mes (int, gerado no Power Query), nome_mes (string), ano_mes (string), mes_ano (string), trimestre (string), ano_trimestre (string), semestre (string) | 1 linha por mês |
| `dim_conta` | cod_conta, nome_conta, cod_grupo, nome_grupo, natureza (receita/despesa) (string), ordem_dre (int) | 19 contas |
| `dim_regiao` | cod_regiao, nome_regiao, ufs, escritorio (string) | 5 regiões |
| `dim_no_sankey` | cod_no, nome_no, tipo_no (receita/total/custo/lucro/prejuizo), cor_hex (string), coluna_sankey (int) | 30 nós |
| `dim_link_sankey` | cod_link, cod_no_origem, cod_no_destino, cod_conta, tipo_link (conta/subtotal/prejuizo) (string), etapa, ordem_link (int) | 33 links possíveis |
| `dim_cenario` | cod_cenario, nome_cenario (string), ordem_cenario (int) — tabela fixa no Power Query (`#table`) | 2 cenários |
| `fato_lancamentos` | data (date), cod_regiao, cod_conta, cenario (string), valor, valor_dre (double), data_hora_carga (datetime, horário de Brasília, gerado no Power Query) | mês × região × conta × cenário (6.484 linhas; contas zeradas não têm linha) |
| `fato_operacional` | data (date), cod_regiao (string), clientes_ativos, novos_clientes, headcount, nps, contratos_fechados (int), churn_pct (double) | mês × região, só realizado (180 linhas) |

Regras de sinal: `valor` sempre positivo; `valor_dre` positivo para receita e negativo para despesa.

`dim_link_sankey` não tem valores: lista todos os links que podem existir. `cod_conta` preenchido = link folha (valor direto da conta); vazio (`""`, nunca nulo) = link de subtotal ou de prejuízo, calculado pela cascata da seção 7.3.

### 5.3 Regras do Power Query

- Cada partição chama `ler_csv` com a lista `{coluna, tipo}` **na ordem do cabeçalho do CSV**; tabela sem fonte (`dim_cenario`) é `#table` tipado.
- `dim_calendario.indice_mes = (ano − 2024) × 12 + mes`, coluna adicionada no M.
- `fato_lancamentos.data_hora_carga` = um único momento do refresh (`DateTimeZone.UtcNow()` em UTC−3), guardado numa variável do `let` antes do `Table.AddColumn`.

`indice_mes` (1 a 36) é a chave das comparações com o ano anterior e dos acumulados, porque o calendário é mensal e não diário.

### Pronto quando
- [ ] Refresh no Power BI Desktop sem erro, antes de publicar.
- [ ] Contagens da seção 5.2 (testes 1 a 8 da `_qualidade`).

---

## 6. Fase 2 — Qualidade (`_qualidade`) e report de conferência

### 6.1 Tabela calculada `_qualidade`
Substitui o antigo `nb_02_qualidade`. Recalculada a cada refresh, uma linha por teste: `ordem`, `grupo`, `teste`, `esperado`, `obtido`, `tolerancia`, `diferenca`, `status` (`falha` quando |obtido − esperado| > tolerância; obtido vazio conta como 0). A medida `testes_com_falha`, na própria `_qualidade`, deve ser 0.

| grupo | testes |
|---|---|
| `contagens` | linhas das 8 tabelas (seção 5.2) |
| `chaves` | chaves das dimensões sem vazio e sem duplicidade; grão das duas fatos |
| `integridade` | fatos sem data, região, conta ou cenário nas dimensões; nós e contas de `dim_link_sankey` |
| `sankey` | link folha para toda conta de grupo com 2 ou mais contas (D&A, resultado financeiro e IR/CSLL são contas únicas: o nó do grupo é o terminal); `cod_link = origem__destino`; fechamento dos nós (entrada = saída) por mês × cenário, mês × cenário × região e ano × cenário, pela medida `sankey_desequilibrio_max` (tolerância R$ 0,05) |
| `sinal` | `valor ≥ 0`; `valor_dre` coerente com `dim_conta.natureza` |
| `dre_realizado` | receita líquida, EBITDA e lucro líquido realizado 2024/2025/2026 (seção 1, tolerância R$ 1) |
| `prejuizo` | só 2025-03 e 2025-04 com prejuízo consolidado no realizado; nenhum no orçado |
| `sankey_cenarios` | a tabela "Cenários de teste do Sankey" da seção 1 |

Um teste que falha não derruba o refresh (é tabela calculada); quem garante a carga é o `ler_csv`. Conferir a `_qualidade` depois de todo refresh.

### 6.2 Report `dre-sankey`
PBIR em `fabric-workspace/dre-sankey.Report/`, ligado ao modelo por `byPath`, tema base Fluent 2. Serve só para conferência (não é o Plano B):

| página | conteúdo |
|---|---|
| Qualidade | `testes_com_falha`, `data_ultima_carga` e a tabela `_qualidade` |
| DRE anual | subtotais por ano × cenário; matriz das contas por ano e cenário |
| Resultado mensal | DRE por mês, ano anterior e orçado |
| Sankey | links com `sankey_valor`, valor do ano anterior e `sankey_desequilibrio_max` (abre em mar/2025) |
| Regiões | DRE e meses com prejuízo por região |
| Operacional | indicadores operacionais por região |

Nas páginas com segmentador de cenário, ele é de seleção única e começa em Realizado: sem esse filtro, as medidas da DRE somariam realizado e orçado.

### Pronto quando
- [x] Os 50 testes da `_qualidade` passam (`testes_com_falha = 0`): conferido em 27/10/2026 rodando o DAX da tabela como consulta no modelo publicado.
- [ ] Report abre no serviço e no Power BI Desktop sem visual quebrado.

---

## 7. Fase 3 — Modelo semântico (`dre-sankey`)

### 7.1 Criação
- Modo **Import**, com as 8 tabelas carregadas pelo Power Query (seção 5) e as tabelas calculadas `_medidas` e `_qualidade`.
- Definição versionada em `fabric-workspace/dre-sankey.SemanticModel/` (TMDL), aberta no Power BI Desktop por `fabric-workspace/dre-sankey.pbip`. A `culture` fica em `en-US`: o serviço não permite trocar o idioma de um modelo existente, e as format strings já são explícitas.
- Fatos com todas as colunas ocultas (expor somente medidas); nas dimensões, ocultar as chaves `cod_*` usadas em relacionamento, `cod_grupo` e `indice_mes`. `dim_no_sankey` e `dim_link_sankey` ficam visíveis (Plano B). `discourageImplicitMeasures` ligado.
- Ordenar colunas: `dim_calendario[mes_ano]` por `indice_mes`; `dim_calendario[nome_mes]` por `mes`; `dim_conta[nome_conta]` por `ordem_dre`; `dim_cenario[nome_cenario]` por `ordem_cenario`.
- `fato_lancamentos[valor]` e `[valor_dre]` são `double`; os relacionamentos por `data` usam `joinOnDateBehavior: datePartOnly`.

### 7.2 Relacionamentos (todos 1:N, filtro em direção única)

| de (1) | para (N) |
|---|---|
| `dim_calendario[data]` | `fato_lancamentos[data]`, `fato_operacional[data]` |
| `dim_regiao[cod_regiao]` | `fato_lancamentos[cod_regiao]`, `fato_operacional[cod_regiao]` |
| `dim_conta[cod_conta]` | `fato_lancamentos[cod_conta]` |
| `dim_cenario[cod_cenario]` | `fato_lancamentos[cenario]` |

`dim_no_sankey` e `dim_link_sankey` ficam **sem relacionamento**: a medida `sankey_valor` lê o link selecionado e calcula o valor a partir das medidas da DRE, que já respeitam os filtros de data, região e cenário.

### 7.3 Medidas DAX

As 54 medidas ficam na tabela calculada `_medidas` (`source = { 0 }`, coluna `Value` oculta), com as pastas de exibição indicadas. Todas as medidas da DRE respeitam o filtro de `dim_cenario`; as medidas `_realizado`/`_orcado` forçam o cenário.

**Pasta `01_dre`** — formato `\R\$ #,##0;(\R\$ #,##0);-`

```dax
valor_dre = SUM ( fato_lancamentos[valor_dre] )

receita_bruta = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "receita_bruta" )
deducoes_receita = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "deducoes_da_receita" )
receita_liquida = [receita_bruta] + [deducoes_receita]
custos = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "custos_cpv_csp" )
lucro_bruto = [receita_liquida] + [custos]
despesas_operacionais = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "despesas_operacionais" )
ebitda = [lucro_bruto] + [despesas_operacionais]
depreciacao_amortizacao = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "depreciacao_amortizacao" )
ebit = [ebitda] + [depreciacao_amortizacao]
resultado_financeiro = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "resultado_financeiro" )
lair = [ebit] + [resultado_financeiro]
ir_csll = CALCULATE ( [valor_dre], dim_conta[cod_grupo] = "impostos_sobre_o_lucro" )
lucro_liquido = [lair] + [ir_csll]
```

**Pasta `02_margens`** — formato `0.0%`

```dax
margem_bruta = DIVIDE ( [lucro_bruto], [receita_liquida] )
margem_ebitda = DIVIDE ( [ebitda], [receita_liquida] )
margem_ebit = DIVIDE ( [ebit], [receita_liquida] )
margem_liquida = DIVIDE ( [lucro_liquido], [receita_liquida] )
peso_custos = DIVIDE ( - [custos], [receita_liquida] )
peso_despesas_operacionais = DIVIDE ( - [despesas_operacionais], [receita_liquida] )
aliquota_efetiva_ir = DIVIDE ( - [ir_csll], [lair] )
```

**Pasta `03_comparativos`**

```dax
receita_liquida_realizado = CALCULATE ( [receita_liquida], dim_cenario[cod_cenario] = "realizado" )
receita_liquida_orcado = CALCULATE ( [receita_liquida], dim_cenario[cod_cenario] = "orcado" )
var_receita_liquida_orcado_pct = DIVIDE ( [receita_liquida_realizado] - [receita_liquida_orcado], ABS ( [receita_liquida_orcado] ) )

lucro_liquido_realizado = CALCULATE ( [lucro_liquido], dim_cenario[cod_cenario] = "realizado" )
lucro_liquido_orcado = CALCULATE ( [lucro_liquido], dim_cenario[cod_cenario] = "orcado" )
var_lucro_liquido_orcado_pct = DIVIDE ( [lucro_liquido_realizado] - [lucro_liquido_orcado], ABS ( [lucro_liquido_orcado] ) )

-- ano anterior (calendário mensal: desloca 12 posições em indice_mes);
-- vazia se algum mês do contexto não tem o mesmo mês do ano anterior no calendário
receita_liquida_aa =
VAR meses = VALUES ( dim_calendario[indice_mes] )
VAR meses_aa = SELECTCOLUMNS ( meses, "indice_mes", dim_calendario[indice_mes] - 12 )
VAR meses_cobertos = COUNTROWS ( INTERSECT ( meses_aa, ALL ( dim_calendario[indice_mes] ) ) )
RETURN
    IF ( meses_cobertos = COUNTROWS ( meses ),
         CALCULATE ( [receita_liquida], REMOVEFILTERS ( dim_calendario ), TREATAS ( meses_aa, dim_calendario[indice_mes] ) ) )
var_receita_liquida_aa_pct = DIVIDE ( [receita_liquida] - [receita_liquida_aa], ABS ( [receita_liquida_aa] ) )

lucro_liquido_aa =   -- mesma guarda de receita_liquida_aa
VAR meses = VALUES ( dim_calendario[indice_mes] )
VAR meses_aa = SELECTCOLUMNS ( meses, "indice_mes", dim_calendario[indice_mes] - 12 )
VAR meses_cobertos = COUNTROWS ( INTERSECT ( meses_aa, ALL ( dim_calendario[indice_mes] ) ) )
RETURN
    IF ( meses_cobertos = COUNTROWS ( meses ),
         CALCULATE ( [lucro_liquido], REMOVEFILTERS ( dim_calendario ), TREATAS ( meses_aa, dim_calendario[indice_mes] ) ) )
var_lucro_liquido_aa_pct = DIVIDE ( [lucro_liquido] - [lucro_liquido_aa], ABS ( [lucro_liquido_aa] ) )

-- acumulado no ano até o último mês do contexto
receita_liquida_acumulada_ano =
VAR ultimo = MAX ( dim_calendario[indice_mes] )
VAR ano = MAX ( dim_calendario[ano] )
RETURN CALCULATE ( [receita_liquida], REMOVEFILTERS ( dim_calendario ),
                   dim_calendario[ano] = ano, dim_calendario[indice_mes] <= ultimo )

lucro_liquido_acumulado_ano =
VAR ultimo = MAX ( dim_calendario[indice_mes] )
VAR ano = MAX ( dim_calendario[ano] )
RETURN CALCULATE ( [lucro_liquido], REMOVEFILTERS ( dim_calendario ),
                   dim_calendario[ano] = ano, dim_calendario[indice_mes] <= ultimo )
```

As medidas de variação usam formato `+0.0%;-0.0%;0.0%`.

**Pasta `04_operacional`**

```dax
-- semiaditivas: saldo do último mês do contexto
clientes_ativos =
VAR ultimo = MAX ( dim_calendario[indice_mes] )
RETURN CALCULATE ( SUM ( fato_operacional[clientes_ativos] ), dim_calendario[indice_mes] = ultimo )

headcount =
VAR ultimo = MAX ( dim_calendario[indice_mes] )
RETURN CALCULATE ( SUM ( fato_operacional[headcount] ), dim_calendario[indice_mes] = ultimo )

novos_clientes = SUM ( fato_operacional[novos_clientes] )
contratos_fechados = SUM ( fato_operacional[contratos_fechados] )
churn_medio_pct = DIVIDE ( SUMX ( fato_operacional, fato_operacional[churn_pct] * fato_operacional[clientes_ativos] ), SUM ( fato_operacional[clientes_ativos] ) )
nps_medio = DIVIDE ( SUMX ( fato_operacional, fato_operacional[nps] * fato_operacional[clientes_ativos] ), SUM ( fato_operacional[clientes_ativos] ) )
receita_por_cliente = DIVIDE ( [receita_liquida_realizado], [clientes_ativos] )
receita_por_colaborador = DIVIDE ( [receita_liquida_realizado], [headcount] )
```

Formatos: inteiros `#,##0`; `churn_medio_pct` `0.00%`; `nps_medio` `0`; receitas por cliente/colaborador em R$.

**Pasta `05_sankey`** — formato R$

Lógica de prejuízo: a receita líquida vai "pagando" cada camada de gasto em cascata (custos → despesas operacionais → D&A → financeiro → IR). Enquanto há saldo, o que sobra vira o subtotal seguinte (lucro bruto, EBITDA…). Quando o saldo acaba, a parte não coberta de cada gasto passa a vir do nó `prejuizo_liquido`. A soma dos links que saem de `prejuizo_liquido` é exatamente o prejuízo líquido, e os subtotais zerados somem do gráfico.

```dax
sankey_valor =
VAR link  = SELECTEDVALUE ( dim_link_sankey[cod_link] )
VAR conta = SELECTEDVALUE ( dim_link_sankey[cod_conta] )
VAR valor_conta =
    IF ( conta <> "", CALCULATE ( SUM ( fato_lancamentos[valor] ), TREATAS ( { conta }, dim_conta[cod_conta] ) ) )
-- gastos de cada camada (positivos)
VAR g_custos = - [custos]
VAR g_opex   = - [despesas_operacionais]
VAR g_da     = - [depreciacao_amortizacao]
VAR g_fin    = - [resultado_financeiro]
VAR g_ir     = - [ir_csll]
-- saldo disponível após cada camada (nunca negativo)
VAR s0 = [receita_liquida]
VAR s1 = MAX ( s0 - g_custos, 0 )
VAR s2 = MAX ( s1 - g_opex, 0 )
VAR s3 = MAX ( s2 - g_da, 0 )
VAR s4 = MAX ( s3 - g_fin, 0 )
VAR s5 = MAX ( s4 - g_ir, 0 )
VAR resultado =
    SWITCH (
        link,
        "receita_bruta__deducoes_da_receita", - [deducoes_receita],
        "receita_bruta__receita_liquida", s0,
        "receita_liquida__custos_cpv_csp", MIN ( s0, g_custos ),
        "prejuizo_liquido__custos_cpv_csp", g_custos - MIN ( s0, g_custos ),
        "receita_liquida__lucro_bruto", s1,
        "lucro_bruto__despesas_operacionais", MIN ( s1, g_opex ),
        "prejuizo_liquido__despesas_operacionais", g_opex - MIN ( s1, g_opex ),
        "lucro_bruto__ebitda", s2,
        "ebitda__depreciacao_amortizacao", MIN ( s2, g_da ),
        "prejuizo_liquido__depreciacao_amortizacao", g_da - MIN ( s2, g_da ),
        "ebitda__ebit_lucro_operacional", s3,
        "ebit_lucro_operacional__resultado_financeiro_liquido", MIN ( s3, g_fin ),
        "prejuizo_liquido__resultado_financeiro_liquido", g_fin - MIN ( s3, g_fin ),
        "ebit_lucro_operacional__lair", s4,
        "lair__ir_csll", MIN ( s4, g_ir ),
        "prejuizo_liquido__ir_csll", g_ir - MIN ( s4, g_ir ),
        "lair__lucro_liquido", s5,
        valor_conta
    )
RETURN IF ( resultado > 0.005, resultado )

prejuizo_liquido = MAX ( - [lucro_liquido], 0 )   -- formato R$, para cartão/alerta

meses_com_prejuizo =
COUNTROWS ( FILTER ( VALUES ( dim_calendario[indice_mes] ), [lucro_liquido] < 0 ) )   -- formato #,##0
```

Validação no DAX Query View (mar/2025, realizado): todo nó com entrada e saída deve ter diferença zero.

```dax
EVALUATE
VAR l =
    CALCULATETABLE (
        ADDCOLUMNS ( dim_link_sankey, "v", [sankey_valor] ),
        dim_calendario[ano_mes] = "2025-03", dim_cenario[cod_cenario] = "realizado"
    )
VAR entra =
    SELECTCOLUMNS (
        GROUPBY ( l, dim_link_sankey[cod_no_destino], "entrada", SUMX ( CURRENTGROUP (), [v] ) ),
        "no", dim_link_sankey[cod_no_destino] & "", "entrada", [entrada]
    )
VAR sai =
    SELECTCOLUMNS (
        GROUPBY ( l, dim_link_sankey[cod_no_origem], "saida", SUMX ( CURRENTGROUP (), [v] ) ),
        "no", dim_link_sankey[cod_no_origem] & "", "saida", [saida]
    )
RETURN
    FILTER ( NATURALINNERJOIN ( entra, sai ), ABS ( [entrada] - [saida] ) > 0.05 )
-- esperado: nenhuma linha
```

**Medidas adicionais para a Fase 4** (o app só consome o modelo; definição completa em `fabric-workspace/dre-sankey.SemanticModel/definition/tables/_medidas.tmdl`):

| pasta | medidas | formato |
|---|---|---|
| `03_comparativos` | `lucro_bruto_aa`, `ebitda_aa`, `margem_liquida_aa` | R$ / `0.0%` |
| `03_comparativos` | `var_lucro_bruto_aa_pct`, `var_ebitda_aa_pct` | `+0.0%;-0.0%;0.0%` |
| `03_comparativos` | `var_margem_liquida_aa_pp` (diferença em pontos percentuais) | `+0.0 \p\.\p\.;-0.0 \p\.\p\.;0.0 \p\.\p\.` |
| `05_sankey` | `sankey_valor_aa`, `var_sankey_valor_aa_pct` (tooltip do Sankey) | R$ / `+0.0%;-0.0%;0.0%` |
| `06_carga` | `data_ultima_carga` (máximo de `data_hora_carga`, sem filtros: momento do último refresh) | `dd/MM/yyyy HH:mm` |
| `07_qualidade` | `sankey_desequilibrio_max` (maior diferença entre entrada e saída de um nó no contexto; esperado 0) | `\R\$ #,##0.00` |

**Guarda das medidas `_aa`:** todas (inclusive `receita_liquida_aa` e `lucro_liquido_aa`) ficam vazias quando algum mês do contexto não tem o mesmo mês do ano anterior no calendário. Sem isso, o filtro "todos os anos" compararia 36 meses com 24.

**Membro em branco:** no Import, uma dimensão só ganha membro em branco se a fato tiver chave órfã (o teste de integridade da `_qualidade` acusa). Mesmo assim, consultas que iteram dimensões usam `DISTINCT` ou deixam o `SUMMARIZECOLUMNS` remover os vazios.

**Validação automatizada:** os testes 33 a 35 da `_qualidade` (seção 6) generalizam a query acima para todos os recortes (mês e ano × cenário, consolidado e por região).

### Pronto quando
- [x] Com `dim_cenario = realizado` e `ano = 2024`: `lucro_liquido` = 15.882.255,48 e `margem_liquida` = 11,7%.
- [x] `sankey_valor` bate com a tabela "Cenários de teste do Sankey" (seção 1) e a query de validação não retorna linhas.
- [x] `receita_liquida_aa` em 2025 = `receita_liquida` em 2024.
- [x] Nenhuma medida retorna erro em um visual de tabela por `mes_ano`.
- [ ] Modelo compartilhado com Build + Read para os usuários do app (adiado).
- [x] Conexão do app com o modelo em `app-dre-sankey/fabric.yaml` (fora do git), gerada por `npm run bind`.

---

## 8. Fase 4 — Fabric App (`app-dre-sankey`)

### 8.1 Scaffold

```bash
npm create @microsoft/rayfin@latest -- "app-dre-sankey" --template dataapp
cd app-dre-sankey
npm install
npx rayfin login
# conexão com o modelo a partir da URL do dre-sankey no portal
# (scripts/bind_semantic_model.mjs: gera fabric.yaml, fora do git, e src/fabric.generated.ts)
npm run bind -- "<URL do dre-sankey>"
npm run build
```

Template `dataapp` com Rayfin CLI 1.36.2. A conexão usa o `@microsoft/fabric-app-data` (alias `modelo_dre` no `fabric.yaml`), não o `rayfin connector add`; no `rayfin/rayfin.yml` ficam ligados `auth` (Fabric SSO), `staticHosting` e `data` (`dialect: mssql`, para o write-back da seção 8.7); `storage` e `functions` desligados. Reaproveitado do template, sem alteração de fluxo: autenticação Fabric (`AuthGate`, `use-auth`), `getFabricClient()`, `VegaVisual`, `DataGrid`, `useCssTheme()`, `toDataTable` e o validador headless `validate:visual`. **Não** criar outro fluxo de login.

### 8.2 Bibliotecas extras
- `d3-sankey`: só o `sankeyLinkHorizontal` (desenho dos links). O layout é próprio (`dados/layout_sankey.ts`): colunas fixas por `coluna_sankey` e posição do nó de prejuízo (seção 8.4).
- `d3-shape` + `d3-scale`: sparklines dos cartões de KPI.
- Fontes da Carbon, empacotadas com `@fontsource` (sem chamada a Google Fonts): `IBM Plex Sans` (títulos e texto, `@fontsource-variable/ibm-plex-sans`) e `IBM Plex Mono` (números, `@fontsource/ibm-plex-mono`, pesos 400 e 500).

### 8.3 Estrutura de pastas (snake_case)

```
src/
  dados/
    cliente_modelo.ts          # hook useConsulta sobre getFabricClient().semanticModel("modelo_dre").query(): confere status, descarta respostas antigas
    construtor_filtros.ts      # monta TREATAS a partir do estado dos filtros (whitelist)
    consultas_dax.ts           # todas as queries da seção 8.5
    formatacao.ts              # format strings copiadas do modelo + locale pt-BR (overrideFormattingLocale)
    layout_sankey.ts           # layout do Sankey por coluna_sankey, posição do nó de prejuízo
    linhas_dre.ts              # junta as contas (q_dre) com os subtotais (q_dre_subtotais)
    visuais/                   # specs Vega-Lite + fábricas usadas pelo validate:visual
      tendencia.ts
      regioes.ts
      detalhe_no.ts
    fixtures/*.json            # respostas reais capturadas (scripts/capturar_fixtures.mjs), só para testes
  estado/
    estado_filtros.ts          # ano, intervalo de meses, regiões, cenário e seleção cruzada
    estado_tema.ts             # tema escuro (padrão) / claro, guardado no navegador
    selecao_cruzada.ts         # traduz onInteraction dos visuais em valores de seleção
    estado_simulacao.ts        # simulação aberta, edição não salva, modo realizado/simulado, avisos
  simulacao/                   # seção 8.7
    mapa_premissas.ts          # premissa → contas de dim_conta (único lugar do mapa)
    motor_simulacao.ts         # fatores por conta, subtotais da DRE, IR incremental
    cascata_sankey.ts          # porte da medida sankey_valor (exceção da regra 5)
    visao_simulada.ts          # KPIs, links do Sankey e linhas da DRE no modo simulado
    validacao_premissas.ts     # regras de negócio validadas antes de gravar
    textos_simulacao.ts        # números digitados em pt-BR, rótulo do período, resumo da auditoria
    repositorio_simulacoes.ts  # write-back: CRUD, versão (concorrência otimista) e auditoria
    cliente_simulacoes.ts      # liga o repositório ao client.data do Rayfin
    cliente_dados_falso.ts     # só testes: imita o Rayfin 1.36.2 (select, só id nas mutações, policies)
    fixtures_teste.ts          # só testes: fixtures do modelo convertidas para o motor
  componentes/
    cabecalho_app.tsx
    barra_filtros.tsx
    cartao_kpi.tsx
    grafico_sankey.tsx
    grafico_tendencia.tsx
    grafico_regioes.tsx
    tabela_dre.tsx
    painel_operacional.tsx
    painel_detalhe_no.tsx      # drill ao clicar num nó do sankey
    estados_carregamento.tsx   # loading, vazio, erro
    painel_simulacao.tsx       # gaveta: premissas e impacto ao vivo, salvas, histórico
    lista_simulacoes.tsx, historico_simulacao.tsx, controles_simulacao.tsx
  tema/
    tokens_tema.css
    tema_graficos.ts
  global.css                   # tokens do template apontando para os da Carbon + utilitários por papel
  pagina_principal.tsx         # consultas em paralelo, estado e grade
  main.tsx, App.tsx, hooks/, lib/, services/, components/   # do template
  *.spec.ts                    # testes vitest ao lado de cada módulo
rayfin/data/                   # entidades do SQL Database do app (seção 8.7) e schema.ts
scripts/
  bind_semantic_model.mjs      # npm run bind: grava o fabric.yaml a partir da URL do modelo
  capturar_fixtures.mjs        # grava as fixtures dos testes
```

As fixtures só alimentam testes unitários; o app em execução nunca as lê (regra 6).

### 8.4 Layout (desktop, grade de 12 colunas; empilha no mobile)

1. **cabecalho_app**: "Blacksmith" (Plex Sans semibold) + "DRE" (light), sem gradiente; subtítulo "Do faturamento ao lucro · DRE em Sankey"; data da última carga (`q_carga`); botão de tema (ícones `Sun`/`Moon` do lucide).
2. **barra_filtros** (fixa no topo): ano (2024/2025/2026/todos), intervalo de meses, regiões (multi), cenário (realizado/orçado). Padrão: último ano, todas as regiões, realizado. Mostra a seleção cruzada ativa ("Seleção: Mar/2025, Abr/2025 ✕") e "Restaurar padrão".
3. **Linha de KPIs** (6 cartões): receita líquida, lucro bruto, EBITDA, lucro líquido, margem líquida e lucro líquido vs orçado (com receita vs orçado na linha secundária). Cada cartão traz valor (Plex Sans light, números tabulares), variação vs ano anterior (▲ verde / ▼ laranja; na margem, em p.p.) e sparkline com os últimos 12 pontos de `q_tendencia`. Os KPIs são alvo da filtragem cruzada.
4. **grafico_sankey** (largura total, altura ~560 px, peça central):
   - colunas pela `coluna_sankey`; cor do nó pelo `tipo_no` na paleta do tema ativo (`cor_por_tipo_no`). `dim_no_sankey[cor_hex]` não é usada pelo app, porque não muda com o tema;
   - ignorar links sem valor (a medida devolve vazio), para que os nós zerados desapareçam;
   - **prejuízo:** o nó `prejuizo_liquido` (vermelho) entra por baixo, à esquerda da primeira camada que ele financia (posicionar em `min(coluna dos destinos) − 1`); links vermelhos com textura listrada (o prejuízo não depende só da cor); selo "Prejuízo" no cartão de lucro líquido;
   - links na cor do nó de destino, sem gradiente nem brilho, opacidade 0,4 em repouso e 0,85 em foco;
   - rótulos: nome do nó + valor abreviado (R$ 175,7 mi) + % da receita líquida;
   - tooltip com valor, % da receita e variação vs ano anterior;
   - hover num link ou nó destaca os fluxos ligados e esmaece os demais; clique num nó mantém esse destaque e abre o **painel_detalhe_no** com a evolução mensal daquele nó (clicar de novo fecha);
   - animação de entrada: links "fluindo" da esquerda para a direita (respeitar `prefers-reduced-motion`);
   - no mobile, rolagem horizontal dentro do próprio contêiner.
5. **grafico_tendencia** (8 colunas): receita líquida (área ciano chapada, 16% de opacidade) e lucro líquido (linha verde) por `mes_ano`; margem líquida no eixo secundário (linha roxa tracejada). Fonte da filtragem cruzada por mês.
6. **grafico_regioes** (4 colunas): barras horizontais de receita líquida por região com a margem líquida em rótulo. Fonte da filtragem cruzada por região.
7. **tabela_dre** (8 colunas): data grid do template com linhas da DRE em `ordem_dre`, colunas realizado, orçado, variação %; subtotais pelas medidas do modelo (`q_dre_subtotais`): receita bruta e receita líquida como subtotal simples, lucro bruto, EBITDA, EBIT, LAIR e lucro líquido destacados. Alvo da filtragem cruzada.
8. **painel_operacional** (4 colunas): clientes ativos, novos clientes, churn, NPS, headcount, receita por cliente e por colaborador. Só existe realizado: ignora o filtro de cenário e mostra um aviso quando o cenário é orçado. Alvo da filtragem cruzada.

Todos os componentes têm estados de carregamento (skeleton da Carbon), vazio e erro.

### 8.4.1 Filtragem cruzada (como no Power BI)

Clicar num ponto de dados filtra os demais visuais. Implementação: `onInteraction` dos `VegaVisual` → `estado/selecao_cruzada.ts` → `selecao` em `estado_filtros.ts` → `construtor_filtros.ts` acrescenta o `TREATAS` nas consultas dos outros visuais.

| visual | papel | campo | efeito |
|---|---|---|---|
| `grafico_tendencia` | fonte e alvo | `dim_calendario[indice_mes]` | clique num mês filtra KPIs, Sankey, regiões, DRE e operacional |
| `painel_detalhe_no` | fonte e alvo | `dim_calendario[indice_mes]` | idem à tendência |
| `grafico_regioes` | fonte e alvo | `dim_regiao[cod_regiao]` | clique numa região filtra KPIs, Sankey, tendência, detalhe do nó, DRE e operacional |
| `grafico_sankey` | alvo (+ destaque) | — | clique num nó destaca os fluxos dele e abre o detalhe; não filtra os outros visuais, porque filtrar medidas em cascata por conta quebraria a DRE |
| KPIs, `tabela_dre`, `painel_operacional` | alvo | — | só recebem filtros |

Regras:
- **Clique** seleciona; **Ctrl/Shift/⌘ + clique** soma ou retira pontos; clicar de novo no mesmo ponto, no fundo do visual, no ✕ da barra ou **Esc** limpa.
- O visual de origem **não é filtrado** pela própria seleção: mostra todos os pontos e esmaece os não selecionados (opacidade 0,3); a tendência marca os meses selecionados com uma faixa de fundo (`layer-selected` da Carbon) e pontos nas séries. Por isso as consultas dos visuais por mês usam `sem_mes` e a de regiões usa `sem_regiao`.
- Uma seleção por vez: selecionar em outro visual descarta a anterior. Mudar qualquer filtro da barra também limpa a seleção.
- A seleção fica **dentro** dos filtros da barra: só filtram meses do intervalo e regiões do filtro de regiões (o clique nos demais é ignorado; regiões fora do filtro aparecem esmaecidas e, sem seleção, a tendência marca os meses do intervalo com uma faixa de fundo). Meses vêm de `q_calendario` e regiões de `dim_regiao` (whitelist); valor fora do domínio derruba a consulta com erro.
- O esmaecimento vem do estado do painel (spec), não do destaque interno do visual (`capabilities: { disableSelfHighlight: true, disableLineChartCrosshairTooltip: true }`); quando a seleção muda por fora, o visual de origem é recriado (chave de versão) para não guardar uma seleção que o painel já descartou.
- Linhas e áreas não identificam o mês clicado: a tendência tem uma faixa transparente por mês, por cima das séries, que recebe o clique e a dica.
- Os subtítulos mostram o recorte efetivo ("2025 · seleção: Mar/2025 · Todas as regiões · Realizado").

### 8.5 Consultas DAX

O `construtor_filtros.ts` gera os filtros abaixo **apenas com valores vindos das dimensões** (nunca texto livre), para evitar injeção:

```dax
-- exemplo de filtros gerados
TREATAS ( { "realizado" }, dim_cenario[cod_cenario] ),
TREATAS ( { 2026 }, dim_calendario[ano] ),
TREATAS ( { 3, 4 }, dim_calendario[mes] ),            -- intervalo de meses da barra (omitido no ano inteiro)
TREATAS ( { "sudeste", "sul" }, dim_regiao[cod_regiao] )
-- com seleção cruzada (seção 8.4.1), fora dos visuais de origem
TREATAS ( { 15, 16 }, dim_calendario[indice_mes] )   -- meses clicados
TREATAS ( { "sul" }, dim_regiao[cod_regiao] )        -- regiões clicadas (substitui o filtro de regiões)
```

Opções do construtor: `sem_mes` (sem intervalo nem seleção de meses: tendência e detalhe do nó), `sem_regiao` (regiões) e `sem_cenario` (DRE, subtotais e operacional).

**Domínio e dimensões** (sem filtros): `q_anos` (`DISTINCT ( dim_calendario[ano] )`), `q_calendario` (`indice_mes`, `ano`, `mes`, `mes_ano`: domínio da seleção por mês e rótulos), `q_meses` (`mes`, `nome_mes`), `q_cenarios` (`dim_cenario`), `q_regioes_lista` (`dim_regiao`), `q_sankey_nos` (`dim_no_sankey ORDER BY coluna_sankey`) e `q_carga` (`ROW ( "data_ultima_carga", [data_ultima_carga] )`). Só com uma simulação aberta (seção 8.7): `q_contas` (plano de contas de `dim_conta`, valida o mapa de premissas) e `q_links_sankey_lista` (os 33 links de `dim_link_sankey` com `cod_conta`).

**q_kpis**
```dax
EVALUATE
SUMMARIZECOLUMNS (
    <filtros>,
    "receita_liquida", [receita_liquida], "lucro_bruto", [lucro_bruto], "ebitda", [ebitda],
    "lucro_liquido", [lucro_liquido], "margem_liquida", [margem_liquida], "prejuizo_liquido", [prejuizo_liquido],
    "var_receita_liquida_aa_pct", [var_receita_liquida_aa_pct], "var_lucro_bruto_aa_pct", [var_lucro_bruto_aa_pct],
    "var_ebitda_aa_pct", [var_ebitda_aa_pct], "var_lucro_liquido_aa_pct", [var_lucro_liquido_aa_pct],
    "var_margem_liquida_aa_pp", [var_margem_liquida_aa_pp],
    "var_receita_liquida_orcado_pct", [var_receita_liquida_orcado_pct],
    "var_lucro_liquido_orcado_pct", [var_lucro_liquido_orcado_pct]
)
```

**q_sankey_links**
```dax
EVALUATE
FILTER (
    SUMMARIZECOLUMNS (
        dim_link_sankey[ordem_link], dim_link_sankey[cod_no_origem], dim_link_sankey[cod_no_destino],
        dim_link_sankey[tipo_link], dim_link_sankey[etapa],
        <filtros>,
        "valor", [sankey_valor], "valor_aa", [sankey_valor_aa], "var_aa_pct", [var_sankey_valor_aa_pct]
    ),
    NOT ISBLANK ( [valor] )
)
ORDER BY dim_link_sankey[ordem_link]
```
Com `valor_aa` na consulta, o SUMMARIZECOLUMNS mantém links que só têm valor no ano anterior; o `FILTER` os remove.

**q_tendencia** (também alimenta as sparklines dos KPIs)
```dax
EVALUATE
SUMMARIZECOLUMNS (
    dim_calendario[indice_mes], dim_calendario[mes_ano],
    <filtros_sem_mes>,
    "receita_liquida", [receita_liquida], "lucro_bruto", [lucro_bruto], "ebitda", [ebitda],
    "lucro_liquido", [lucro_liquido], "margem_liquida", [margem_liquida],
    "var_lucro_liquido_orcado_pct", [var_lucro_liquido_orcado_pct]
)
ORDER BY dim_calendario[indice_mes]
```
Meses com `lucro_liquido < 0` ganham um ponto vermelho (Red 50 / Red 60) e o rótulo "prejuízo". Cada camada interna do spec declara `title: null` no `y`: o `VegaVisual` copia o `displayName` da coluna para todo canal sem título, e o título concatenado zerava a altura do gráfico.

**q_regioes** (`cod_regiao` é o campo da seleção cruzada)
```dax
EVALUATE
SUMMARIZECOLUMNS (
    dim_regiao[cod_regiao], dim_regiao[nome_regiao],
    <filtros_sem_regiao>,
    "receita_liquida", [receita_liquida], "margem_liquida", [margem_liquida], "lucro_liquido", [lucro_liquido]
)
ORDER BY [receita_liquida] DESC
```

**q_dre**
```dax
EVALUATE
ADDCOLUMNS (
    SUMMARIZECOLUMNS (
        dim_conta[ordem_dre], dim_conta[cod_conta], dim_conta[nome_conta], dim_conta[cod_grupo], dim_conta[natureza],
        <filtros_sem_cenario>,
        "realizado", CALCULATE ( [valor_dre], dim_cenario[cod_cenario] = "realizado" ),
        "orcado", CALCULATE ( [valor_dre], dim_cenario[cod_cenario] = "orcado" )
    ),
    "var_pct", DIVIDE ( [realizado] - [orcado], ABS ( [orcado] ) )
)
ORDER BY dim_conta[ordem_dre]
```

**q_dre_subtotais**: um `DATATABLE` com os subtotais (`receita_bruta`, `receita_liquida`, `lucro_bruto`, `ebitda`, `ebit_lucro_operacional`, `lair`, `lucro_liquido`) e a posição de cada um (`apos_ordem_dre`), com o rótulo de `dim_no_sankey[nome_no]` e realizado, orçado e `var_pct` pelas medidas do modelo, filtrado por `<filtros_sem_cenario>`. O `linhas_dre.ts` intercala os subtotais com as contas.

**q_operacional**
```dax
EVALUATE
SUMMARIZECOLUMNS (
    <filtros_sem_cenario>,
    "clientes_ativos", [clientes_ativos], "novos_clientes", [novos_clientes],
    "churn_medio_pct", [churn_medio_pct], "nps_medio", [nps_medio],
    "headcount", [headcount], "receita_por_cliente", [receita_por_cliente],
    "receita_por_colaborador", [receita_por_colaborador]
)
```

**q_detalhe_no** (valor do nó = soma das entradas; para nós de receita e `prejuizo_liquido`, que só têm saídas, usa `cod_no_origem`). `cod_no` é validado contra `dim_no_sankey` antes de entrar na consulta.
```dax
EVALUATE
SUMMARIZECOLUMNS (
    dim_calendario[indice_mes], dim_calendario[mes_ano],
    <filtros_sem_mes>,
    "valor", SUMX ( FILTER ( ALL ( dim_link_sankey ), dim_link_sankey[cod_no_destino] = "<cod_no>" ), [sankey_valor] ),
    "valor_aa", SUMX ( FILTER ( ALL ( dim_link_sankey ), dim_link_sankey[cod_no_destino] = "<cod_no>" ), [sankey_valor_aa] ),
    "lucro_liquido", [lucro_liquido]
)
ORDER BY dim_calendario[indice_mes]
```
Barras do valor mensal (contorno vermelho nos meses de prejuízo) e linha roxa tracejada do ano anterior.

Regras: verificar o `status` de cada resposta antes de passar colunas e linhas aos visuais; disparar as queries em paralelo; não duplicar queries.

### 8.6 Deploy e distribuição
- Validar localmente: `npm run build`, `npm test`, `npm run lint` e `npm run validate:visual -- <fábrica.ts> <contexto-json>` (render headless dos specs com dados reais; exige `az login`). Os números do app se conferem com o `dre-sankey` no mesmo recorte.
- Publicar: `npx rayfin up --workspace fabric-app-dre-sankey-write-back --item-name app-dre-sankey` e conferir com `npx rayfin up status --workspace fabric-app-dre-sankey-write-back --item-name app-dre-sankey`. O deploy grava `rayfin/.deployments.json` e `rayfin/.env` (fora do git) e acrescenta a URL de hospedagem em `rayfin.yml` (não versionar).
- Desenvolvimento: `npm run dev` (o `predev` roda `rayfin env`, que lê o `rayfin/.env` criado pelo primeiro `rayfin up`); abrir o item no portal com `&devUri=http://localhost:5173` no fim da URL.
- Limitação atual do preview: apps ligados a modelo semântico só funcionam abertos dentro do portal do Fabric.
- Opcional (não feito): incluir o app e o modelo num **org app** do workspace para distribuição com audiências.

### Pronto quando
- [x] Build sem erros; `validate:visual` e testes unitários ok (só o teste do template `validate-visual.spec.mjs` falha, como no template).
- [x] KPIs batem com os números da seção 1 para 2024, 2025 e 2026.
- [x] Sankey fecha (entrada = saída em cada nó) nos recortes de mês e ano × cenário, consolidado e por região (testes 33 a 35 da `_qualidade`).
- [x] mar/2025 e abr/2025 mostram o nó de prejuízo com os valores da seção 1; o ano de 2025 inteiro não mostra.
- [x] abr/2025 só Sudeste: prejuízo; abr/2025 só Sul: lucro.
- [x] Trocar o cenário para orçado atualiza todos os visuais.
- [x] Estados de loading, vazio e erro testados.
- [x] Layout ok em 1440 px, 1024 px e 390 px.
- [x] Abre no tema escuro; o botão do cabeçalho troca para o claro (e volta) em todos os visuais, inclusive Sankey, Vega e data grid, e a escolha persiste ao recarregar.
- [x] Contraste AA nos dois temas (texto ≥ 4,5:1; marcas de gráfico ≥ 3:1).
- [x] Filtragem cruzada: em 2025, clicar em mar/2025 na tendência mostra o prejuízo de R$ 2,59 mi nos KPIs e o nó de prejuízo no Sankey; Ctrl+clique em abr/2025 soma os dois meses; clicar no Sudeste com abr/2025 selecionado na barra mostra prejuízo; Esc limpa.
- [x] O visual de origem não se filtra (só esmaece) e a seleção some ao mudar um filtro da barra ou ao selecionar em outro visual.

### 8.7 Simulação e write-back

Detalhes, diagramas e limitações em `docs/simulacao_write_back.md`; roteiro da demo em `prompt_feat_write_back.md`. "Simulação", e não "cenário", porque `dim_cenario` já existe.

- **Premissas:** `receita_liquida` (5 `rec_*` + 2 `ded_*`, mesmo fator), `custos` (4 `cst_*`) e `despesas_administrativas` (`opx_pessoal_administrativo`, `opx_gerais_administrativas`), em `percentual` ou `absoluto` (R$ no período da simulação, convertido no percentual equivalente sobre a base). Mapa só em `simulacao/mapa_premissas.ts`.
- **Motor:** base = `q_dre` no período da simulação (todas as regiões, realizado); o fator multiplica as contas do recorte da tela; subtotais pela cascata da pasta `01_dre`; IR & CSLL incremental pela alíquota efetiva da base (fixo se LAIR da base ≤ 0). Sem premissas, simulado = realizado = modelo (teste).
- **Modo Simulado** (barra de filtros): KPIs (variação vs realizado, card "Impacto no lucro líquido"), DRE (Realizado | Simulado | Δ | Δ%) e Sankey (mesmo componente, nós alterados tracejados, tooltip realizado → simulado). Ano, meses e cenário ficam presos ao período da simulação; regiões e filtragem cruzada continuam. Tendência e detalhe do nó ficam no realizado.
- **Write-back:** entidades `simulacao`, `premissa_simulacao`, `auditoria_simulacao` em `rayfin/data/`, policy `claims.sub = usuario_id`, sem delete (arquivar), auditoria só create/read, `versao` para concorrência otimista, `chave_premissa` única.
- **Deploy:** o `rayfin up` provisiona o SQL Database e aplica o esquema. As entidades são compiladas por `rayfin/tsconfig.json` (copiado do template `data-app` da CLI; o `dataapp` não traz esse arquivo e, sem ele, o deploy falha com "No rayfin/.temp/compiled/data/*.js files found").
- **Provisionado em 08/11/2026:** `data: enabled`, SQL Database alcançável (`rayfin up status`).

### Pronto quando
- [x] Motor, cascata, validação, repositório (cliente falso) e painel com testes; invariante contra `q_dre_subtotais` e `q_sankey_links` (mar/2025, abr/2025, abr/2025 Sudeste e 2025).
- [x] Exemplo ilustrativo: 1 mi − 600 mil − 250 mil = 150 mil → −8% adm. = 170 mil.
- [x] `rayfin up` autorizado: SQL Database provisionado e esquema aplicado (08/11/2026).
- [x] No portal: criar e salvar com justificativa (08/11/2026); `session.user.id` bate com o `claims.sub` das policies.
- [ ] No portal: conflito de versão em duas abas; histórico; linhas no SQL Database.
- [ ] Outro usuário não lê nem altera a simulação de um dono (exige uma segunda conta).

---

## 9. Tema visual — IBM Carbon (escuro padrão + claro)

Base: [Carbon Design System](https://carbondesignsystem.com) — temas de UI g100 (escuro) e g10 (claro) e as [paletas de visualização de dados](https://www.carbondesignsystem.com/data-visualization/color-palettes). O app abre no **escuro**; o botão do cabeçalho alterna para o **claro** e a escolha fica no navegador (`localStorage`, chave `blacksmith_tema`, com `try/catch`). A troca é a classe `.dark` no `<html>`: os tokens CSS mudam e o `useCssTheme()` do template repassa as cores aos visuais Vega e ao data grid.

### 9.1 Tokens (`tema/tokens_tema.css`)

| token | claro (g10) | escuro (g100) | uso |
|---|---|---|---|
| `--cor_fundo` | `#f4f4f4` | `#161616` | background |
| `--cor_superficie` | `#ffffff` | `#262626` | layer-01: cartões |
| `--cor_superficie_2` | `#f4f4f4` | `#393939` | layer-02: blocos dentro de cartões, campos |
| `--cor_superficie_hover` | `#e8e8e8` | `#333333` | hover |
| `--cor_selecionado` | `#e0e0e0` | `#393939` | layer-selected: faixa da seleção cruzada, selo da seleção |
| `--cor_borda` / `--cor_borda_forte` | `#e0e0e0` / `#8d8d8d` | `#393939` / `#6f6f6f` | border-subtle / border-strong |
| `--cor_texto` / `_suave` / `_fraco` | `#161616` / `#525252` / `#6f6f6f` | `#f4f4f4` / `#c6c6c6` / `#a8a8a8` | text-primary / secondary / helper |
| `--cor_interativo` / `--cor_foco` | `#0f62fe` / `#0f62fe` | `#4589ff` / `#ffffff` | links, botões, anel de foco |
| `--cor_receita` | `#1192e8` Cyan 50 | `#33b1ff` Cyan 40 | receitas |
| `--cor_total` | `#6929c4` Purple 70 | `#8a3ffc` Purple 60 | totais intermediários, orçado, margem |
| `--cor_custo` | `#ba4e00` Orange 60 | `#ff832b` Orange 40 | custos, despesas, variação negativa |
| `--cor_lucro` | `#198038` Green 60 | `#6fdc8c` Green 30 | lucros, variação positiva |
| `--cor_prejuizo` | `#da1e28` Red 60 | `#fa4d56` Red 50 | **exclusivo de prejuízo** (preenchimentos) |
| `--cor_prejuizo_texto` | `#da1e28` | `#ff8389` | texto de prejuízo e erro (text-error) |

Tipografia: `--fonte_titulo` e `--fonte_texto` = IBM Plex Sans; `--fonte_numero` = IBM Plex Mono. Forma: `--raio: 0px` (tiles, botões e campos retos; selos em pílula). Movimento: `--duracao_curta: 110ms`, `--duracao_media: 240ms`, curva `cubic-bezier(0, 0, 0.38, 0.9)` (Carbon productive). Também existem `--cor_texto_inverso`, `--espaco` e `--curva_entrada`.

O `global.css` aponta os tokens do template (`--color-background`, `--color-card`, `--color-border`, `--color-ring`…) para estes e expõe utilitários Tailwind por papel: `text-receita`, `text-lucro`, `text-custo`, `bg-prejuizo`, `text-prejuizo-texto`, `bg-selecionado`, `text-interativo`, `text-texto-fraco`. Nunca usar hex fixo em componente: usar o utilitário (CSS) ou a paleta do tema (TS). A paleta categórica do template (`--color-data-1..10`) é a categórica da Carbon na ordem da documentação, com valores próprios em cada tema. O `--color-primary` do template fica fixo em `#0f62fe` nos dois temas; o azul que muda com o tema é `--cor_interativo`.

### 9.2 Diretrizes
- Superfícies chapadas: cartão = `--cor_superficie` com borda `--cor_borda` de 1 px; sem sombra, desfoque (`backdrop-filter`), brilho (`drop-shadow`, `box-shadow` colorido), gradiente, grade de fundo ou neon. Única exceção: o brilho que percorre o skeleton de carregamento (`linear-gradient` em `global.css`), como no skeleton da Carbon.
- Tipografia leve: títulos de cartão Plex Sans 16 px semibold; rótulos e textos 12–14 px regular, sem caixa alta nem espaçamento de letras; números grandes (KPIs, operacional) em Plex Sans **light** com `tabular-nums`; números de tabela, eixo e tooltip em Plex Mono 400.
- Semântica de cor fixa: ciano = receita; roxo = totais e orçado; laranja = custo e queda; verde = lucro e alta; vermelho = prejuízo (uso exclusivo). Botão ativo da barra de filtros = superfície invertida (`bg-foreground text-background`).
- Gráficos sem gradiente (regra da Carbon: nunca usar gradiente no lugar de paleta). Áreas com preenchimento chapado de baixa opacidade; links do Sankey na cor do destino.
- O prejuízo não depende só da cor: links listrados, rótulo "prejuízo" na tendência, contorno nas barras do detalhe e selo no KPI.
- Contraste mínimo AA nos dois temas: texto ≥ 4,5:1, marcas de gráfico ≥ 3:1. Texto vermelho usa `--cor_prejuizo_texto`.
- Animações curtas (110–240 ms), desligadas com `prefers-reduced-motion`.
- Pontos fora da seleção cruzada ou do filtro: opacidade 0,3 (`opacidade_esmaecida`).

### 9.3 Paleta dos gráficos (`tema/tema_graficos.ts`)

O Vega e o SVG do Sankey precisam de cores literais, então a paleta TS repete os valores de 9.1 por tema (`paletas.escuro`, `paletas.claro`). Componentes leem a paleta ativa com `usePaletaGraficos()`; os specs recebem a paleta por parâmetro (`montar_spec_tendencia(paleta, …)`) e a configuração comum vem de `config_vega(paleta)` (grade, eixos e rótulos em Plex).

```ts
export const paletas: Record<Tema, PaletaGraficos> = {
  escuro: { receita: "#33b1ff", total: "#8a3ffc", custo: "#ff832b", lucro: "#6fdc8c", prejuizo: "#fa4d56",
            prejuizo_texto: "#ff8389", selecionado: "#393939", grade: "#393939", eixo: "#6f6f6f",
            texto: "#f4f4f4", texto_suave: "#c6c6c6", superficie: "#262626" },
  claro:  { receita: "#1192e8", total: "#6929c4", custo: "#ba4e00", lucro: "#198038", prejuizo: "#da1e28",
            prejuizo_texto: "#da1e28", selecionado: "#e0e0e0", grade: "#e0e0e0", eixo: "#8d8d8d",
            texto: "#161616", texto_suave: "#525252", superficie: "#ffffff" },
};
```

A coluna `dim_no_sankey[cor_hex]` ainda guarda a paleta antiga (neon) e só serve ao Plano B; o app colore os nós pelo `tipo_no` (`cor_por_tipo_no(paleta, tipo_no)`). Se a base for regenerada, gravar em `cor_hex` os valores do tema escuro.

---

## 10. Plano B — relatório Power BI (low‑code)

Se o Fabric App não estiver liberado no tenant, publicar um relatório (por exemplo, `dre-sankey-plano-b`) sobre o mesmo modelo `dre-sankey` com o visual Sankey do AppSource, usando `dim_link_sankey[cod_no_origem]`, `dim_link_sankey[cod_no_destino]` e `[sankey_valor]` (a mesma lógica de prejuízo funciona no relatório), o mesmo layout da seção 8.4, a filtragem cruzada nativa do Power BI (mesmos papéis da seção 8.4.1: Sankey só destaca) e dois temas JSON (escuro g100 e claro g10) com as cores e a fonte IBM Plex da seção 9. Distribuir via org app.

Não implementado: o Fabric App foi liberado no tenant. O report `dre-sankey` (seção 6.2) não é o Plano B: só tabelas para conferência, sem Sankey nem temas.

---

## 11. Roteiro da demo

### 11.1 Publicação ao vivo

1. Mostrar o link de disponibilidade por região (https://learn.microsoft.com/en-us/fabric/admin/region-availability) e o workspace vazio, numa capacidade Fabric.
2. Baixar o ZIP do repositório no GitHub (**Code → Download ZIP**) e extrair.
3. Abrir `fabric-workspace/dre-sankey.pbip` no Power BI Desktop, clicar em **Atualizar** (credencial Anônima, se pedir) e mostrar a página Qualidade com `testes_com_falha = 0`.
4. **Publicar** no workspace: o modelo e o report `dre-sankey` aparecem com os dados.
5. No terminal, em `app-dre-sankey`: `npm install`, `npx rayfin login`, `npm run bind -- "<URL do dre-sankey>"` e `npx rayfin up --workspace <workspace> --item-name app-dre-sankey`.
6. Abrir o `app-dre-sankey` no workspace.

O `npm install` leva alguns minutos: rodar antes da apresentação ou enquanto o Desktop atualiza.

### 11.2 O "momento prejuízo"

1. Abrir com 2026 (ano forte), no tema escuro: fluxo limpo até o lucro líquido em verde.
2. Trocar para 2025: lucro menor, sem prejuízo no ano. Perguntar à equipe "onde foi parar a margem?".
3. Mostrar a tendência: dois pontos vermelhos em mar e abr/2025.
4. Clicar em mar/2025 na tendência (filtragem cruzada): os KPIs mostram o prejuízo, o EBITDA some e o nó vermelho "Prejuízo Líquido" aparece financiando despesas, D&A e financeiro. Clicar em Despesas Não Recorrentes no Sankey para ver a evolução mensal.
5. Ctrl+clique em abr/2025 para somar os dois meses. Depois, na barra, filtrar abr/2025 e clicar no Sudeste no gráfico de regiões: só o Sudeste fica no vermelho (clicar no Sul mostra lucro). Esc limpa a seleção.
6. Trocar para orçado: o orçamento não previa o evento, e a variação aparece no cartão.
7. (Opcional) Alternar para o tema claro para mostrar o painel em projetor ou impressão.

---

## 12. Ordem de execução para o Claude

1. Confirmar com o usuário os pré‑requisitos da Fase 0 (não é possível checar o tenant sozinho).
2. Carga, medidas e testes ficam em TMDL em `fabric-workspace/dre-sankey.SemanticModel/`; o report, em PBIR em `fabric-workspace/dre-sankey.Report/`. Para levar ao workspace: abrir `fabric-workspace/dre-sankey.pbip` no Power BI Desktop, atualizar e publicar.
3. Mudou tabela, coluna ou Power Query: conferir que a `_qualidade` continua com 0 falhas e que o report não referencia campo removido.
4. Fazer o scaffold do app (seção 8.1), inspecionar o template e só então implementar os componentes. Todo componente novo ou alterado segue o tema Carbon nos dois temas (seção 9) e o papel de filtragem cruzada da seção 8.4.1.
5. Validar contra os números da seção 1 a cada fase.
6. Nunca usar dados reais de clientes; parar e perguntar se aparecer qualquer arquivo que não seja a base fictícia.
7. Nunca versionar IDs do tenant (workspace, itens, capacidade, tenant), URLs de hospedagem ou chaves: conferir o `git diff` antes de cada commit.
