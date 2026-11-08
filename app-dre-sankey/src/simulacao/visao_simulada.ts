// Visão do modo Simulado: KPIs, linhas da DRE e Sankey comparando realizado × simulado,
// a partir do resultado do motor. Só monta dados para os componentes; não calcula a DRE.

import type { DataTable } from "@microsoft/fabric-visuals-core";

import { numero, texto, type Linha } from "@/dados/cliente_modelo";
import { formatos } from "@/dados/formatacao";
import type { LinkSankeyEntrada } from "@/dados/layout_sankey";
import { calcular_links, links_comparados, valores_nos, type DefinicaoLink } from "./cascata_sankey";
import { dividir, type ResultadoSimulacao, type Subtotais } from "./motor_simulacao";

/** Diferença entre simulado e realizado; Δ% sobre |realizado| (null quando o realizado é 0). */
export interface Comparacao {
    realizado: number | null;
    simulado: number | null;
    delta: number | null;
    delta_pct: number | null;
}

export function comparar(realizado: number | null, simulado: number | null): Comparacao {
    if (realizado === null || simulado === null) return { realizado, simulado, delta: null, delta_pct: null };
    const delta = simulado - realizado;
    return { realizado, simulado, delta, delta_pct: dividir(delta, Math.abs(realizado)) };
}

export type CampoKpiSimulado = "receita_liquida" | "lucro_bruto" | "ebitda" | "lucro_liquido" | "margem_liquida";

/** KPIs do modo Simulado; nas margens, o Δ fica em pontos (fração: 0,01 = 1 p.p.). */
export function kpis_simulados(resultado: ResultadoSimulacao): Record<CampoKpiSimulado, Comparacao> {
    const r = resultado.realizado;
    const s = resultado.simulado;
    const margem = comparar(r.margem_liquida, s.margem_liquida);
    return {
        receita_liquida: comparar(r.receita_liquida, s.receita_liquida),
        lucro_bruto: comparar(r.lucro_bruto, s.lucro_bruto),
        ebitda: comparar(r.ebitda, s.ebitda),
        lucro_liquido: comparar(r.lucro_liquido, s.lucro_liquido),
        margem_liquida: { ...margem, delta_pct: margem.delta },
    };
}

/** Subtotais da DRE na ordem da q_dre_subtotais (cod_no → campo do motor). */
const campo_subtotal: Record<string, keyof Subtotais> = {
    receita_bruta: "receita_bruta",
    receita_liquida: "receita_liquida",
    lucro_bruto: "lucro_bruto",
    ebitda: "ebitda",
    ebit_lucro_operacional: "ebit",
    lair: "lair",
    lucro_liquido: "lucro_liquido",
};

const subtotais_destacados = new Set(["lucro_bruto", "ebitda", "ebit_lucro_operacional", "lair", "lucro_liquido"]);

/**
 * Linhas da DRE do modo Simulado (Realizado | Simulado | Δ | Δ%). Contas e rótulos vêm das
 * consultas do recorte (q_dre e q_dre_subtotais); os valores, do motor.
 */
export function montar_linhas_dre_simulada(
    contas: Linha[],
    subtotais: Linha[],
    resultado: ResultadoSimulacao,
): DataTable {
    const simuladas = new Map(resultado.contas_simuladas.map((c) => [c.cod_conta, c.valor_dre]));
    const realizadas = new Map(resultado.contas_realizado.map((c) => [c.cod_conta, c.valor_dre]));
    const linha = (tipo: string, nome: string, c: Comparacao) => [tipo, nome, c.realizado, c.simulado, c.delta, c.delta_pct];

    const itens = [
        ...contas.map((l) => {
            const cod = texto(l, "cod_conta");
            const comparacao = comparar(realizadas.get(cod) ?? 0, simuladas.get(cod) ?? realizadas.get(cod) ?? 0);
            const alterada = Math.abs(comparacao.delta ?? 0) > 0.005;
            return {
                ordem: numero(l, "ordem_dre") ?? 0,
                linha: linha(alterada ? "conta_alterada" : "conta", texto(l, "nome_conta"), comparacao),
            };
        }),
        ...subtotais.map((l) => {
            const cod = texto(l, "cod_no");
            const campo = campo_subtotal[cod];
            if (!campo) throw new Error(`Subtotal sem regra no motor: ${cod}`);
            return {
                ordem: (numero(l, "apos_ordem_dre") ?? 0) + 0.5,
                linha: linha(
                    subtotais_destacados.has(cod) ? "destaque" : "subtotal",
                    texto(l, "nome_no"),
                    comparar(resultado.realizado[campo] as number, resultado.simulado[campo] as number),
                ),
            };
        }),
    ].sort((a, b) => a.ordem - b.ordem);

    return {
        columns: [
            { name: "tipo_linha", displayName: "Tipo" },
            { name: "nome", displayName: "Linha da DRE" },
            { name: "realizado", displayName: "Realizado", format: formatos.moeda },
            { name: "simulado", displayName: "Simulado", format: formatos.moeda },
            { name: "delta", displayName: "Δ", format: formatos.moeda },
            { name: "delta_pct", displayName: "Δ %", format: formatos.variacao_pct },
        ],
        rows: itens.map((item) => item.linha),
    };
}

export interface SankeySimulado {
    links: LinkSankeyEntrada[];
    /** Valor realizado de cada nó (inclusive dos que somem no simulado). */
    nos_realizado: Map<string, number>;
}

export function sankey_simulado(definicoes: DefinicaoLink[], resultado: ResultadoSimulacao): SankeySimulado {
    return {
        links: links_comparados(definicoes, resultado.contas_realizado, resultado.contas_simuladas),
        nos_realizado: valores_nos(calcular_links(definicoes, resultado.contas_realizado)),
    };
}
