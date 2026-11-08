# Blacksmith: DRE em Sankey no Microsoft Fabric

Projeto de ponta a ponta no **Microsoft Fabric** que mostra, num gráfico de **Sankey**, como a receita de uma empresa se transforma em lucro, ou em prejuízo. O caminho completo:

**CSVs → modelo semântico Import (Power Query + DAX + testes de qualidade) → Fabric App (React + TypeScript)**

Toda a engenharia fica dentro do modelo: não há lakehouse, notebook nem pipeline. Um report de conferência, sobre o mesmo modelo, mostra os testes e os números de referência.

O app segue o **IBM Carbon Design System**, abre no tema escuro e tem tema claro. Clicar num ponto de um gráfico filtra os outros, como no Power BI.

**Esta é a versão com write-back** do [fabric-app-dre-sankey](https://github.com/alisonpezzott/fabric-app-dre-sankey): além de analisar o realizado, o usuário cria **simulações** de premissas (receita, custos e despesas administrativas), vê o impacto na hora na DRE e no Sankey e grava tudo no **SQL Database do próprio Fabric App**, sem tocar no modelo semântico. Veja [Simulação e write-back](#simulação-e-write-back).

![Blacksmith DRE com mar/2025 selecionado: KPIs com o prejuízo de R$ 2,59 mi e, no Sankey, o nó vermelho "Prejuízo Líquido" cobrindo despesas, D&A e resultado financeiro.](docs/imagens/app-dre-sankey_capa.png)

*Mar/2025 selecionado na tendência: o EBITDA fica negativo e o nó **Prejuízo Líquido** passa a financiar despesas, D&A e resultado financeiro.*

> **Os dados são 100% fictícios.** A Blacksmith é uma empresa inventada, e a base foi gerada com semente fixa (seed 42). Se você adaptar o projeto para dados reais, anonimize-os antes e nunca versione dados de clientes.

---

## Sumário

- [O que tem no projeto](#o-que-tem-no-projeto)
- [Simulação e write-back](#simulação-e-write-back)
- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Instalação passo a passo](#instalação-passo-a-passo)
- [Validação](#validação)
- [Segurança](#segurança)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## O que tem no projeto

### O cenário

- **Blacksmith**, empresa de tecnologia (hardware, software, cloud e serviços) que atua nas 5 regiões do Brasil.
- **36 meses** (jan/2024 a dez/2026), em dois cenários: **realizado** e **orçado**.
- **Evento de prejuízo** para a demonstração: um recall de hardware e uma multa contratual, lançados só no realizado.
  - Em **mar/2025** a empresa fecha com **prejuízo de R$ 2,59 mi**.
  - Em **abr/2025**, com **prejuízo de R$ 0,61 mi**, e nesse mês só o Sudeste fica negativo.
  - O ano de 2025 inteiro continua lucrativo (R$ 13,09 mi).

<details>
<summary><strong>Ver o app inteiro</strong> (tendência mensal, regiões, DRE realizado × orçado e indicadores operacionais)</summary>

![App completo publicado no portal do Fabric, com mar/2025 selecionado: KPIs, Sankey, tendência mensal com os meses de prejuízo, receita por região, DRE realizado × orçado e painel operacional.](docs/imagens/app-dre-sankey.png)

</details>

### Os entregáveis

| camada | item | o que faz |
|---|---|---|
| Modelo + report | `fabric-workspace/dre-sankey.pbip` | Modelo **Import**: o Power Query lê os 7 CSVs de `dataset/`, confere cabeçalho e tipos e cria `dim_cenario`. Tem 54 medidas DAX (DRE, margens, comparativos com o ano anterior e com o orçado, indicadores operacionais e o Sankey) e a tabela calculada `_qualidade`, com 50 testes. O report traz páginas de conferência: testes de qualidade, DRE anual, resultado mensal, links do Sankey, regiões e operacional. |
| App | `app-dre-sankey` | Fabric App com KPIs, Sankey, tendência mensal, regiões, tabela da DRE e painel operacional, além de filtragem cruzada e tema claro/escuro. |

### A lógica do prejuízo no Sankey

A medida `sankey_valor` calcula cada link sobre os valores já agregados no filtro. A receita líquida vai "pagando" cada camada de gasto, em cascata: custos, despesas operacionais, D&A, resultado financeiro e IR/CSLL.

- Quando a receita acaba, a parte não coberta de cada gasto passa a sair do nó **Prejuízo Líquido**.
- Os subtotais zerados (EBITDA, EBIT…) somem do gráfico.
- Somar links pré-calculados mês a mês mostraria lucro e prejuízo ao mesmo tempo. Calcular sobre o agregado evita isso.

---

## Simulação e write-back

> **Onde está o código:** a simulação está no branch [`feat/simulacao-write-back`](https://github.com/alisonpezzott/fabric-app-dre-sankey-write-back/tree/feat/simulacao-write-back). A `main` é o ponto de partida da demonstração em vídeo, em que a funcionalidade é construída ao vivo a partir do [`prompt_feat_write_back.md`](prompt_feat_write_back.md).

![Modo Simulado com o painel "Simulação" aberto: premissa de −8% em despesas administrativas em 2026 e o impacto ao vivo, com EBITDA +R$ 1,3 mi e lucro líquido +R$ 944 mil.](docs/imagens/app-dre-sankey-write-back.png)

*Painel "Simulação" em 2026: −8% em despesas administrativas e o impacto ao vivo, antes de salvar.*

O app deixa de ser só leitura e vira uma ferramenta de planejamento:

1. **Criar uma simulação** com nome, descrição e período (ano e intervalo de meses), sempre sobre o **realizado**.
2. **Ajustar três premissas**, em percentual ou em reais:

   | premissa | contas afetadas |
   |---|---|
   | Receita líquida | as 5 receitas e as 2 deduções (mesmo fator: a receita líquida varia exatamente o ajuste) |
   | Custos (CPV/CSP) | as 4 contas de custo |
   | Despesas administrativas | pessoal administrativo e despesas gerais e administrativas |

3. **Ver o impacto na hora**, sem salvar: receita, lucro bruto, EBITDA, lucro líquido e margens, realizado × simulado.
4. **Alternar para o modo Simulado** na barra de filtros:
   - os KPIs mostram a variação contra o realizado;
   - a DRE ganha as colunas Realizado, Simulado, Δ e Δ%;
   - o Sankey é o mesmo gráfico, com os nós alterados tracejados.
5. **Salvar com justificativa** (obrigatória para premissas diferentes de zero), reabrir, duplicar e arquivar simulações.
6. **Consultar o histórico**: cada ação gera uma linha de auditoria.

Como os números ficam consistentes:

- O cálculo parte das **contas** devolvidas pelo modelo, nunca dos totais, e refaz a mesma cascata das medidas da DRE.
- O **IR & CSLL** é recalculado sobre a variação do LAIR, à alíquota efetiva do período.
- O Sankey simulado usa a mesma lógica de prejuízo da medida `sankey_valor`. Sem premissas, o simulado é idêntico ao realizado, e isso é testado contra o modelo.

O write-back grava em três tabelas do SQL Database do app (`simulacao`, `premissa_simulacao` e `auditoria_simulacao`). Cada usuário só vê e altera as próprias simulações, não há exclusão (só arquivar) e um controle de versão impede que uma aba sobrescreva a outra. Detalhes técnicos, diagramas e limitações em [`docs/simulacao_write_back.md`](docs/simulacao_write_back.md).

---

## Arquitetura

```
dataset/*.csv
      │  Power Query
      ▼
dre-sankey (modelo Import + report de conferência, publicados do .pbip)
      │  Execute Queries API (@microsoft/fabric-app-data)
      ▼
app-dre-sankey (Fabric App, publicado com o Rayfin)
      │  GraphQL do Rayfin (autenticação do Fabric)
      ▼
SQL Database do app (simulações, premissas e auditoria)
```

O modelo semântico continua sendo a fonte oficial e somente leitura: o write-back nunca escreve nele.

---

## Requisitos

### No Fabric

| requisito | por quê |
|---|---|
| Capacidade numa **região onde o Fabric Apps está disponível** | Confira em [Fabric region availability](https://learn.microsoft.com/en-us/fabric/admin/region-availability). |
| Workspace em **capacidade Fabric** (SKU F) | Fabric Apps não funciona em capacidade compartilhada nem em Pro. |
| Papel **Contributor** (ou superior) no workspace | Para publicar o modelo, o report e o app. |
| Workload **Fabric Apps** habilitado no tenant | Fabric Apps está em preview e precisa ser liberado pelo administrador. |
| Configuração **Semantic Model Execute Queries REST API** habilitada (também aparece como *Dataset Execute Queries REST API*) | O app consulta o modelo por essa API. |

### Na máquina

| ferramenta | para quê | instalação |
|---|---|---|
| Power BI Desktop | abrir e publicar o `dre-sankey.pbip` | https://www.microsoft.com/power-platform/products/power-bi/desktop |
| Node.js 20 ou superior (inclui o npm) | instalar as dependências e publicar o app | https://nodejs.org (versão LTS) |

O Rayfin, a ferramenta da Microsoft que publica Fabric Apps, não precisa ser instalado: o `npm install` já baixa ele junto com o app.

---

## Instalação passo a passo

### 1. Baixar o projeto

Nesta página do GitHub, clique em **Code → Download ZIP** e extraia o arquivo numa pasta da sua máquina. Para a versão com simulação, troque antes para o branch `feat/simulacao-write-back`.

### 2. Publicar o modelo e o report

1. Abra o `fabric-workspace/dre-sankey.pbip` no Power BI Desktop.
2. Clique em **Atualizar**: o projeto vem sem dados, e o Power Query baixa os 7 CSVs de `dataset/` (se pedir credencial, escolha **Anônimo**).
3. Clique em **Publicar** e escolha o seu workspace.

O modelo semântico e o report `dre-sankey` aparecem no workspace, já com os dados.

### 3. Publicar o app

Abra um terminal na pasta `app-dre-sankey`, dentro da pasta extraída, e rode:

```bash
# baixa as dependências do app (alguns minutos na primeira vez)
npm install

# abre o navegador para entrar com a sua conta do Fabric
npx rayfin login

# liga o app ao modelo: abra o modelo semântico dre-sankey no portal e copie a URL da barra de endereço
npm run bind -- "<URL do dre-sankey>"

# faz o build e publica o app no workspace
npx rayfin up --workspace <nome-do-workspace> --item-name app-dre-sankey
```

Abra o `app-dre-sankey` pelo workspace, no portal do Fabric.

No branch com simulação, o mesmo `npx rayfin up` também cria o SQL Database do app e aplica as tabelas das simulações.

---

## Validação

- No report `dre-sankey`, a página **Qualidade** deve mostrar `testes_com_falha = 0`.
- Os números do app batem com o report no mesmo recorte.

Números de referência (realizado, consolidado):

| métrica | 2024 | 2025 | 2026 |
|---|---|---|---|
| receita líquida | 135.461.230,60 | 154.819.681,80 | 175.717.045,70 |
| lucro líquido | 15.882.255,48 | 13.088.163,15 | 24.560.318,22 |
| margem líquida | 11,7% | 8,5% | 14,0% |

---

## Segurança

- O app não guarda credenciais. A autenticação é a nativa do Fabric (Entra ID), e cada usuário consulta o modelo com a própria identidade.
- O RLS do modelo semântico não protege o SQL Database do app. As simulações têm regra própria: cada usuário só lê e altera as dele, e a auditoria não pode ser alterada nem apagada pelo usuário.
- Não cole dados reais de clientes em prompts, issues ou logs.

---

## Limitações conhecidas

- **Fabric Apps está em preview.** Comandos, pacotes e comportamento podem mudar.
- Apps ligados a modelo semântico só abrem **dentro do portal do Fabric**.
- Quem for usar o app, além de quem publicou, precisa de permissão **Build** e **Read** no modelo `dre-sankey`.
- Na simulação, a tendência mensal e a evolução de um nó continuam mostrando o realizado. A lista de simulações e o histórico mostram até 100 itens, e o controle de versão tem uma pequena janela de corrida, porque o Rayfin não tem atualização condicional.

---

## Licença

[MIT](LICENSE). O código herdado do template de Fabric Apps da Microsoft, em `app-dre-sankey/`, mantém a licença MIT original ([app-dre-sankey/LICENSE](app-dre-sankey/LICENSE)).
