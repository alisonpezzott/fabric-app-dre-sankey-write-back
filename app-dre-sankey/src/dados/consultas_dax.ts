// Todas as consultas DAX do app (seção 8.5 do CLAUDE.md). O app só apresenta:
// os cálculos ficam nas medidas do dre-sankey.

import {
    montar_filtros,
    type DominioFiltros,
    type EstadoFiltros,
    type OpcoesFiltros,
} from "./construtor_filtros";

/** Alias da conexão em fabric.yaml. */
export const conexao_modelo = "modelo_dre";

export interface ContextoConsulta {
    filtros: EstadoFiltros;
    dominio: DominioFiltros;
}

/** SUMMARIZECOLUMNS com colunas de agrupamento, filtros e pares nome/expressão. */
function summarize(colunas: string[], filtros: string[], medidas: [string, string][]): string {
    const argumentos = [
        ...colunas,
        ...filtros,
        ...medidas.map(([nome, expressao]) => `"${nome}", ${expressao}`),
    ];
    return `SUMMARIZECOLUMNS (\n    ${argumentos.join(",\n    ")}\n)`;
}

function filtros_de(ctx: ContextoConsulta, opcoes?: OpcoesFiltros): string[] {
    return montar_filtros(ctx.filtros, ctx.dominio, opcoes);
}

function medidas(nomes: string[]): [string, string][] {
    return nomes.map((nome) => [nome, `[${nome}]`]);
}

// ---------------------------------------------------------------- dimensões

export const q_anos = `EVALUATE
DISTINCT ( dim_calendario[ano] )
ORDER BY dim_calendario[ano]`;

/** Meses do calendário: domínio da seleção cruzada por mês e rótulos dos meses selecionados. */
export const q_calendario = `EVALUATE
SUMMARIZECOLUMNS ( dim_calendario[indice_mes], dim_calendario[ano], dim_calendario[mes], dim_calendario[mes_ano] )
ORDER BY dim_calendario[indice_mes]`;

export const q_meses = `EVALUATE
SUMMARIZECOLUMNS ( dim_calendario[mes], dim_calendario[nome_mes] )
ORDER BY dim_calendario[mes]`;

export const q_cenarios = `EVALUATE
dim_cenario
ORDER BY dim_cenario[ordem_cenario]`;

export const q_regioes_lista = `EVALUATE
dim_regiao
ORDER BY dim_regiao[nome_regiao]`;

export const q_sankey_nos = `EVALUATE
dim_no_sankey
ORDER BY dim_no_sankey[coluna_sankey]`;

/** Plano de contas: domínio do mapa de premissas da simulação (simulacao/mapa_premissas.ts). */
export const q_contas = `EVALUATE
SELECTCOLUMNS (
    dim_conta,
    "cod_conta", dim_conta[cod_conta],
    "nome_conta", dim_conta[nome_conta],
    "cod_grupo", dim_conta[cod_grupo],
    "natureza", dim_conta[natureza],
    "ordem_dre", dim_conta[ordem_dre]
)
ORDER BY [ordem_dre]`;

/**
 * Todos os links possíveis do Sankey, com a conta de cada link folha (`cod_conta` vazio =
 * subtotal ou prejuízo). Alimenta a cascata do Sankey simulado (simulacao/cascata_sankey.ts).
 */
export const q_links_sankey_lista = `EVALUATE
SELECTCOLUMNS (
    dim_link_sankey,
    "cod_link", dim_link_sankey[cod_link],
    "cod_no_origem", dim_link_sankey[cod_no_origem],
    "cod_no_destino", dim_link_sankey[cod_no_destino],
    "cod_conta", dim_link_sankey[cod_conta],
    "tipo_link", dim_link_sankey[tipo_link],
    "etapa", dim_link_sankey[etapa],
    "ordem_link", dim_link_sankey[ordem_link]
)
ORDER BY [ordem_link]`;

