import { beforeEach, describe, expect, it } from "vitest";

import { BancoFalso } from "./cliente_dados_falso";
import {
    chave_premissa,
    dados_da_simulacao,
    ErroConflitoVersao,
    ErroRepositorio,
    ErroValidacaoSimulacao,
    json_auditoria,
    limite_json_auditoria,
    mensagem_para_usuario,
    RepositorioSimulacoes,
    type SimulacaoCompleta,
} from "./repositorio_simulacoes";
import type { DadosSimulacao } from "./validacao_premissas";

const dono = { id: "sub-dono", email: "dono@blacksmith.example" };
const outro = { id: "sub-outro", email: "outro@blacksmith.example" };
const periodo = { nome: "Plano de contenção 2025", descricao: "Demo", ano: 2025, mes_inicio: 1, mes_fim: 12 };

let banco: BancoFalso;
let repo: RepositorioSimulacoes;
let relogio: number;

beforeEach(() => {
    banco = new BancoFalso();
    relogio = Date.parse("2026-11-08T12:00:00Z");
    const agora = () => new Date((relogio += 1000));
    repo = new RepositorioSimulacoes(banco.cliente(dono.id), dono, agora);
});

function com_premissas(completa: SimulacaoCompleta, ajustes: Partial<Record<string, [number, string]>>): DadosSimulacao {
    const dados = dados_da_simulacao(completa);
    return {
        ...dados,
        premissas: dados.premissas.map((p) => {
            const ajuste = ajustes[p.cod_premissa];
            return ajuste ? { ...p, valor_ajuste: ajuste[0], justificativa: ajuste[1] } : p;
        }),
    };
}

describe("criação, persistência e recuperação", () => {
    it("cria em rascunho, com as três premissas zeradas, e relê o registro completo", async () => {
        const criada = await repo.criar(periodo);
        expect(criada.simulacao).toMatchObject({ ...periodo, status: "rascunho", versao: 1, usuario_id: dono.id });
        expect(criada.simulacao.criado_em).not.toBe("");
        expect(criada.premissas.map((p) => [p.cod_premissa, p.valor_ajuste])).toEqual([
            ["receita_liquida", 0],
            ["custos", 0],
            ["despesas_administrativas", 0],
        ]);
        expect(criada.premissas[0].chave_premissa).toBe(chave_premissa(criada.simulacao.id, "receita_liquida"));
        expect(criada.premissas.every((p) => p.usuario_id === dono.id && p.simulacao_id === criada.simulacao.id)).toBe(true);
    });

    it("lista e reabre o que foi salvo", async () => {
        const criada = await repo.criar(periodo);
        const dados = com_premissas(criada, { custos: [-3, "Renegociação de contratos"] });
        await repo.salvar(criada.simulacao.id, 1, dados, "salvo");
        const lista = await repo.listar();
        expect(lista).toHaveLength(1);
        const reaberta = await repo.abrir(lista[0].id);
        expect(reaberta.simulacao.status).toBe("salvo");
        expect(reaberta.simulacao.versao).toBe(2);
        expect(reaberta.premissas[1]).toMatchObject({ valor_ajuste: -3, justificativa: "Renegociação de contratos" });
    });

    it("recusa nome vazio na criação", async () => {
        await expect(repo.criar({ ...periodo, nome: " " })).rejects.toBeInstanceOf(ErroValidacaoSimulacao);
        expect(banco.escritas).toHaveLength(0);
    });
});

