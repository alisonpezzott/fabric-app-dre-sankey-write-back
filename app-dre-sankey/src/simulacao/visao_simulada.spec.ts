import { describe, expect, it } from "vitest";

import { numero, texto } from "@/dados/cliente_modelo";
import { definicoes_links, plano, recortes } from "./fixtures_teste";
import { simular, type PremissaAjuste } from "./motor_simulacao";
import { comparar, kpis_simulados, montar_linhas_dre_simulada, sankey_simulado } from "./visao_simulada";

const base = recortes.ano_2025.contas;
const contencao: PremissaAjuste[] = [
    { cod_premissa: "despesas_administrativas", tipo_ajuste: "percentual", valor_ajuste: -8 },
    { cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3 },
];

describe("comparar", () => {
    it("Δ e Δ% sobre |realizado|; realizado zero não divide", () => {
        expect(comparar(-100, -50)).toEqual({ realizado: -100, simulado: -50, delta: 50, delta_pct: 0.5 });
        expect(comparar(0, 10).delta_pct).toBeNull();
        expect(comparar(null, 10).delta).toBeNull();
    });
});

describe("kpis_simulados", () => {
    it("sem premissas, Δ zero em todos os KPIs", () => {
        const kpis = kpis_simulados(simular(plano, base, recortes.mar_2025.contas, []));
        for (const c of Object.values(kpis)) expect(c.delta).toBe(0);
    });

    it("mar/2025 com o plano de contenção: lucro sobe, receita não muda", () => {
        const kpis = kpis_simulados(simular(plano, base, recortes.mar_2025.contas, contencao));
        expect(kpis.receita_liquida.delta).toBe(0);
        expect(kpis.lucro_liquido.delta!).toBeGreaterThan(0);
        expect(kpis.ebitda.simulado!).toBeGreaterThan(kpis.ebitda.realizado!);
        expect(kpis.margem_liquida.delta_pct).toBe(kpis.margem_liquida.delta);
    });
});

describe("montar_linhas_dre_simulada", () => {
    const r = recortes.mar_2025;

    it("19 contas + 7 subtotais, com as colunas Realizado | Simulado | Δ | Δ%", () => {
        const tabela = montar_linhas_dre_simulada(r.linhas_dre, r.subtotais, simular(plano, base, r.contas, contencao));
        expect(tabela.rows).toHaveLength(26);
        expect(tabela.columns.map((c) => c.name)).toEqual(["tipo_linha", "nome", "realizado", "simulado", "delta", "delta_pct"]);
        const alteradas = tabela.rows.filter((l) => l[0] === "conta_alterada").map((l) => l[1]);
        // custos (4), adm (2); IR fixo porque o LAIR de 2025 é positivo → IR também muda
        expect(alteradas).toEqual(expect.arrayContaining(["Pessoal Administrativo", "Gerais & Administrativas", "Custo de Hardware"]));
        expect(alteradas).not.toContain("Hardware");
    });

    it("sem premissas, o realizado da tabela é o do modelo", () => {
        const tabela = montar_linhas_dre_simulada(r.linhas_dre, r.subtotais, simular(plano, base, r.contas, []));
        const lucro = tabela.rows.find((l) => l[1] === "Lucro Líquido")!;
        const modelo = numero(r.subtotais.find((l) => texto(l, "cod_no") === "lucro_liquido"), "realizado");
        expect(lucro[2]).toBeCloseTo(modelo!, 2);
        expect(lucro[3]).toBeCloseTo(modelo!, 2);
        expect(tabela.rows.every((l) => l[0] !== "conta_alterada")).toBe(true);
    });
});

describe("sankey_simulado", () => {
    it("guarda o realizado de cada nó, inclusive do prejuízo que encolhe", () => {
        const resultado = simular(plano, base, recortes.mar_2025.contas, contencao);
        const { links, nos_realizado } = sankey_simulado(definicoes_links, resultado);
        expect(nos_realizado.get("prejuizo_liquido")).toBeCloseTo(resultado.realizado.prejuizo_liquido, 2);
        const despesas = links.find((l) => l.cod_no_origem === "prejuizo_liquido" && l.cod_no_destino === "despesas_operacionais");
        expect(despesas!.valor).toBeLessThan(despesas!.valor_realizado!);
    });
});
