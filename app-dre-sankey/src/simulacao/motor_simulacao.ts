// Motor da simulação: puro e determinístico. Recalcula a DRE a partir das contas (nunca dos
// totais): fator por conta → contas do recorte ajustadas → cascata da pasta 01_dre → IR
// incremental. Sem premissas, o resultado é idêntico ao realizado do modelo (teste).

import { numero, texto, type Linha } from "@/dados/cliente_modelo";
import {
    cods_premissa,
    definicoes_premissas,
    premissa_da_conta,
    validar_mapa,
    type CodPremissa,
    type ContaPlano,
    type TipoAjuste,
} from "./mapa_premissas";
import { erro_valor_premissa, limite_fator } from "./validacao_premissas";

export type Natureza = "receita" | "despesa";

/** Valor de uma conta num recorte, cenário realizado. `valor_dre`: receita +, despesa −. */
export interface ContaDre {
    cod_conta: string;
    cod_grupo: string;
    natureza: Natureza;
    valor_dre: number;
}

export interface PremissaAjuste {
    cod_premissa: CodPremissa;
    tipo_ajuste: TipoAjuste;
    valor_ajuste: number;
}

/** Linhas da q_dre (coluna `realizado`, com `natureza`) → contas. Realizado vazio = 0. */
export function contas_da_consulta(linhas: Linha[]): ContaDre[] {
    return linhas
        .filter((l) => texto(l, "cod_conta") !== "")
        .map((l) => {
            const natureza = texto(l, "natureza");
            if (natureza !== "receita" && natureza !== "despesa") {
                throw new Error(`Natureza inválida na conta ${texto(l, "cod_conta")}: "${natureza}"`);
            }
            return {
                cod_conta: texto(l, "cod_conta"),
                cod_grupo: texto(l, "cod_grupo"),
                natureza,
                valor_dre: numero(l, "realizado") ?? 0,
            };
        });
}

/** valor da conta (sempre positivo, como fato_lancamentos[valor]) a partir de valor_dre. */
export function valor_da_conta(conta: ContaDre): number {
    return conta.natureza === "receita" ? conta.valor_dre : -conta.valor_dre;
}

// ---------------------------------------------------------------- subtotais

export interface Subtotais {
    receita_bruta: number;
    deducoes_receita: number;
    receita_liquida: number;
    custos: number;
    lucro_bruto: number;
    despesas_operacionais: number;
    ebitda: number;
    depreciacao_amortizacao: number;
    ebit: number;
    resultado_financeiro: number;
    lair: number;
    ir_csll: number;
    lucro_liquido: number;
    margem_bruta: number | null;
    margem_ebitda: number | null;
    margem_ebit: number | null;
    margem_liquida: number | null;
    prejuizo_liquido: number;
}

/** DIVIDE do DAX: `null` quando o denominador é zero. */
export function dividir(numerador: number, denominador: number): number | null {
    return denominador === 0 ? null : numerador / denominador;
}

/** Mesma cascata das medidas da pasta 01_dre (valores em valor_dre). */
export function calcular_subtotais(contas: ContaDre[]): Subtotais {
    const grupo = (cod_grupo: string) =>
        contas.filter((c) => c.cod_grupo === cod_grupo).reduce((s, c) => s + c.valor_dre, 0);
    const receita_bruta = grupo("receita_bruta");
    const deducoes_receita = grupo("deducoes_da_receita");
    const receita_liquida = receita_bruta + deducoes_receita;
    const custos = grupo("custos_cpv_csp");
    const lucro_bruto = receita_liquida + custos;
    const despesas_operacionais = grupo("despesas_operacionais");
    const ebitda = lucro_bruto + despesas_operacionais;
    const depreciacao_amortizacao = grupo("depreciacao_amortizacao");
    const ebit = ebitda + depreciacao_amortizacao;
    const resultado_financeiro = grupo("resultado_financeiro");
    const lair = ebit + resultado_financeiro;
    const ir_csll = grupo("impostos_sobre_o_lucro");
    const lucro_liquido = lair + ir_csll;
    return {
        receita_bruta,
        deducoes_receita,
        receita_liquida,
        custos,
        lucro_bruto,
        despesas_operacionais,
        ebitda,
        depreciacao_amortizacao,
        ebit,
        resultado_financeiro,
        lair,
        ir_csll,
        lucro_liquido,
        margem_bruta: dividir(lucro_bruto, receita_liquida),
        margem_ebitda: dividir(ebitda, receita_liquida),
        margem_ebit: dividir(ebit, receita_liquida),
        margem_liquida: dividir(lucro_liquido, receita_liquida),
        prejuizo_liquido: Math.max(-lucro_liquido, 0),
    };
}