describe("salvar e justificativas", () => {
    it("salvo exige justificativa; rascunho não", async () => {
        const criada = await repo.criar(periodo);
        const sem_justificativa = com_premissas(criada, { despesas_administrativas: [-8, ""] });
        await expect(repo.salvar(criada.simulacao.id, 1, sem_justificativa, "salvo")).rejects.toBeInstanceOf(
            ErroValidacaoSimulacao,
        );
        const rascunho = await repo.salvar(criada.simulacao.id, 1, sem_justificativa, "rascunho");
        expect(rascunho.simulacao.status).toBe("rascunho");
        expect(rascunho.premissas[2].valor_ajuste).toBe(-8);
    });

    it("audita criar, alterar_premissa (só as que mudaram) e salvar, com valor anterior e novo", async () => {
        const criada = await repo.criar(periodo);
        const dados = com_premissas(criada, { custos: [-3, "Renegociação"], despesas_administrativas: [-8, "Corte"] });
        await repo.salvar(criada.simulacao.id, 1, dados, "salvo");
        const historico = await repo.historico(criada.simulacao.id);
        expect(historico.map((h) => h.acao).sort()).toEqual(["alterar_premissa", "alterar_premissa", "criar", "salvar"]);
        const custos = historico.find((h) => h.acao === "alterar_premissa" && h.valor_novo?.includes("custos"))!;
        expect(JSON.parse(custos.valor_anterior!)).toMatchObject({ valor_ajuste: 0 });
        expect(JSON.parse(custos.valor_novo!)).toMatchObject({ valor_ajuste: -3, justificativa: "Renegociação" });
        expect(custos.premissa_id).toBe(criada.premissas[1].id);
        expect(historico.every((h) => h.usuario_id === dono.id)).toBe(true);
    });
});

describe("concorrência otimista", () => {
    it("rejeita salvar com versão desatualizada, sem sobrescrever", async () => {
        const criada = await repo.criar(periodo);
        await repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { custos: [-3, "Aba A"] }), "salvo");
        const escritas = banco.escritas.length;
        await expect(
            repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { custos: [-10, "Aba B"] }), "salvo"),
        ).rejects.toBeInstanceOf(ErroConflitoVersao);
        expect(banco.escritas).toHaveLength(escritas);
        expect((await repo.abrir(criada.simulacao.id)).premissas[1].justificativa).toBe("Aba A");
    });

    it("arquivar e restaurar também conferem a versão", async () => {
        const criada = await repo.criar(periodo);
        await repo.arquivar(criada.simulacao.id, 1);
        await expect(repo.restaurar(criada.simulacao.id, 1)).rejects.toBeInstanceOf(ErroConflitoVersao);
    });

    it("a mensagem de conflito é a que a UI mostra", () => {
        expect(mensagem_para_usuario(new ErroConflitoVersao())).toMatch(/alterada em outra aba/);
    });
});

describe("duplicar, arquivar e restaurar (sem exclusão)", () => {
    it("duplica com as mesmas premissas, em rascunho, e audita a origem", async () => {
        const criada = await repo.criar(periodo);
        await repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { receita_liquida: [5, "Revisão da previsão"] }), "salvo");
        const copia = await repo.duplicar(criada.simulacao.id);
        expect(copia.simulacao.id).not.toBe(criada.simulacao.id);
        expect(copia.simulacao).toMatchObject({ nome: "Cópia de Plano de contenção 2025", status: "rascunho", versao: 1 });
        expect(copia.premissas[0]).toMatchObject({ valor_ajuste: 5, justificativa: "Revisão da previsão" });
        const historico = await repo.historico(copia.simulacao.id);
        expect(historico.map((h) => h.acao)).toEqual(["duplicar"]);
        expect(JSON.parse(historico[0].valor_anterior!)).toMatchObject({ origem_id: criada.simulacao.id });
        expect(await repo.listar()).toHaveLength(2);
    });

    it("arquivada é só leitura; restaurar volta a salvo quando as justificativas existem", async () => {
        const criada = await repo.criar(periodo);
        const salva = await repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { custos: [-3, "Ok"] }), "salvo");
        const arquivada = await repo.arquivar(criada.simulacao.id, salva.simulacao.versao);
        expect(arquivada.simulacao.status).toBe("arquivado");
        await expect(
            repo.salvar(criada.simulacao.id, arquivada.simulacao.versao, dados_da_simulacao(arquivada), "rascunho"),
        ).rejects.toBeInstanceOf(ErroRepositorio);
        const restaurada = await repo.restaurar(criada.simulacao.id, arquivada.simulacao.versao);
        expect(restaurada.simulacao.status).toBe("salvo");
        const acoes = (await repo.historico(criada.simulacao.id)).map((h) => h.acao);
        expect(acoes).toEqual(expect.arrayContaining(["arquivar", "restaurar"]));
    });

    it("restaurar um rascunho sem justificativa volta a rascunho", async () => {
        const criada = await repo.criar(periodo);
        const r = await repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { custos: [-3, ""] }), "rascunho");
        const a = await repo.arquivar(criada.simulacao.id, r.simulacao.versao);
        expect((await repo.restaurar(criada.simulacao.id, a.simulacao.versao)).simulacao.status).toBe("rascunho");
    });
});

