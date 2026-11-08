import { describe, expect, it } from "vitest";

import { definicoes_premissas, lista_premissas, premissa_da_conta, validar_mapa } from "./mapa_premissas";
import { plano } from "./fixtures_teste";
import {
    chave_erro,
    erro_valor_premissa,
    sem_erros,
    status_valido,
    validar_simulacao,
    type DadosSimulacao,
} from "./validacao_premissas";

const valida: DadosSimulacao = {
    nome: "Plano de contenção 2025",
    descricao: "",
    ano: 2025,
    mes_inicio: 1,
    mes_fim: 12,
    premissas: lista_premissas.map((d) => ({
        cod_premissa: d.cod_premissa,
        tipo_ajuste: "percentual",
        valor_ajuste: 0,
        justificativa: "",
    })),
};

function com_premissa(valor: number, justificativa = ""): DadosSimulacao {
    return {
        ...valida,
        premissas: valida.premissas.map((p) =>
            p.cod_premissa === "custos" ? { ...p, valor_ajuste: valor, justificativa } : p,
        ),
    };
}

describe("mapa_premissas", () => {
    it("bate com o plano de contas do modelo", () => {
        expect(() => validar_mapa(plano)).not.toThrow();
    });

    it("receita líquida cobre as 5 receitas e as 2 deduções; adm, 2 contas", () => {
        expect(definicoes_premissas.receita_liquida.contas).toHaveLength(7);
        expect(definicoes_premissas.custos.contas).toHaveLength(4);
        expect(definicoes_premissas.despesas_administrativas.contas).toEqual([
            "opx_pessoal_administrativo",
            "opx_gerais_administrativas",
        ]);
        expect(premissa_da_conta("opx_nao_recorrentes")).toBeUndefined();
        expect(premissa_da_conta("ded_impostos_vendas")).toBe("receita_liquida");
    });

    it("recusa conta de custo marcada como receita", () => {
        const errado = plano.map((c) => (c.cod_conta === "cst_hardware" ? { ...c, natureza: "receita" } : c));
        expect(() => validar_mapa(errado)).toThrow(/natureza/);
    });
});

describe("validar_simulacao", () => {
    it("rascunho aceita premissa sem justificativa", () => {
        expect(sem_erros(validar_simulacao(com_premissa(-3), { exigir_justificativa: false }))).toBe(true);
    });

    it("salvar exige justificativa em premissa diferente de zero", () => {
        const erros = validar_simulacao(com_premissa(-3), { exigir_justificativa: true });
        expect(erros[chave_erro("custos", "justificativa")]).toMatch(/Justifique/);
        expect(sem_erros(validar_simulacao(com_premissa(-3, "Renegociação de contratos"), { exigir_justificativa: true }))).toBe(true);
    });

    it("premissa zerada não precisa de justificativa", () => {
        expect(sem_erros(validar_simulacao(valida, { exigir_justificativa: true }))).toBe(true);
    });

    it("valida nome, período e ano do calendário", () => {
        expect(validar_simulacao({ ...valida, nome: "  " }, { exigir_justificativa: false }).nome).toBeDefined();
        expect(validar_simulacao({ ...valida, mes_inicio: 5, mes_fim: 3 }, { exigir_justificativa: false }).periodo).toBeDefined();
        expect(validar_simulacao({ ...valida, ano: 2030 }, { exigir_justificativa: false, anos_validos: [2024, 2025, 2026] }).periodo).toBeDefined();
    });

    it("exige as três premissas", () => {
        expect(validar_simulacao({ ...valida, premissas: valida.premissas.slice(1) }, { exigir_justificativa: false }).premissas).toBeDefined();
    });

    it("faixa do percentual e número finito", () => {
        expect(erro_valor_premissa({ tipo_ajuste: "percentual", valor_ajuste: -100 })).toBeNull();
        expect(erro_valor_premissa({ tipo_ajuste: "percentual", valor_ajuste: 120 })).not.toBeNull();
        expect(erro_valor_premissa({ tipo_ajuste: "absoluto", valor_ajuste: Number.NaN })).not.toBeNull();
    });

    it("status ao restaurar: salvo só com todas as justificativas", () => {
        expect(status_valido(com_premissa(-3))).toBe("rascunho");
        expect(status_valido(com_premissa(-3, "Corte de despesas"))).toBe("salvo");
    });
});
