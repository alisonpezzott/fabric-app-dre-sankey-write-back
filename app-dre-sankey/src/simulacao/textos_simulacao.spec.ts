import { describe, expect, it } from "vitest";

import type { RegistroAuditoria } from "./repositorio_simulacoes";
import { detalhe_auditoria, ler_numero, periodo_simulacao, texto_numero } from "./textos_simulacao";

describe("ler_numero", () => {
    it.each([
        ["", 0],
        ["-", 0],
        ["−8", -8],
        ["-8,5", -8.5],
        ["3", 3],
        ["0.5", 0.5],
        ["20.000", 20_000],
        ["-1.234.567,89", -1_234_567.89],
        ["R$ -20.000", -20_000],
        ["8%", 8],
    ])("%s → %s", (texto, esperado) => {
        expect(ler_numero(texto)).toBe(esperado);
    });

    it("texto inválido vira NaN para a validação avisar", () => {
        expect(ler_numero("abc")).toBeNaN();
        expect(ler_numero("1,2,3")).toBeNaN();
    });

    it("texto_numero usa vírgula e deixa o zero vazio", () => {
        expect(texto_numero(-8.5)).toBe("-8,5");
        expect(texto_numero(0)).toBe("");
    });
});

describe("periodo_simulacao", () => {
    const nome = (m: number) => ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][m - 1];
    it("ano inteiro, um mês e intervalo", () => {
        expect(periodo_simulacao({ ano: 2025, mes_inicio: 1, mes_fim: 12 }, nome)).toBe("2025");
        expect(periodo_simulacao({ ano: 2025, mes_inicio: 3, mes_fim: 3 }, nome)).toBe("Mar/2025");
        expect(periodo_simulacao({ ano: 2025, mes_inicio: 1, mes_fim: 6 }, nome)).toBe("Jan a Jun/2025");
    });
});

describe("detalhe_auditoria", () => {
    const base: RegistroAuditoria = {
        id: "a",
        simulacao_id: "s",
        premissa_id: "p",
        acao: "alterar_premissa",
        valor_anterior: JSON.stringify({ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: 0, justificativa: "" }),
        valor_novo: JSON.stringify({ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3, justificativa: "Renegociação" }),
        usuario_id: "u",
        email_usuario: "",
        alterado_em: "2026-11-08T12:00:00Z",
    };

    it("descreve a alteração de premissa com a justificativa", () => {
        expect(detalhe_auditoria(base)).toBe("Custos (CPV/CSP): sem ajuste → -3% · “Renegociação”");
    });

    it("descreve status e versão ao salvar e tolera JSON inválido", () => {
        expect(
            detalhe_auditoria({
                ...base,
                acao: "salvar",
                valor_anterior: JSON.stringify({ status: "rascunho", versao: 1 }),
                valor_novo: JSON.stringify({ status: "salvo", versao: 2 }),
            }),
        ).toBe("status rascunho → salvo · versão 1 → 2");
        expect(detalhe_auditoria({ ...base, acao: "salvar", valor_anterior: "{quebrado", valor_novo: null })).toBeNull();
    });
});
