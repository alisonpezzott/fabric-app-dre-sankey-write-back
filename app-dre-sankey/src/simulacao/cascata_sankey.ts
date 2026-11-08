// Porte em TypeScript da medida sankey_valor (seção 7.3 do CLAUDE.md): exceção única à
// regra 5. Roda sobre os valores por conta JÁ AGREGADOS do recorte (nunca soma links
// pré-calculados por mês ou região) e é testado contra as fixtures de sankey_valor.

import { numero, texto, type Linha } from "@/dados/cliente_modelo";
import type { LinkSankeyEntrada } from "@/dados/layout_sankey";
import { calcular_subtotais, valor_da_conta, type ContaDre } from "./motor_simulacao";

/** Uma linha de dim_link_sankey (q_links_sankey_lista). */
export interface DefinicaoLink {
    cod_link: string;
    cod_no_origem: string;
    cod_no_destino: string;
    /** "" = link de subtotal ou de prejuízo */
    cod_conta: string;
    tipo_link: string;
    etapa: number;
    ordem_link: number;
}

export interface LinkCalculado {
    cod_link: string;
    cod_no_origem: string;
    cod_no_destino: string;
    tipo_link: string;
    ordem_link: number;
    valor: number;
}

export function definicoes_da_consulta(linhas: Linha[]): DefinicaoLink[] {
    return linhas
        .filter((l) => texto(l, "cod_link") !== "")
        .map((l) => ({
            cod_link: texto(l, "cod_link"),
            cod_no_origem: texto(l, "cod_no_origem"),
            cod_no_destino: texto(l, "cod_no_destino"),
            cod_conta: texto(l, "cod_conta"),
            tipo_link: texto(l, "tipo_link"),
            etapa: numero(l, "etapa") ?? 0,
            ordem_link: numero(l, "ordem_link") ?? 0,
        }))
        .sort((a, b) => a.ordem_link - b.ordem_link);
}

/** Mesmo limiar da medida: links até R$ 0,005 ficam vazios (o nó some). */
export const limiar_link = 0.005;

/** Valor de cada link da cascata (mesmas variáveis s0…s5 e g_* da medida). */
export function valores_cascata(contas: ContaDre[]): Map<string, number> {
    const t = calcular_subtotais(contas);
    const g_custos = -t.custos;
    const g_opex = -t.despesas_operacionais;
    const g_da = -t.depreciacao_amortizacao;
    const g_fin = -t.resultado_financeiro;
    const g_ir = -t.ir_csll;
    const s0 = t.receita_liquida;
    const s1 = Math.max(s0 - g_custos, 0);
    const s2 = Math.max(s1 - g_opex, 0);
    const s3 = Math.max(s2 - g_da, 0);
    const s4 = Math.max(s3 - g_fin, 0);
    const s5 = Math.max(s4 - g_ir, 0);
    return new Map<string, number>([
        ["receita_bruta__deducoes_da_receita", -t.deducoes_receita],
        ["receita_bruta__receita_liquida", s0],
        ["receita_liquida__custos_cpv_csp", Math.min(s0, g_custos)],
        ["prejuizo_liquido__custos_cpv_csp", g_custos - Math.min(s0, g_custos)],
        ["receita_liquida__lucro_bruto", s1],
        ["lucro_bruto__despesas_operacionais", Math.min(s1, g_opex)],
        ["prejuizo_liquido__despesas_operacionais", g_opex - Math.min(s1, g_opex)],
        ["lucro_bruto__ebitda", s2],
        ["ebitda__depreciacao_amortizacao", Math.min(s2, g_da)],
        ["prejuizo_liquido__depreciacao_amortizacao", g_da - Math.min(s2, g_da)],
        ["ebitda__ebit_lucro_operacional", s3],
        ["ebit_lucro_operacional__resultado_financeiro_liquido", Math.min(s3, g_fin)],
        ["prejuizo_liquido__resultado_financeiro_liquido", g_fin - Math.min(s3, g_fin)],
        ["ebit_lucro_operacional__lair", s4],
        ["lair__ir_csll", Math.min(s4, g_ir)],
        ["prejuizo_liquido__ir_csll", g_ir - Math.min(s4, g_ir)],
        ["lair__lucro_liquido", s5],
    ]);
}

/**
 * Links com valor do recorte, na ordem de dim_link_sankey. Link folha = valor da conta
 * (fato_lancamentos[valor], sempre positivo); subtotal e prejuízo = cascata.
 */
export function calcular_links(definicoes: DefinicaoLink[], contas: ContaDre[]): LinkCalculado[] {
    const cascata = valores_cascata(contas);
    const por_conta = new Map<string, number>();
    for (const conta of contas) {
        por_conta.set(conta.cod_conta, (por_conta.get(conta.cod_conta) ?? 0) + valor_da_conta(conta));
    }
    const resultado: LinkCalculado[] = [];
    for (const definicao of definicoes) {
        const valor = definicao.cod_conta !== ""
            ? (por_conta.get(definicao.cod_conta) ?? 0)
            : cascata.get(definicao.cod_link);
        if (valor === undefined) {
            throw new Error(`Link de subtotal sem regra na cascata: ${definicao.cod_link}`);
        }
        if (valor > limiar_link) {
            resultado.push({
                cod_link: definicao.cod_link,
                cod_no_origem: definicao.cod_no_origem,
                cod_no_destino: definicao.cod_no_destino,
                tipo_link: definicao.tipo_link,
                ordem_link: definicao.ordem_link,
                valor,
            });
        }
    }
    return resultado;
}

/**
 * Links do Sankey simulado, prontos para o GraficoSankey: o valor é o simulado e
 * `valor_realizado` guarda o realizado do mesmo link (0 quando o link só existe no simulado).
 */
export function links_comparados(
    definicoes: DefinicaoLink[],
    contas_realizado: ContaDre[],
    contas_simuladas: ContaDre[],
): LinkSankeyEntrada[] {
    const realizado = new Map(calcular_links(definicoes, contas_realizado).map((l) => [l.cod_link, l.valor]));
    return calcular_links(definicoes, contas_simuladas).map((l) => ({
        cod_no_origem: l.cod_no_origem,
        cod_no_destino: l.cod_no_destino,
        tipo_link: l.tipo_link,
        valor: l.valor,
        valor_aa: null,
        var_aa_pct: null,
        valor_realizado: realizado.get(l.cod_link) ?? 0,
    }));
}

/** Valor de cada nó (soma das entradas, ou das saídas nos nós só de saída). */
export function valores_nos(links: { cod_no_origem: string; cod_no_destino: string; valor: number }[]): Map<string, number> {
    const entradas = new Map<string, number>();
    const saidas = new Map<string, number>();
    for (const l of links) {
        entradas.set(l.cod_no_destino, (entradas.get(l.cod_no_destino) ?? 0) + l.valor);
        saidas.set(l.cod_no_origem, (saidas.get(l.cod_no_origem) ?? 0) + l.valor);
    }
    const nos = new Map<string, number>();
    for (const cod of new Set([...entradas.keys(), ...saidas.keys()])) {
        nos.set(cod, Math.max(entradas.get(cod) ?? 0, saidas.get(cod) ?? 0));
    }
    return nos;
}
