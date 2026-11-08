// Estado da simulação: lista do usuário, simulação aberta (versão gravada), edição não
// salva (alimenta o impacto ao vivo), modo Realizado/Simulado, histórico, operação em
// andamento e avisos (salvo, erro, conflito de versão). As gravações passam pelo repositório.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CodPremissa } from "@/simulacao/mapa_premissas";
import {
    dados_da_simulacao,
    ErroConflitoVersao,
    ErroValidacaoSimulacao,
    mensagem_para_usuario,
    type RegistroAuditoria,
    type RepositorioSimulacoes,
    type Simulacao,
    type SimulacaoCompleta,
} from "@/simulacao/repositorio_simulacoes";
import type { DadosSimulacao, ErrosValidacao, PremissaEditavel } from "@/simulacao/validacao_premissas";

export type ModoVisao = "realizado" | "simulado";
export type Operacao = "listando" | "abrindo" | "criando" | "salvando" | "duplicando" | "arquivando" | "restaurando";

export interface AvisoSimulacao {
    tipo: "sucesso" | "erro" | "conflito";
    texto: string;
}

export interface EstadoSimulacao {
    disponivel: boolean;
    lista: Simulacao[] | undefined;
    erro_lista: string | null;
    aberta: SimulacaoCompleta | null;
    /** Edição em andamento (igual à aberta logo depois de abrir ou salvar). */
    edicao: DadosSimulacao | null;
    nao_salvo: boolean;
    somente_leitura: boolean;
    historico: RegistroAuditoria[] | undefined;
    erro_historico: string | null;
    modo: ModoVisao;
    operacao: Operacao | null;
    aviso: AvisoSimulacao | null;
    erros: ErrosValidacao;
}

export interface AcoesSimulacao {
    recarregar_lista: () => void;
    abrir: (id: string) => void;
    criar: (dados: Omit<DadosSimulacao, "premissas">) => void;
    editar: (mudanca: Partial<Omit<DadosSimulacao, "premissas">>) => void;
    editar_premissa: (cod: CodPremissa, mudanca: Partial<Omit<PremissaEditavel, "cod_premissa">>) => void;
    salvar: (status: "salvo" | "rascunho") => void;
    duplicar: (id: string) => void;
    arquivar: (id: string) => void;
    restaurar: (id: string) => void;
    /** Descarta a edição não salva e volta à versão gravada. */
    descartar: () => void;
    fechar: () => void;
    definir_modo: (modo: ModoVisao) => void;
    limpar_aviso: () => void;
}

/** A edição difere da versão gravada? */
export function edicao_alterada(aberta: SimulacaoCompleta | null, edicao: DadosSimulacao | null): boolean {
    if (!aberta || !edicao) return false;
    const gravada = dados_da_simulacao(aberta);
    const normal = (d: DadosSimulacao) =>
        JSON.stringify({
            ...d,
            nome: d.nome.trim(),
            descricao: d.descricao.trim(),
            premissas: d.premissas.map((p) => ({ ...p, justificativa: p.justificativa.trim() })),
        });
    return normal(gravada) !== normal(edicao);
}