export const q_carga = `EVALUATE
ROW ( "data_ultima_carga", [data_ultima_carga] )`;

// ---------------------------------------------------------------- KPIs e tendência

export function q_kpis(ctx: ContextoConsulta): string {
    return `EVALUATE
${summarize([], filtros_de(ctx), medidas([
        "receita_liquida",
        "lucro_bruto",
        "ebitda",
        "lucro_liquido",
        "margem_liquida",
        "prejuizo_liquido",
        "var_receita_liquida_aa_pct",
        "var_lucro_bruto_aa_pct",
        "var_ebitda_aa_pct",
        "var_lucro_liquido_aa_pct",
        "var_margem_liquida_aa_pp",
        "var_receita_liquida_orcado_pct",
        "var_lucro_liquido_orcado_pct",
    ]))}`;
}

/** Série mensal: alimenta o gráfico de tendência e as sparklines dos KPIs. */
export function q_tendencia(ctx: ContextoConsulta): string {
    return `EVALUATE
${summarize(
        ["dim_calendario[indice_mes]", "dim_calendario[mes_ano]"],
        filtros_de(ctx, { sem_mes: true }),
        medidas([
            "receita_liquida",
            "lucro_bruto",
            "ebitda",
            "lucro_liquido",
            "margem_liquida",
            "var_lucro_liquido_orcado_pct",
        ]),
    )}
ORDER BY dim_calendario[indice_mes]`;
}

export function q_regioes(ctx: ContextoConsulta): string {
    return `EVALUATE
${summarize(
        ["dim_regiao[cod_regiao]", "dim_regiao[nome_regiao]"],
        filtros_de(ctx, { sem_regiao: true }),
        medidas(["receita_liquida", "margem_liquida", "lucro_liquido"]),
    )}
ORDER BY [receita_liquida] DESC`;
}

// ---------------------------------------------------------------- Sankey

/**
 * Só os links com valor no recorte. O FILTER é necessário porque o SUMMARIZECOLUMNS
 * mantém a linha quando só o valor do ano anterior existe.
 */
export function q_sankey_links(ctx: ContextoConsulta): string {
    return `EVALUATE
FILTER (
    ${summarize(
        [
            "dim_link_sankey[ordem_link]",
            "dim_link_sankey[cod_no_origem]",
            "dim_link_sankey[cod_no_destino]",
            "dim_link_sankey[tipo_link]",
            "dim_link_sankey[etapa]",
        ],
        filtros_de(ctx),
        [
            ["valor", "[sankey_valor]"],
            ["valor_aa", "[sankey_valor_aa]"],
            ["var_aa_pct", "[var_sankey_valor_aa_pct]"],
        ],
    ).replace(/\n/g, "\n    ")},
    NOT ISBLANK ( [valor] )
)
ORDER BY dim_link_sankey[ordem_link]`;
}

/**
 * Evolução mensal de um nó: soma das entradas, ou das saídas para nós que só
 * têm saídas (receitas e prejuízo). `cod_no` precisa vir de dim_no_sankey.
 */
export function q_detalhe_no(ctx: ContextoConsulta, cod_no: string, nos_validos: string[], pelas_saidas: boolean): string {
    if (!nos_validos.includes(cod_no)) {
        throw new Error(`Nó fora do domínio: ${cod_no}`);
    }
    const coluna = pelas_saidas ? "dim_link_sankey[cod_no_origem]" : "dim_link_sankey[cod_no_destino]";
    const links = `FILTER ( ALL ( dim_link_sankey ), ${coluna} = "${cod_no.replace(/"/g, '""')}" )`;
    return `EVALUATE
${summarize(
        ["dim_calendario[indice_mes]", "dim_calendario[mes_ano]"],
        filtros_de(ctx, { sem_mes: true }),
        [
            ["valor", `SUMX ( ${links}, [sankey_valor] )`],
            ["valor_aa", `SUMX ( ${links}, [sankey_valor_aa] )`],
            ["lucro_liquido", "[lucro_liquido]"],
        ],
    )}
ORDER BY dim_calendario[indice_mes]`;
}