describe("segurança e integridade (regras imitadas pelo banco falso)", () => {
    it("só escreve nas três entidades do app, nunca no modelo semântico", async () => {
        const criada = await repo.criar(periodo);
        const salva = await repo.salvar(criada.simulacao.id, 1, com_premissas(criada, { custos: [-3, "x"] }), "salvo");
        await repo.duplicar(criada.simulacao.id);
        await repo.arquivar(criada.simulacao.id, salva.simulacao.versao);
        const entidades = new Set(banco.escritas.map((e) => e.entidade));
        expect([...entidades].sort()).toEqual(["auditoria_simulacao", "premissa_simulacao", "simulacao"]);
        expect(banco.escritas.filter((e) => e.entidade === "auditoria_simulacao").every((e) => e.operacao === "create")).toBe(true);
    });

    it("outro usuário não lê nem altera a simulação do dono", async () => {
        const criada = await repo.criar(periodo);
        const repo_outro = new RepositorioSimulacoes(banco.cliente(outro.id), outro);
        expect(await repo_outro.listar()).toEqual([]);
        await expect(repo_outro.abrir(criada.simulacao.id)).rejects.toBeInstanceOf(ErroRepositorio);
        await expect(
            repo_outro.salvar(criada.simulacao.id, 1, dados_da_simulacao(criada), "rascunho"),
        ).rejects.toBeInstanceOf(ErroRepositorio);
        expect(await repo_outro.historico(criada.simulacao.id)).toEqual([]);
    });

    it("chave_premissa única: não existe segunda premissa igual na mesma simulação", async () => {
        const criada = await repo.criar(periodo);
        const premissas = banco.cliente(dono.id).premissa_simulacao;
        await expect(
            premissas.create({
                simulacao: { id: criada.simulacao.id },
                cod_premissa: "custos",
                chave_premissa: chave_premissa(criada.simulacao.id, "custos"),
                tipo_ajuste: "percentual",
                valor_ajuste: 1,
                usuario_id: dono.id,
            }),
        ).rejects.toThrow(/unique/);
    });

    it("erros internos não chegam à UI", async () => {
        const quebrado = new RepositorioSimulacoes(
            { ...banco.cliente(dono.id), simulacao: { ...banco.cliente(dono.id).simulacao, select: () => { throw new Error("SQL 4060 login failed"); } } },
            dono,
        );
        const erro = await quebrado.listar().catch((e: unknown) => e);
        expect(mensagem_para_usuario(erro)).toBe("Não foi possível listar as simulações.");
        expect(mensagem_para_usuario(new Error("stack interno"))).not.toMatch(/stack/);
    });
});

describe("json_auditoria", () => {
    it("cabe na coluna sem cortar o JSON", () => {
        const json = json_auditoria({ descricao: "x".repeat(5000), nome: "a" });
        expect(json.length).toBeLessThanOrEqual(limite_json_auditoria);
        expect(() => JSON.parse(json)).not.toThrow();
    });
});