export function useEstadoSimulacao(repositorio: RepositorioSimulacoes | null): [EstadoSimulacao, AcoesSimulacao] {
    const [lista, definir_lista] = useState<Simulacao[] | undefined>();
    const [erro_lista, definir_erro_lista] = useState<string | null>(null);
    const [aberta, definir_aberta] = useState<SimulacaoCompleta | null>(null);
    const [edicao, definir_edicao] = useState<DadosSimulacao | null>(null);
    const [historico, definir_historico] = useState<RegistroAuditoria[] | undefined>();
    const [erro_historico, definir_erro_historico] = useState<string | null>(null);
    const [modo, definir_modo] = useState<ModoVisao>("realizado");
    const [operacao, definir_operacao] = useState<Operacao | null>(null);
    const [aviso, definir_aviso] = useState<AvisoSimulacao | null>(null);
    const [erros, definir_erros] = useState<ErrosValidacao>({});
    const ocupado = useRef(false);

    const carregar_historico = useCallback(
        (id: string) => {
            if (!repositorio) return;
            definir_erro_historico(null);
            repositorio
                .historico(id)
                .then(definir_historico)
                .catch((erro: unknown) => definir_erro_historico(mensagem_para_usuario(erro)));
        },
        [repositorio],
    );

    const carregar_lista = useCallback(() => {
        if (!repositorio) return;
        definir_erro_lista(null);
        repositorio
            .listar()
            .then(definir_lista)
            .catch((erro: unknown) => definir_erro_lista(mensagem_para_usuario(erro)));
    }, [repositorio]);

    useEffect(() => {
        // primeira leitura da lista, assim que o repositório (a sessão) existe
        if (!repositorio) return;
        let cancelado = false;
        repositorio
            .listar()
            .then((linhas) => {
                if (!cancelado) definir_lista(linhas);
            })
            .catch((erro: unknown) => {
                if (!cancelado) definir_erro_lista(mensagem_para_usuario(erro));
            });
        return () => {
            cancelado = true;
        };
    }, [repositorio]);

    /** Aplica a simulação gravada como aberta e como edição, e relê lista e histórico. */
    const assumir = useCallback(
        (completa: SimulacaoCompleta) => {
            definir_aberta(completa);
            definir_edicao(dados_da_simulacao(completa));
            definir_erros({});
            definir_historico(undefined);
            carregar_historico(completa.simulacao.id);
            carregar_lista();
        },
        [carregar_historico, carregar_lista],
    );

    /** Executa uma gravação por vez, com aviso de sucesso, erro ou conflito. */
    const executar = useCallback(
        (tipo: Operacao, operacao_repo: (repo: RepositorioSimulacoes) => Promise<SimulacaoCompleta>, sucesso: string) => {
            if (!repositorio || ocupado.current) return;
            ocupado.current = true;
            definir_operacao(tipo);
            definir_aviso(null);
            operacao_repo(repositorio)
                .then((completa) => {
                    assumir(completa);
                    definir_aviso({ tipo: "sucesso", texto: sucesso });
                })
                .catch((erro: unknown) => {
                    if (erro instanceof ErroValidacaoSimulacao) definir_erros(erro.erros);
                    definir_aviso({
                        tipo: erro instanceof ErroConflitoVersao ? "conflito" : "erro",
                        texto: mensagem_para_usuario(erro),
                    });
                })
                .finally(() => {
                    ocupado.current = false;
                    definir_operacao(null);
                });
        },
        [repositorio, assumir],
    );

    const versao = aberta?.simulacao.versao ?? 0;
    const id_aberta = aberta?.simulacao.id;

    const acoes = useMemo<AcoesSimulacao>(
        () => ({
            recarregar_lista: carregar_lista,
            abrir: (id) => executar("abrindo", (repo) => repo.abrir(id), "Simulação aberta."),
            criar: (dados) => executar("criando", (repo) => repo.criar(dados), "Simulação criada em rascunho."),
            editar: (mudanca) => definir_edicao((atual) => (atual ? { ...atual, ...mudanca } : atual)),
            editar_premissa: (cod, mudanca) =>
                definir_edicao((atual) =>
                    atual
                        ? {
                            ...atual,
                            premissas: atual.premissas.map((p) => (p.cod_premissa === cod ? { ...p, ...mudanca } : p)),
                        }
                        : atual,
                ),
            salvar: (status) => {
                if (!id_aberta || !edicao) return;
                const dados = edicao;
                executar(
                    "salvando",
                    (repo) => repo.salvar(id_aberta, versao, dados, status),
                    status === "salvo" ? "Simulação salva com as justificativas." : "Rascunho salvo.",
                );
            },
            duplicar: (id) => executar("duplicando", (repo) => repo.duplicar(id), "Cópia criada em rascunho."),
            arquivar: (id) => {
                const v = id === id_aberta ? versao : lista?.find((s) => s.id === id)?.versao;
                if (v === undefined) return;
                executar("arquivando", (repo) => repo.arquivar(id, v), "Simulação arquivada.");
            },
            restaurar: (id) => {
                const v = id === id_aberta ? versao : lista?.find((s) => s.id === id)?.versao;
                if (v === undefined) return;
                executar("restaurando", (repo) => repo.restaurar(id, v), "Simulação restaurada.");
            },
            descartar: () => {
                if (aberta) definir_edicao(dados_da_simulacao(aberta));
                definir_erros({});
                definir_aviso(null);
            },
            fechar: () => {
                definir_aberta(null);
                definir_edicao(null);
                definir_historico(undefined);
                definir_erros({});
                definir_aviso(null);
                definir_modo("realizado");
            },
            definir_modo,
            limpar_aviso: () => definir_aviso(null),
        }),
        [carregar_lista, executar, id_aberta, edicao, versao, lista, aberta],
    );

    const estado: EstadoSimulacao = {
        disponivel: repositorio !== null,
        lista,
        erro_lista,
        aberta,
        edicao,
        nao_salvo: edicao_alterada(aberta, edicao),
        somente_leitura: aberta?.simulacao.status === "arquivado",
        historico,
        erro_historico,
        modo: edicao ? modo : "realizado",
        operacao,
        aviso,
        erros,
    };
    return [estado, acoes];
}