// ---------------------------------------------------------------- DRE

/**
 * Linhas da DRE por conta, realizado × orçado. `natureza` (receita/despesa) não muda o grão
 * (uma natureza por conta) e permite ao motor da simulação converter valor ↔ valor_dre.
 */
export function q_dre(ctx: ContextoConsulta): string {
    return `EVALUATE
ADDCOLUMNS (
    ${summarize(
        [
            "dim_conta[ordem_dre]",
            "dim_conta[cod_conta]",
            "dim_conta[nome_conta]",
            "dim_conta[cod_grupo]",
            "dim_conta[natureza]",
        ],
        filtros_de(ctx, { sem_cenario: true }),
        [
            ["realizado", `CALCULATE ( [valor_dre], dim_cenario[cod_cenario] = "realizado" )`],
            ["orcado", `CALCULATE ( [valor_dre], dim_cenario[cod_cenario] = "orcado" )`],
        ],
    ).replace(/\n/g, "\n    ")},
    "var_pct", DIVIDE ( [realizado] - [orcado], ABS ( [orcado] ) )
)
ORDER BY dim_conta[ordem_dre]`;
}

/**
 * Subtotais da DRE pelas medidas do modelo, com o rótulo de dim_no_sankey.
 * `apos_ordem_dre` posiciona a linha de subtotal depois da última conta do bloco.
 */
export function q_dre_subtotais(ctx: ContextoConsulta): string {
    const subtotais: [string, string, number][] = [
        ["receita_bruta", "receita_bruta", 5],
        ["receita_liquida", "receita_liquida", 7],
        ["lucro_bruto", "lucro_bruto", 11],
        ["ebitda", "ebitda", 16],
        ["ebit_lucro_operacional", "ebit", 17],
        ["lair", "lair", 18],
        ["lucro_liquido", "lucro_liquido", 19],
    ];
    const linhas = subtotais.map(([cod_no, , apos]) => `{ "${cod_no}", ${apos} }`).join(", ");
    // o SWITCH fica fora do CALCULATE: a coluna do DATATABLE não é visível dentro dele
    const casos = (cenario: string) =>
        subtotais
            .map(([cod_no, medida]) => `"${cod_no}", CALCULATE ( [${medida}], dim_cenario[cod_cenario] = "${cenario}" )`)
            .join(", ");
    const filtros = filtros_de(ctx, { sem_cenario: true });
    const corpo = `ADDCOLUMNS (
        ADDCOLUMNS (
            DATATABLE ( "cod_no", STRING, "apos_ordem_dre", INTEGER, { ${linhas} } ),
            "nome_no", LOOKUPVALUE ( dim_no_sankey[nome_no], dim_no_sankey[cod_no], [cod_no] ),
            "realizado", SWITCH ( [cod_no], ${casos("realizado")} ),
            "orcado", SWITCH ( [cod_no], ${casos("orcado")} )
        ),
        "var_pct", DIVIDE ( [realizado] - [orcado], ABS ( [orcado] ) )
    )`;
    const tabela = filtros.length === 0 ? corpo : `CALCULATETABLE (\n    ${corpo},\n    ${filtros.join(",\n    ")}\n)`;
    return `EVALUATE
${tabela}
ORDER BY [apos_ordem_dre]`;
}

// ---------------------------------------------------------------- operacional

/** O operacional só existe no realizado: ignora o filtro de cenário. */
export function q_operacional(ctx: ContextoConsulta): string {
    return `EVALUATE
${summarize([], filtros_de(ctx, { sem_cenario: true }), medidas([
        "clientes_ativos",
        "novos_clientes",
        "churn_medio_pct",
        "nps_medio",
        "headcount",
        "receita_por_cliente",
        "receita_por_colaborador",
    ]))}`;
}