// ---------------------------------------------------------------- fatores

/** Total da categoria na base (positivo num negócio normal). */
export function total_categoria(base: ContaDre[], cod: CodPremissa): number {
    const definicao = definicoes_premissas[cod];
    const contas = base.filter((c) => definicao.contas.includes(c.cod_conta));
    return definicao.medida_total === "liquido"
        ? contas.reduce((s, c) => s + c.valor_dre, 0)
        : contas.reduce((s, c) => s + valor_da_conta(c), 0);
}

export interface Fatores {
    /** Fator de cada premissa (0 = sem efeito). Premissa inválida fica com 0. */
    por_premissa: Record<CodPremissa, number>;
    /** Premissas que não puderam ser aplicadas, com a mensagem para a UI. */
    invalidas: Partial<Record<CodPremissa, string>>;
    /** Total de cada categoria na base, para a UI mostrar o equivalente em %/R$. */
    totais_base: Record<CodPremissa, number>;
}

const limiar_zero = 0.005;

/**
 * Fator por premissa: percentual → p / 100; absoluto → valor / total da categoria na base
 * (na receita, sobre a receita líquida base). Total zero com ajuste absoluto é premissa
 * inválida, nunca divisão por zero.
 */
export function calcular_fatores(base: ContaDre[], premissas: PremissaAjuste[]): Fatores {
    const por_premissa = Object.fromEntries(cods_premissa.map((c) => [c, 0])) as Record<CodPremissa, number>;
    const totais_base = Object.fromEntries(cods_premissa.map((c) => [c, total_categoria(base, c)])) as Record<
        CodPremissa,
        number
    >;
    const invalidas: Partial<Record<CodPremissa, string>> = {};

    for (const premissa of premissas) {
        const cod = premissa.cod_premissa;
        const erro = erro_valor_premissa(premissa);
        if (erro) {
            invalidas[cod] = erro;
            continue;
        }
        if (premissa.valor_ajuste === 0) continue;
        let fator: number;
        if (premissa.tipo_ajuste === "percentual") {
            fator = premissa.valor_ajuste / 100;
        } else {
            const total = totais_base[cod];
            if (Math.abs(total) < limiar_zero) {
                invalidas[cod] = "A categoria não tem movimento no período: use um ajuste percentual.";
                continue;
            }
            fator = premissa.valor_ajuste / total;
        }
        if (Math.abs(fator) > limite_fator + 1e-12) {
            invalidas[cod] = "O ajuste passa do valor da categoria no período.";
            continue;
        }
        por_premissa[cod] = fator;
    }
    return { por_premissa, invalidas, totais_base };
}

/** Multiplica cada conta afetada por (1 + fator). Contas sem premissa ficam como estão. */
export function aplicar_fatores(contas: ContaDre[], fatores: Fatores): ContaDre[] {
    return contas.map((conta) => {
        const cod = premissa_da_conta(conta.cod_conta);
        const fator = cod ? fatores.por_premissa[cod] : 0;
        return fator === 0 ? conta : { ...conta, valor_dre: conta.valor_dre * (1 + fator) };
    });
}

// ---------------------------------------------------------------- IR incremental

export interface Aliquota {
    /** Alíquota efetiva da base (IR ÷ LAIR); 0 quando inválida. */
    valor: number;
    /** true quando o IR fica fixo (LAIR da base ≤ 0 ou alíquota fora de [0, 1]). */
    ir_fixo: boolean;
}

