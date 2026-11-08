import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import { describe, expect, it } from "vitest";

import { edicao_alterada, useEstadoSimulacao } from "@/estado/estado_simulacao";
import { BancoFalso } from "@/simulacao/cliente_dados_falso";
import { RepositorioSimulacoes } from "@/simulacao/repositorio_simulacoes";
import { PainelSimulacao } from "./painel_simulacao";

const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"].map((nome_mes, i) => ({
    mes: i + 1,
    nome_mes,
}));

function Painel({ banco }: { banco: BancoFalso }) {
    const repositorio = useMemo(
        () => new RepositorioSimulacoes(banco.cliente("sub-dono"), { id: "sub-dono", email: "dono@blacksmith.example" }),
        [banco],
    );
    const [estado, acoes] = useEstadoSimulacao(repositorio);
    return (
        <PainelSimulacao
            estado={estado}
            acoes={acoes}
            opcoes={{ anos: [2024, 2025, 2026], meses }}
            periodo_sugerido={{ ano: 2025, mes_inicio: 1, mes_fim: 12 }}
            resultado_periodo={null}
            carregando_base={false}
            erro_base={undefined}
            ao_fechar={() => undefined}
        />
    );
}

describe("PainelSimulacao", () => {
    it("cria, bloqueia salvar sem justificativa, salva com justificativa e mostra o histórico", async () => {
        const banco = new BancoFalso();
        render(<Painel banco={banco} />);

        // sem simulações: abre direto o formulário de nova
        fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Plano de contenção 2025" } });
        fireEvent.click(screen.getByRole("button", { name: /Criar simulação/ }));
        expect(await screen.findByText("Simulação criada em rascunho.")).toBeInTheDocument();

        const custos = screen.getByRole("group", { name: "Custos (CPV/CSP)" });
        fireEvent.change(within(custos).getByLabelText("Ajuste em %"), { target: { value: "-3" } });
        expect(screen.getByText("● alterações não salvas")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
        expect(await within(custos).findByText("Justifique a premissa para salvar.")).toBeInTheDocument();
        expect(banco.tabelas.premissa_simulacao.every((p) => p.valor_ajuste === 0)).toBe(true);

        fireEvent.change(within(custos).getByLabelText("Justificativa"), { target: { value: "Renegociação de contratos" } });
        fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
        expect(await screen.findByText("Simulação salva com as justificativas.")).toBeInTheDocument();
        expect(screen.getByText("Salvo")).toBeInTheDocument();
        expect(banco.tabelas.simulacao[0]).toMatchObject({ status: "salvo", versao: 2 });

        fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
        expect(await screen.findByText(/Custos \(CPV\/CSP\): sem ajuste → -3%/)).toBeInTheDocument();
    });

    it("lista as salvas e reabre uma simulação", async () => {
        const banco = new BancoFalso();
        const repo = new RepositorioSimulacoes(banco.cliente("sub-dono"), { id: "sub-dono", email: "" });
        await repo.criar({ nome: "Revisão de receita", descricao: "", ano: 2025, mes_inicio: 3, mes_fim: 4 });
        render(<Painel banco={banco} />);

        fireEvent.click(screen.getByRole("tab", { name: "Simulações salvas" }));
        expect(await screen.findByText("Revisão de receita")).toBeInTheDocument();
        expect(screen.getByText(/Mar a Abr\/2025/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Abrir/ }));
        await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveValue("Revisão de receita"));
    });
});

describe("edicao_alterada", () => {
    it("ignora espaços nas pontas e detecta mudança de premissa", async () => {
        const banco = new BancoFalso();
        const repo = new RepositorioSimulacoes(banco.cliente("u"), { id: "u", email: "" });
        const aberta = await repo.criar({ nome: "X", descricao: "", ano: 2025, mes_inicio: 1, mes_fim: 12 });
        const dados = {
            nome: "X ",
            descricao: "",
            ano: 2025,
            mes_inicio: 1,
            mes_fim: 12,
            premissas: aberta.premissas.map((p) => ({
                cod_premissa: p.cod_premissa,
                tipo_ajuste: p.tipo_ajuste,
                valor_ajuste: p.valor_ajuste,
                justificativa: p.justificativa,
            })),
        };
        expect(edicao_alterada(aberta, dados)).toBe(false);
        expect(edicao_alterada(aberta, { ...dados, premissas: dados.premissas.map((p, i) => (i === 1 ? { ...p, valor_ajuste: -3 } : p)) })).toBe(true);
    });
});
