import { describe, expect, it } from "vitest";

import { numero, texto } from "@/dados/cliente_modelo";
import { lista_recortes, plano, recortes } from "./fixtures_teste";
import { ErroMapaPremissas } from "./mapa_premissas";
import {
    aliquota_base,
    calcular_fatores,
    calcular_subtotais,
    simular,
    type ContaDre,
    type PremissaAjuste,
} from "./motor_simulacao";

const base_2025 = recortes.ano_2025.contas;

/** Contas fictícias do exemplo ilustrativo do prompt (só para teste, nunca entram no app). */
function conta(cod_conta: string, cod_grupo: string, natureza: "receita" | "despesa", valor: number): ContaDre {
    return { cod_conta, cod_grupo, natureza, valor_dre: natureza === "receita" ? valor : -valor };
}

const exemplo: ContaDre[] = [
    conta("rec_hardware", "receita_bruta", "receita", 1_000_000),
    conta("cst_hardware", "custos_cpv_csp", "despesa", 600_000),
    conta("opx_pessoal_administrativo", "despesas_operacionais", "despesa", 150_000),
    conta("opx_gerais_administrativas", "despesas_operacionais", "despesa", 100_000),
];

const subtotal_modelo = (linhas: typeof recortes.mar_2025.subtotais, cod_no: string) =>
    numero(linhas.find((l) => texto(l, "cod_no") === cod_no), "realizado") ?? 0;

describe("simular — invariante: sem premissas, simulado = realizado = modelo", () => {
    it.each(lista_recortes.map((r) => [r.nome, r] as const))("%s", (_, recorte) => {
        const resultado = simular(plano, base_2025, recorte.contas, []);
        const pares: [string, number][] = [
            ["receita_bruta", resultado.simulado.receita_bruta],
            ["receita_liquida", resultado.simulado.receita_liquida],
            ["lucro_bruto", resultado.simulado.lucro_bruto],
            ["ebitda", resultado.simulado.ebitda],
            ["ebit_lucro_operacional", resultado.simulado.ebit],
            ["lair", resultado.simulado.lair],
            ["lucro_liquido", resultado.simulado.lucro_liquido],
        ];
        for (const [cod_no, valor] of pares) {
            expect(valor, cod_no).toBeCloseTo(subtotal_modelo(recorte.subtotais, cod_no), 2);
        }
        expect(resultado.contas_simuladas).toEqual(recorte.contas);
        expect(resultado.simulado).toEqual(resultado.realizado);
    });

    it("bate com os números de referência de 2025 (seção 1 do CLAUDE.md)", () => {
        const { simulado } = simular(plano, base_2025, base_2025, []);
        expect(simulado.receita_liquida).toBeCloseTo(154_819_681.8, 0);
        expect(simulado.ebitda).toBeCloseTo(26_606_624.76, 0);
        expect(simulado.lucro_liquido).toBeCloseTo(13_088_163.15, 0);
    });
});

describe("exemplo ilustrativo (valores fictícios de teste)", () => {
    it("−8% em despesas administrativas: resultado de 150 mil vira 170 mil", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "despesas_administrativas", tipo_ajuste: "percentual", valor_ajuste: -8 }];
        const resultado = simular(plano, exemplo, exemplo, premissas);
        expect(resultado.realizado.ebitda).toBeCloseTo(150_000, 6);
        expect(resultado.simulado.ebitda).toBeCloseTo(170_000, 6);
        expect(resultado.simulado.ebitda - resultado.realizado.ebitda).toBeCloseTo(20_000, 6);
    });

    it("−R$ 20.000 absoluto em despesas administrativas dá o mesmo resultado", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "despesas_administrativas", tipo_ajuste: "absoluto", valor_ajuste: -20_000 }];
        const resultado = simular(plano, exemplo, exemplo, premissas);
        expect(resultado.fatores.por_premissa.despesas_administrativas).toBeCloseTo(-0.08, 12);
        expect(resultado.simulado.ebitda).toBeCloseTo(170_000, 6);
    });

    it("receita absoluta: a receita líquida varia exatamente o ajuste (deduções acompanham)", () => {
        const com_deducao = [...exemplo, conta("ded_impostos_vendas", "deducoes_da_receita", "despesa", 100_000)];
        const premissas: PremissaAjuste[] = [{ cod_premissa: "receita_liquida", tipo_ajuste: "absoluto", valor_ajuste: 90_000 }];
        const resultado = simular(plano, com_deducao, com_deducao, premissas);
        expect(resultado.simulado.receita_liquida - resultado.realizado.receita_liquida).toBeCloseTo(90_000, 6);
        expect(resultado.simulado.deducoes_receita).toBeCloseTo(-110_000, 6);
    });

    it("percentual em custos afeta só as contas cst_*", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3 }];
        const resultado = simular(plano, exemplo, exemplo, premissas);
        expect(resultado.simulado.custos).toBeCloseTo(-582_000, 6);
        expect(resultado.simulado.despesas_operacionais).toBeCloseTo(-250_000, 6);
    });
});