export function aliquota_base(base: Subtotais): Aliquota {
    if (!(base.lair > 0)) return { valor: 0, ir_fixo: true };
    const aliquota = -base.ir_csll / base.lair;
    if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 1) return { valor: 0, ir_fixo: true };
    return { valor: aliquota, ir_fixo: false };
}

const conta_ir = "irp_ir_csll";

/**
 * IR & CSLL incremental: ir_simulado = max ( 0, ir_realizado + alíquota × ΔLAIR ), em gasto
 * (positivo). Sem variação de LAIR o IR do realizado é mantido como está.
 */
export function ajustar_ir(contas_simuladas: ContaDre[], realizado: Subtotais, aliquota: Aliquota): ContaDre[] {
    const sem_ir = calcular_subtotais(contas_simuladas);
    const delta_lair = sem_ir.lair - realizado.lair;
    if (delta_lair === 0 || aliquota.valor === 0) return contas_simuladas;
    const ir_realizado = -realizado.ir_csll;
    const ir_simulado = Math.max(0, ir_realizado + aliquota.valor * delta_lair);
    const contas_ir = contas_simuladas.filter((c) => c.cod_conta === conta_ir);
    if (contas_ir.length === 0) {
        return [...contas_simuladas, { cod_conta: conta_ir, cod_grupo: "impostos_sobre_o_lucro", natureza: "despesa", valor_dre: -ir_simulado }];
    }
    return contas_simuladas.map((c) => (c.cod_conta === conta_ir ? { ...c, valor_dre: -ir_simulado } : c));
}

// ---------------------------------------------------------------- simulação

export interface ResultadoSimulacao {
    fatores: Fatores;
    aliquota: Aliquota;
    contas_realizado: ContaDre[];
    contas_simuladas: ContaDre[];
    realizado: Subtotais;
    simulado: Subtotais;
    /** Avisos para a UI (IR fixo, período sem dados…). */
    avisos: string[];
}

export class ErroSimulacao extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroSimulacao";
    }
}

/**
 * Simula o recorte da tela.
 * @param plano  plano de contas do modelo (q_contas), para validar o mapa de premissas
 * @param base   contas no período da simulação, todas as regiões (q_dre do período)
 * @param recorte contas do recorte atual da tela (q_dre com os filtros da barra e a seleção)
 */
export function simular(
    plano: ContaPlano[],
    base: ContaDre[],
    recorte: ContaDre[],
    premissas: PremissaAjuste[],
): ResultadoSimulacao {
    validar_mapa(plano);
    const contas_plano = new Set(plano.map((c) => c.cod_conta));
    const desconhecidas = [...base, ...recorte].filter((c) => !contas_plano.has(c.cod_conta));
    if (desconhecidas.length > 0) {
        throw new ErroSimulacao(`Contas fora do plano de contas: ${[...new Set(desconhecidas.map((c) => c.cod_conta))].join(", ")}`);
    }

    const avisos: string[] = [];
    if (base.length === 0 || base.every((c) => c.valor_dre === 0)) {
        avisos.push("O período da simulação não tem lançamentos no realizado.");
    }

    const fatores = calcular_fatores(base, premissas);
    const subtotais_base = calcular_subtotais(base);
    const aliquota = aliquota_base(subtotais_base);
    const tem_premissa = Object.values(fatores.por_premissa).some((f) => f !== 0);
    if (aliquota.ir_fixo && tem_premissa) {
        avisos.push("O LAIR do período não permite calcular a alíquota efetiva: o IR & CSLL fica igual ao realizado.");
    }

    const realizado = calcular_subtotais(recorte);
    const ajustadas = aplicar_fatores(recorte, fatores);
    const contas_simuladas = ajustar_ir(ajustadas, realizado, aliquota);
    return {
        fatores,
        aliquota,
        contas_realizado: recorte,
        contas_simuladas,
        realizado,
        simulado: calcular_subtotais(contas_simuladas),
        avisos,
    };
}
