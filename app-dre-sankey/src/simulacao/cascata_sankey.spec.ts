import { describe, expect, it } from "vitest";

import { calcular_links, limiar_link, links_comparados, valores_nos, type LinkCalculado } from "./cascata_sankey";
import { definicoes_links, lista_recortes, plano, recortes } from "./fixtures_teste";
import { simular, type PremissaAjuste } from "./motor_simulacao";

const base_2025 = recortes.ano_2025.contas;
const id = (l: { cod_no_origem: string; cod_no_destino: string }) => `${l.cod_no_origem}__${l.cod_no_destino}`;

/** Entrada = saída em todo nó com entrada e saída. */
function desequilibrio_max(links: LinkCalculado[]): number {
    const entradas = new Map<string, number>();
    const saidas = new Map<string, number>();
    for (const l of links) {
        entradas.set(l.cod_no_destino, (entradas.get(l.cod_no_destino) ?? 0) + l.valor);
        saidas.set(l.cod_no_origem, (saidas.get(l.cod_no_origem) ?? 0) + l.valor);
    }
    let maximo = 0;
    for (const [no, entrada] of entradas) {
        const saida = saidas.get(no);
        if (saida !== undefined) maximo = Math.max(maximo, Math.abs(entrada - saida));
    }
    return maximo;
}

describe("calcular_links — invariante contra sankey_valor", () => {
    it("tem os 33 links de dim_link_sankey", () => {
        expect(definicoes_links).toHaveLength(33);
    });

    it.each(lista_recortes.map((r) => [r.nome, r] as const))("%s: mesmos links e valores do modelo", (_, recorte) => {
        const links = calcular_links(definicoes_links, recorte.contas);
        expect(new Set(links.map(id))).toEqual(new Set(recorte.links.keys()));
        for (const link of links) {
            expect(link.valor, id(link)).toBeCloseTo(recorte.links.get(id(link)) ?? NaN, 2);
        }
    });

    it.each(lista_recortes.map((r) => [r.nome, r] as const))("%s: sem premissas, o Sankey simulado é o do modelo", (_, recorte) => {
        const resultado = simular(plano, base_2025, recorte.contas, []);
        const links = links_comparados(definicoes_links, resultado.contas_realizado, resultado.contas_simuladas);
        expect(links).toHaveLength(recorte.links.size);
        for (const link of links) {
            expect(link.valor).toBeCloseTo(recorte.links.get(id(link)) ?? NaN, 2);
            expect(link.valor_realizado).toBe(link.valor);
        }
    });

    it("mar/2025 reproduz os cenários de teste do CLAUDE.md", () => {
        const links = new Map(calcular_links(definicoes_links, recortes.mar_2025.contas).map((l) => [id(l), l.valor]));
        expect(links.get("prejuizo_liquido__despesas_operacionais")).toBeCloseTo(2_071_798.75, 1);
        expect(links.get("prejuizo_liquido__depreciacao_amortizacao")).toBeCloseTo(388_600.04, 1);
        expect(links.get("prejuizo_liquido__resultado_financeiro_liquido")).toBeCloseTo(134_368.48, 1);
        expect(links.has("lucro_bruto__ebitda")).toBe(false);
        expect(links.has("lair__lucro_liquido")).toBe(false);
    });

    it("2025 inteiro: lucro líquido de 13,09 mi, sem prejuízo", () => {
        const links = calcular_links(definicoes_links, base_2025);
        expect(links.find((l) => l.cod_link === "lair__lucro_liquido")?.valor).toBeCloseTo(13_088_163.15, 1);
        expect(links.some((l) => l.cod_no_origem === "prejuizo_liquido")).toBe(false);
    });
});

describe("fechamento do Sankey simulado", () => {
    const cenarios: [string, PremissaAjuste[]][] = [
        ["plano de contenção", [
            { cod_premissa: "despesas_administrativas", tipo_ajuste: "percentual", valor_ajuste: -8 },
            { cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3 },
        ]],
        ["queda forte de receita", [{ cod_premissa: "receita_liquida", tipo_ajuste: "percentual", valor_ajuste: -40 }]],
        ["alta de receita absoluta", [{ cod_premissa: "receita_liquida", tipo_ajuste: "absoluto", valor_ajuste: 5_000_000 }]],
    ];

    for (const recorte of lista_recortes) {
        it.each(cenarios)(`${recorte.nome}: entrada = saída em todo nó (%s)`, (_, premissas) => {
            const resultado = simular(plano, base_2025, recorte.contas, premissas);
            const links = calcular_links(definicoes_links, resultado.contas_simuladas);
            expect(desequilibrio_max(links)).toBeLessThan(0.05);
            expect(links.every((l) => l.valor > limiar_link)).toBe(true);
        });
    }

    it("o prejuízo de mar/2025 encolhe com o plano de contenção", () => {
        const resultado = simular(plano, base_2025, recortes.mar_2025.contas, cenarios[0][1]);
        const realizado = valores_nos(calcular_links(definicoes_links, resultado.contas_realizado));
        const simulado = valores_nos(calcular_links(definicoes_links, resultado.contas_simuladas));
        expect(simulado.get("prejuizo_liquido")!).toBeLessThan(realizado.get("prejuizo_liquido")!);
        expect(simulado.get("prejuizo_liquido")).toBeCloseTo(resultado.simulado.prejuizo_liquido, 2);
    });

    it("período sem dados: nenhum link", () => {
        expect(calcular_links(definicoes_links, [])).toEqual([]);
    });

    it("link de subtotal sem regra na cascata é erro, nunca valor inventado", () => {
        const estranha = [...definicoes_links, { ...definicoes_links[6], cod_link: "x__y", cod_conta: "" }];
        expect(() => calcular_links(estranha, base_2025)).toThrow(/sem regra/);
    });
});
