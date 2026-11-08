// Mapa premissa → contas de dim_conta. Único lugar do app que liga uma premissa da
// simulação às contas do modelo; validado contra o plano de contas devolvido pelo modelo.

export const cods_premissa = ["receita_liquida", "custos", "despesas_administrativas"] as const;
export type CodPremissa = (typeof cods_premissa)[number];

export const tipos_ajuste = ["percentual", "absoluto"] as const;
export type TipoAjuste = (typeof tipos_ajuste)[number];

export interface DefinicaoPremissa {
    cod_premissa: CodPremissa;
    rotulo: string;
    descricao: string;
    /** Contas de dim_conta que recebem o fator da premissa. */
    contas: readonly string[];
    /**
     * Como medir o total da categoria (sempre positivo num negócio normal):
     * `liquido` = soma de valor_dre (receitas menos deduções, a receita líquida);
     * `gasto` = soma de −valor_dre (custos e despesas, com sinal positivo).
     */
    medida_total: "liquido" | "gasto";
}

export const definicoes_premissas: Record<CodPremissa, DefinicaoPremissa> = {
    receita_liquida: {
        cod_premissa: "receita_liquida",
        rotulo: "Receita líquida",
        descricao: "Receitas e deduções com o mesmo fator: as deduções acompanham a venda.",
        contas: [
            "rec_hardware",
            "rec_licencas_software",
            "rec_cloud_assinaturas",
            "rec_consultoria",
            "rec_suporte_manutencao",
            "ded_impostos_vendas",
            "ded_devolucoes_abatimentos",
        ],
        medida_total: "liquido",
    },
    custos: {
        cod_premissa: "custos",
        rotulo: "Custos (CPV/CSP)",
        descricao: "As quatro contas de custos dos produtos e serviços vendidos.",
        contas: ["cst_hardware", "cst_infraestrutura_cloud", "cst_equipe_servicos", "cst_royalties_terceiros"],
        medida_total: "gasto",
    },
    despesas_administrativas: {
        cod_premissa: "despesas_administrativas",
        rotulo: "Despesas administrativas",
        descricao: "Pessoal administrativo e gerais & administrativas (2 das 5 despesas operacionais).",
        contas: ["opx_pessoal_administrativo", "opx_gerais_administrativas"],
        medida_total: "gasto",
    },
};

export const lista_premissas: DefinicaoPremissa[] = cods_premissa.map((cod) => definicoes_premissas[cod]);

export interface ContaPlano {
    cod_conta: string;
    natureza: string;
}

/** Erro de configuração: o mapa cita conta que o modelo não tem (ou com natureza incoerente). */
export class ErroMapaPremissas extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroMapaPremissas";
    }
}

/**
 * Confere o mapa contra o plano de contas do modelo. Conta ausente derruba a simulação
 * com erro, nunca com valor inventado. As premissas de gasto só podem ter contas de despesa.
 */
export function validar_mapa(plano: ContaPlano[]): void {
    const por_conta = new Map(plano.map((c) => [c.cod_conta, c.natureza]));
    const ausentes: string[] = [];
    const incoerentes: string[] = [];
    for (const definicao of lista_premissas) {
        for (const conta of definicao.contas) {
            const natureza = por_conta.get(conta);
            if (natureza === undefined) ausentes.push(conta);
            else if (definicao.medida_total === "gasto" && natureza !== "despesa") incoerentes.push(conta);
        }
    }
    if (ausentes.length > 0) {
        throw new ErroMapaPremissas(`Contas do mapa de premissas ausentes no modelo: ${ausentes.join(", ")}`);
    }
    if (incoerentes.length > 0) {
        throw new ErroMapaPremissas(`Contas de custo ou despesa com natureza diferente de despesa: ${incoerentes.join(", ")}`);
    }
}

const premissa_por_conta = new Map<string, CodPremissa>(
    lista_premissas.flatMap((d) => d.contas.map((conta) => [conta, d.cod_premissa] as const)),
);

/** Premissa que afeta a conta, ou `undefined` (conta inalterada pela simulação). */
export function premissa_da_conta(cod_conta: string): CodPremissa | undefined {
    return premissa_por_conta.get(cod_conta);
}

export function e_cod_premissa(valor: unknown): valor is CodPremissa {
    return typeof valor === "string" && (cods_premissa as readonly string[]).includes(valor);
}

export function e_tipo_ajuste(valor: unknown): valor is TipoAjuste {
    return typeof valor === "string" && (tipos_ajuste as readonly string[]).includes(valor);
}