describe("IR & CSLL incremental", () => {
    const com_ir = [
        ...exemplo,
        conta("irp_ir_csll", "impostos_sobre_o_lucro", "despesa", 51_000), // 34% de 150 mil
    ];

    it("aplica a alíquota efetiva da base sobre a variação do LAIR", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "despesas_administrativas", tipo_ajuste: "percentual", valor_ajuste: -8 }];
        const resultado = simular(plano, com_ir, com_ir, premissas);
        expect(resultado.aliquota.valor).toBeCloseTo(0.34, 12);
        expect(resultado.simulado.ir_csll).toBeCloseTo(-(51_000 + 0.34 * 20_000), 6);
        expect(resultado.simulado.lucro_liquido).toBeCloseTo(170_000 - 57_800, 6);
    });

    it("nunca deixa o IR negativo", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "receita_liquida", tipo_ajuste: "percentual", valor_ajuste: -50 }];
        const resultado = simular(plano, com_ir, com_ir, premissas);
        expect(Math.abs(resultado.simulado.ir_csll)).toBe(0);
    });

    it("LAIR da base ≤ 0: alíquota inválida, IR fixo e aviso", () => {
        const mar = recortes.mar_2025.contas;
        expect(aliquota_base(calcular_subtotais(mar))).toEqual({ valor: 0, ir_fixo: true });
        const premissas: PremissaAjuste[] = [{ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3 }];
        const resultado = simular(plano, mar, mar, premissas);
        expect(resultado.simulado.ir_csll).toBe(resultado.realizado.ir_csll);
        expect(resultado.avisos.join(" ")).toMatch(/alíquota/);
    });

    it("alíquota fora de [0, 1] também fixa o IR", () => {
        const absurda = [...exemplo, conta("irp_ir_csll", "impostos_sobre_o_lucro", "despesa", 200_000)];
        expect(aliquota_base(calcular_subtotais(absurda)).ir_fixo).toBe(true);
    });
});

describe("valores negativos: mar e abr/2025 têm prejuízo no realizado", () => {
    const premissas: PremissaAjuste[] = [
        { cod_premissa: "despesas_administrativas", tipo_ajuste: "percentual", valor_ajuste: -8 },
        { cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -3 },
    ];

    it.each([recortes.mar_2025, recortes.abr_2025])("$nome: o plano de contenção encolhe o prejuízo", (recorte) => {
        const resultado = simular(plano, base_2025, recorte.contas, premissas);
        expect(resultado.realizado.lucro_liquido).toBeLessThan(0);
        expect(resultado.simulado.lucro_liquido).toBeGreaterThan(resultado.realizado.lucro_liquido);
        expect(resultado.simulado.prejuizo_liquido).toBeLessThan(resultado.realizado.prejuizo_liquido);
    });

    it("a soma dos recortes é o total: o fator é uniforme no período", () => {
        const fatores = calcular_fatores(base_2025, premissas);
        const mar = simular(plano, base_2025, recortes.mar_2025.contas, premissas);
        const custos_mar = recortes.mar_2025.contas.filter((c) => c.cod_grupo === "custos_cpv_csp");
        const soma = custos_mar.reduce((s, c) => s + c.valor_dre, 0) * (1 + fatores.por_premissa.custos);
        expect(mar.simulado.custos).toBeCloseTo(soma, 6);
    });
});

describe("casos de borda", () => {
    it("conta do mapa ausente no modelo derruba a simulação", () => {
        const sem_conta = plano.filter((c) => c.cod_conta !== "opx_gerais_administrativas");
        expect(() => simular(sem_conta, base_2025, base_2025, [])).toThrow(ErroMapaPremissas);
    });

    it("categoria sem movimento com ajuste absoluto é premissa inválida, sem divisão por zero", () => {
        const sem_custos = exemplo.filter((c) => c.cod_grupo !== "custos_cpv_csp");
        const premissas: PremissaAjuste[] = [{ cod_premissa: "custos", tipo_ajuste: "absoluto", valor_ajuste: -1_000 }];
        const resultado = simular(plano, sem_custos, sem_custos, premissas);
        expect(resultado.fatores.invalidas.custos).toMatch(/sem movimento|não tem movimento/);
        expect(resultado.fatores.por_premissa.custos).toBe(0);
        expect(resultado.simulado).toEqual(resultado.realizado);
    });

    it("ajuste absoluto maior que a categoria é inválido", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "despesas_administrativas", tipo_ajuste: "absoluto", valor_ajuste: -300_000 }];
        expect(calcular_fatores(exemplo, premissas).invalidas.despesas_administrativas).toBeDefined();
    });

    it("percentual fora da faixa é inválido", () => {
        const premissas: PremissaAjuste[] = [{ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: -150 }];
        expect(calcular_fatores(exemplo, premissas).invalidas.custos).toBeDefined();
    });

    it("período sem dados: avisa e devolve tudo zerado, com margens nulas", () => {
        const resultado = simular(plano, [], [], [{ cod_premissa: "custos", tipo_ajuste: "percentual", valor_ajuste: 10 }]);
        expect(resultado.avisos.join(" ")).toMatch(/não tem lançamentos/);
        expect(resultado.simulado.lucro_liquido).toBe(0);
        expect(resultado.simulado.margem_liquida).toBeNull();
    });

    it("conta fora do plano de contas é erro", () => {
        expect(() => simular(plano, [conta("xyz", "receita_bruta", "receita", 1)], [], [])).toThrow(/fora do plano/);
    });
});
