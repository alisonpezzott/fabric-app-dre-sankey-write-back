// Regras de negócio da simulação, validadas no cliente antes de gravar. O banco valida
// tipos, @set, min/max, unique e chaves; aqui ficam justificativa, período e faixa de valores.

import { cods_premissa, e_tipo_ajuste, type CodPremissa, type TipoAjuste } from "./mapa_premissas";

/** Ajuste percentual permitido (em %): de −100% (zera a categoria) a +100% (dobra). */
export const limite_percentual = 100;
/** Fator equivalente máximo (|ajuste| / total da categoria): nenhuma categoria troca de sinal. */
export const limite_fator = 1;
/** Maior valor absoluto aceito (R$), só para barrar digitação errada antes da regra do fator. */
export const limite_absoluto = 1e12;

export const tamanhos = {
    nome: 120,
    descricao: 1000,
    justificativa: 500,
} as const;

export interface PremissaEditavel {
    cod_premissa: CodPremissa;
    tipo_ajuste: TipoAjuste;
    valor_ajuste: number;
    justificativa: string;
}

export interface DadosSimulacao {
    nome: string;
    descricao: string;
    ano: number;
    mes_inicio: number;
    mes_fim: number;
    premissas: PremissaEditavel[];
}

/** Erros por campo: "nome", "periodo", "premissa.custos.valor", "premissa.custos.justificativa"… */
export type ErrosValidacao = Record<string, string>;

export function chave_erro(cod: CodPremissa, campo: "valor" | "justificativa"): string {
    return `premissa.${cod}.${campo}`;
}

/** Valida o valor de uma premissa isolada (faixa do percentual, número finito). */
export function erro_valor_premissa(premissa: Pick<PremissaEditavel, "tipo_ajuste" | "valor_ajuste">): string | null {
    if (!e_tipo_ajuste(premissa.tipo_ajuste)) return "Tipo de ajuste inválido.";
    if (typeof premissa.valor_ajuste !== "number" || !Number.isFinite(premissa.valor_ajuste)) {
        return "Informe um número.";
    }
    if (premissa.tipo_ajuste === "percentual" && Math.abs(premissa.valor_ajuste) > limite_percentual) {
        return `O ajuste percentual vai de −${limite_percentual}% a +${limite_percentual}%.`;
    }
    if (premissa.tipo_ajuste === "absoluto" && Math.abs(premissa.valor_ajuste) > limite_absoluto) {
        return "Valor fora da faixa aceita.";
    }
    return null;
}

/**
 * Valida a simulação inteira. `exigir_justificativa` = salvar como `salvo`: toda premissa
 * diferente de zero precisa de justificativa. Rascunho aceita justificativa em branco.
 */
export function validar_simulacao(
    dados: DadosSimulacao,
    opcoes: { exigir_justificativa: boolean; anos_validos?: number[] },
): ErrosValidacao {
    const erros: ErrosValidacao = {};
    const nome = dados.nome.trim();
    if (nome.length === 0) erros.nome = "Dê um nome à simulação.";
    else if (nome.length > tamanhos.nome) erros.nome = `Use até ${tamanhos.nome} caracteres.`;
    if (dados.descricao.length > tamanhos.descricao) erros.descricao = `Use até ${tamanhos.descricao} caracteres.`;

    const mes_ok = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;
    if (!Number.isInteger(dados.ano) || (opcoes.anos_validos && !opcoes.anos_validos.includes(dados.ano))) {
        erros.periodo = "Ano fora do calendário do modelo.";
    } else if (!mes_ok(dados.mes_inicio) || !mes_ok(dados.mes_fim) || dados.mes_inicio > dados.mes_fim) {
        erros.periodo = "Intervalo de meses inválido.";
    }

    const codigos = dados.premissas.map((p) => p.cod_premissa);
    if (codigos.length !== cods_premissa.length || cods_premissa.some((cod) => !codigos.includes(cod))) {
        erros.premissas = "A simulação precisa das três premissas.";
    }

    for (const premissa of dados.premissas) {
        const erro_valor = erro_valor_premissa(premissa);
        if (erro_valor) erros[chave_erro(premissa.cod_premissa, "valor")] = erro_valor;
        const justificativa = premissa.justificativa.trim();
        if (justificativa.length > tamanhos.justificativa) {
            erros[chave_erro(premissa.cod_premissa, "justificativa")] = `Use até ${tamanhos.justificativa} caracteres.`;
        } else if (opcoes.exigir_justificativa && premissa.valor_ajuste !== 0 && justificativa.length === 0) {
            erros[chave_erro(premissa.cod_premissa, "justificativa")] = "Justifique a premissa para salvar.";
        }
    }
    return erros;
}

export function sem_erros(erros: ErrosValidacao): boolean {
    return Object.keys(erros).length === 0;
}

/** Status a gravar ao restaurar: salvo se todas as justificativas exigidas existem. */
export function status_valido(dados: DadosSimulacao): "salvo" | "rascunho" {
    return sem_erros(validar_simulacao(dados, { exigir_justificativa: true })) ? "salvo" : "rascunho";
}
