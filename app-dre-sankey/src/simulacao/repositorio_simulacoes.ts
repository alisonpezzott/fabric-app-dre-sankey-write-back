// Write-back das simulações no SQL Database do app (GraphQL do Rayfin): CRUD sem exclusão,
// concorrência otimista pelo campo `versao` e auditoria de toda ação relevante.
// Nunca escreve no modelo semântico: só conhece as três entidades de rayfin/data/.
//
// Rayfin 1.36.2: uma consulta sem `.select([...])` e o findById devolvem só o `id`, e as
// mutações também. Toda leitura seleciona todos os campos; depois de criar, o registro é relido.

import { cods_premissa, definicoes_premissas, e_cod_premissa, e_tipo_ajuste, type CodPremissa, type TipoAjuste } from "./mapa_premissas";
import {
    sem_erros,
    status_valido,
    tamanhos,
    validar_simulacao,
    type DadosSimulacao,
    type ErrosValidacao,
    type PremissaEditavel,
} from "./validacao_premissas";

export const status_simulacao = ["rascunho", "salvo", "arquivado"] as const;
export type StatusSimulacao = (typeof status_simulacao)[number];

export const acoes_auditoria = ["criar", "alterar_premissa", "salvar", "duplicar", "arquivar", "restaurar"] as const;
export type AcaoAuditoria = (typeof acoes_auditoria)[number];

// ---------------------------------------------------------------- registros

export interface Simulacao {
    id: string;
    nome: string;
    descricao: string;
    ano: number;
    mes_inicio: number;
    mes_fim: number;
    status: StatusSimulacao;
    usuario_id: string;
    email_usuario: string;
    criado_em: string;
    alterado_em: string;
    versao: number;
}

export interface Premissa {
    id: string;
    simulacao_id: string;
    cod_premissa: CodPremissa;
    chave_premissa: string;
    tipo_ajuste: TipoAjuste;
    valor_ajuste: number;
    justificativa: string;
    usuario_id: string;
    criado_em: string;
    alterado_em: string;
}

export interface RegistroAuditoria {
    id: string;
    simulacao_id: string;
    premissa_id: string | null;
    acao: AcaoAuditoria;
    valor_anterior: string | null;
    valor_novo: string | null;
    usuario_id: string;
    email_usuario: string;
    alterado_em: string;
}

export interface SimulacaoCompleta {
    simulacao: Simulacao;
    /** Sempre as três, na ordem de cods_premissa. */
    premissas: Premissa[];
}

const campos_simulacao = [
    "id", "nome", "descricao", "ano", "mes_inicio", "mes_fim", "status",
    "usuario_id", "email_usuario", "criado_em", "alterado_em", "versao",
] as const;
const campos_premissa = [
    "id", "simulacao_id", "cod_premissa", "chave_premissa", "tipo_ajuste", "valor_ajuste",
    "justificativa", "usuario_id", "criado_em", "alterado_em",
] as const;
const campos_auditoria = [
    "id", "simulacao_id", "premissa_id", "acao", "valor_anterior", "valor_novo",
    "usuario_id", "email_usuario", "alterado_em",
] as const;

// ---------------------------------------------------------------- cliente de dados

type Registro = Record<string, unknown>;
export type Filtro = Record<string, { eq: unknown }>;

/** Subconjunto da API fluente do `client.data.<entidade>` do Rayfin usado aqui. */
export interface ConsultaFluente {
    where(filtro: Filtro): ConsultaFluente;
    orderBy(ordem: Record<string, "asc" | "desc">): ConsultaFluente;
    first(quantidade: number): ConsultaFluente;
    execute(): Promise<Registro[]>;
}

export interface EntidadeDados {
    select(campos: readonly string[]): ConsultaFluente;
    create(dados: Registro): Promise<Registro>;
    update(chave: { id: string }, dados: Registro): Promise<Registro>;
}

/** As três entidades do write-back; nenhuma outra escrita é possível pelo repositório. */
export interface ClienteDadosSimulacao {
    simulacao: EntidadeDados;
    premissa_simulacao: EntidadeDados;
    auditoria_simulacao: EntidadeDados;
}

export interface UsuarioAtual {
    /** session.user.id: deve ser o mesmo claims.sub das policies. */
    id: string;
    email: string;
}

// ---------------------------------------------------------------- erros

/** A simulação foi alterada em outra aba (ou sessão) desde que foi lida. */
export class ErroConflitoVersao extends Error {
    constructor() {
        super("Esta simulação foi alterada em outra aba. Recarregue para ver a versão atual.");
        this.name = "ErroConflitoVersao";
    }
}

export class ErroValidacaoSimulacao extends Error {
    constructor(readonly erros: ErrosValidacao) {
        super("Revise os campos destacados antes de salvar.");
        this.name = "ErroValidacaoSimulacao";
    }
}

/** Erro de gravação ou leitura sem detalhes internos para a UI. */
export class ErroRepositorio extends Error {
    constructor(mensagem: string, readonly causa?: unknown) {
        super(mensagem);
        this.name = "ErroRepositorio";
    }
}

/** Mensagem segura para a UI: só os erros do próprio repositório passam o texto adiante. */
export function mensagem_para_usuario(erro: unknown): string {
    if (erro instanceof ErroConflitoVersao || erro instanceof ErroValidacaoSimulacao || erro instanceof ErroRepositorio) {
        return erro.message;
    }
    return "Não foi possível acessar as simulações. Tente de novo em instantes.";
}

// ---------------------------------------------------------------- conversões

function texto(r: Registro, campo: string): string {
    const v = r[campo];
    return v === null || v === undefined ? "" : String(v);
}

function inteiro(r: Registro, campo: string): number {
    const v = Number(r[campo]);
    return Number.isFinite(v) ? v : 0;
}

function data_iso(r: Registro, campo: string): string {
    const v = r[campo];
    if (v instanceof Date) return v.toISOString();
    return v === null || v === undefined ? "" : String(v);
}

function para_simulacao(r: Registro): Simulacao {
    const status = texto(r, "status");
    if (!(status_simulacao as readonly string[]).includes(status)) {
        throw new ErroRepositorio("A simulação gravada tem um status desconhecido.");
    }
    return {
        id: texto(r, "id"),
        nome: texto(r, "nome"),
        descricao: texto(r, "descricao"),
        ano: inteiro(r, "ano"),
        mes_inicio: inteiro(r, "mes_inicio"),
        mes_fim: inteiro(r, "mes_fim"),
        status: status as StatusSimulacao,
        usuario_id: texto(r, "usuario_id"),
        email_usuario: texto(r, "email_usuario"),
        criado_em: data_iso(r, "criado_em"),
        alterado_em: data_iso(r, "alterado_em"),
        versao: inteiro(r, "versao"),
    };
}

function para_premissa(r: Registro): Premissa {
    const cod = r.cod_premissa;
    const tipo = r.tipo_ajuste;
    if (!e_cod_premissa(cod) || !e_tipo_ajuste(tipo)) {
        throw new ErroRepositorio("Uma premissa gravada tem código ou tipo desconhecido.");
    }
    return {
        id: texto(r, "id"),
        simulacao_id: texto(r, "simulacao_id"),
        cod_premissa: cod,
        chave_premissa: texto(r, "chave_premissa"),
        tipo_ajuste: tipo,
        valor_ajuste: Number(r.valor_ajuste ?? 0),
        justificativa: texto(r, "justificativa"),
        usuario_id: texto(r, "usuario_id"),
        criado_em: data_iso(r, "criado_em"),
        alterado_em: data_iso(r, "alterado_em"),
    };
}

function para_auditoria(r: Registro): RegistroAuditoria {
    return {
        id: texto(r, "id"),
        simulacao_id: texto(r, "simulacao_id"),
        premissa_id: r.premissa_id ? texto(r, "premissa_id") : null,
        acao: texto(r, "acao") as AcaoAuditoria,
        valor_anterior: r.valor_anterior ? texto(r, "valor_anterior") : null,
        valor_novo: r.valor_novo ? texto(r, "valor_novo") : null,
        usuario_id: texto(r, "usuario_id"),
        email_usuario: texto(r, "email_usuario"),
        alterado_em: data_iso(r, "alterado_em"),
    };
}

export function chave_premissa(simulacao_id: string, cod: CodPremissa): string {
    return `${simulacao_id}:${cod}`;
}

/** Dados editáveis de uma simulação gravada (o formato do formulário). */
export function dados_da_simulacao(completa: SimulacaoCompleta): DadosSimulacao {
    return {
        nome: completa.simulacao.nome,
        descricao: completa.simulacao.descricao,
        ano: completa.simulacao.ano,
        mes_inicio: completa.simulacao.mes_inicio,
        mes_fim: completa.simulacao.mes_fim,
        premissas: completa.premissas.map((p) => ({
            cod_premissa: p.cod_premissa,
            tipo_ajuste: p.tipo_ajuste,
            valor_ajuste: p.valor_ajuste,
            justificativa: p.justificativa,
        })),
    };
}

/** Premissas zeradas: as três nascem com a simulação. */
export function premissas_zeradas(): PremissaEditavel[] {
    return cods_premissa.map((cod) => ({ cod_premissa: cod, tipo_ajuste: "percentual", valor_ajuste: 0, justificativa: "" }));
}

/** Limite das colunas valor_anterior/valor_novo da auditoria. */
export const limite_json_auditoria = 2000;

/** JSON da auditoria dentro do limite da coluna: encurta textos longos, nunca corta o JSON. */
export function json_auditoria(valor: unknown): string {
    let json = JSON.stringify(valor);
    for (const limite of [400, 120, 40]) {
        if (json.length <= limite_json_auditoria) break;
        json = JSON.stringify(valor, (_, v) => (typeof v === "string" && v.length > limite ? `${v.slice(0, limite)}…` : v));
    }
    return json.length <= limite_json_auditoria ? json : JSON.stringify({ resumo: "conteúdo longo demais para a auditoria" });
}

function resumo_simulacao(s: Pick<Simulacao, "nome" | "descricao" | "ano" | "mes_inicio" | "mes_fim" | "status" | "versao">) {
    return {
        nome: s.nome,
        descricao: s.descricao,
        ano: s.ano,
        mes_inicio: s.mes_inicio,
        mes_fim: s.mes_fim,
        status: s.status,
        versao: s.versao,
    };
}

function resumo_premissa(p: Pick<PremissaEditavel, "cod_premissa" | "tipo_ajuste" | "valor_ajuste" | "justificativa">) {
    return { cod_premissa: p.cod_premissa, tipo_ajuste: p.tipo_ajuste, valor_ajuste: p.valor_ajuste, justificativa: p.justificativa };
}

function premissa_mudou(atual: Premissa, nova: PremissaEditavel): boolean {
    return atual.tipo_ajuste !== nova.tipo_ajuste
        || atual.valor_ajuste !== nova.valor_ajuste
        || atual.justificativa.trim() !== nova.justificativa.trim();
}

/** Uma página do Rayfin: lista e histórico mostram até 100 itens. */
export const limite_pagina = 100;

// ---------------------------------------------------------------- repositório

export class RepositorioSimulacoes {
    constructor(
        private readonly dados: ClienteDadosSimulacao,
        private readonly usuario: UsuarioAtual,
        private readonly agora: () => Date = () => new Date(),
    ) {}

    private async executar<T>(mensagem: string, operacao: () => Promise<T>): Promise<T> {
        try {
            return await operacao();
        } catch (erro) {
            if (erro instanceof ErroConflitoVersao || erro instanceof ErroValidacaoSimulacao || erro instanceof ErroRepositorio) {
                throw erro;
            }
            throw new ErroRepositorio(mensagem, erro);
        }
    }

    /** Simulações do usuário (a policy já filtra; o where repete a regra), mais recentes primeiro. */
    listar(): Promise<Simulacao[]> {
        return this.executar("Não foi possível listar as simulações.", async () => {
            const linhas = await this.dados.simulacao
                .select(campos_simulacao)
                .where({ usuario_id: { eq: this.usuario.id } })
                .orderBy({ alterado_em: "desc" })
                .first(limite_pagina)
                .execute();
            return linhas.map(para_simulacao);
        });
    }

    private async ler_simulacao(id: string): Promise<Simulacao> {
        const linhas = await this.dados.simulacao.select(campos_simulacao).where({ id: { eq: id } }).execute();
        if (linhas.length === 0) throw new ErroRepositorio("Simulação não encontrada.");
        return para_simulacao(linhas[0]);
    }

    private async ler_premissas(simulacao_id: string): Promise<Premissa[]> {
        const linhas = await this.dados.premissa_simulacao
            .select(campos_premissa)
            .where({ simulacao_id: { eq: simulacao_id } })
            .execute();
        const premissas = linhas.map(para_premissa);
        const ordenadas = cods_premissa.map((cod) => premissas.find((p) => p.cod_premissa === cod));
        if (ordenadas.some((p) => p === undefined)) {
            throw new ErroRepositorio("A simulação está com premissas incompletas.");
        }
        return ordenadas as Premissa[];
    }

    abrir(id: string): Promise<SimulacaoCompleta> {
        return this.executar("Não foi possível abrir a simulação.", async () => ({
            simulacao: await this.ler_simulacao(id),
            premissas: await this.ler_premissas(id),
        }));
    }

    historico(simulacao_id: string): Promise<RegistroAuditoria[]> {
        return this.executar("Não foi possível ler o histórico.", async () => {
            const linhas = await this.dados.auditoria_simulacao
                .select(campos_auditoria)
                .where({ simulacao_id: { eq: simulacao_id } })
                .orderBy({ alterado_em: "desc" })
                .first(limite_pagina)
                .execute();
            return linhas.map(para_auditoria);
        });
    }

    private async auditar(
        simulacao_id: string,
        acao: AcaoAuditoria,
        anterior: unknown,
        novo: unknown,
        premissa_id?: string,
    ): Promise<void> {
        await this.dados.auditoria_simulacao.create({
            simulacao: { id: simulacao_id },
            premissa_id: premissa_id ?? null,
            acao,
            valor_anterior: anterior === null ? null : json_auditoria(anterior),
            valor_novo: novo === null ? null : json_auditoria(novo),
            usuario_id: this.usuario.id,
            email_usuario: this.usuario.email.slice(0, 320),
            alterado_em: this.agora(),
        });
    }

    /** Grava simulação + três premissas; devolve o registro relido do banco. */
    private async gravar_nova(dados: DadosSimulacao, status: StatusSimulacao): Promise<SimulacaoCompleta> {
        const agora = this.agora();
        const criada = await this.dados.simulacao.create({
            nome: dados.nome.trim(),
            descricao: dados.descricao.trim() || null,
            ano: dados.ano,
            mes_inicio: dados.mes_inicio,
            mes_fim: dados.mes_fim,
            status,
            usuario_id: this.usuario.id,
            email_usuario: this.usuario.email.slice(0, 320),
            criado_em: agora,
            alterado_em: agora,
            versao: 1,
        });
        const id = texto(criada, "id");
        if (!id) throw new ErroRepositorio("O banco não devolveu o identificador da simulação.");
        for (const premissa of dados.premissas) {
            await this.dados.premissa_simulacao.create({
                simulacao: { id },
                cod_premissa: premissa.cod_premissa,
                chave_premissa: chave_premissa(id, premissa.cod_premissa),
                tipo_ajuste: premissa.tipo_ajuste,
                valor_ajuste: premissa.valor_ajuste,
                justificativa: premissa.justificativa.trim() || null,
                usuario_id: this.usuario.id,
                criado_em: agora,
                alterado_em: agora,
            });
        }
        return { simulacao: await this.ler_simulacao(id), premissas: await this.ler_premissas(id) };
    }

    /** Cria a simulação em rascunho, com as três premissas zeradas. */
    criar(dados: Omit<DadosSimulacao, "premissas">): Promise<SimulacaoCompleta> {
        return this.executar("Não foi possível criar a simulação.", async () => {
            const completos: DadosSimulacao = { ...dados, premissas: premissas_zeradas() };
            const erros = validar_simulacao(completos, { exigir_justificativa: false });
            if (!sem_erros(erros)) throw new ErroValidacaoSimulacao(erros);
            const nova = await this.gravar_nova(completos, "rascunho");
            await this.auditar(nova.simulacao.id, "criar", null, {
                ...resumo_simulacao(nova.simulacao),
                premissas: nova.premissas.map(resumo_premissa),
            });
            return nova;
        });
    }

    /**
     * Relê a simulação e confere a versão (concorrência otimista). O update do Data API
     * Builder é por chave primária, sem ETag: entre esta leitura e a gravação há uma
     * pequena janela de corrida (limitação documentada).
     */
    private async conferir_versao(id: string, versao_lida: number): Promise<Simulacao> {
        const atual = await this.ler_simulacao(id);
        if (atual.versao !== versao_lida) throw new ErroConflitoVersao();
        return atual;
    }

    /**
     * Salva metadados e premissas. `salvo` exige justificativa em toda premissa diferente
     * de zero; `rascunho` não. Arquivada é só leitura.
     */
    salvar(
        id: string,
        versao_lida: number,
        dados: DadosSimulacao,
        status: "salvo" | "rascunho",
    ): Promise<SimulacaoCompleta> {
        return this.executar("Não foi possível salvar a simulação.", async () => {
            const erros = validar_simulacao(dados, { exigir_justificativa: status === "salvo" });
            if (!sem_erros(erros)) throw new ErroValidacaoSimulacao(erros);
            const atual = await this.conferir_versao(id, versao_lida);
            if (atual.status === "arquivado") {
                throw new ErroRepositorio("Simulação arquivada é só leitura: restaure-a para editar.");
            }
            const agora = this.agora();
            const nova_versao = atual.versao + 1;
            // a versão sobe primeiro: outra aba que leu a versão anterior passa a ver o conflito
            await this.dados.simulacao.update(
                { id },
                {
                    nome: dados.nome.trim(),
                    descricao: dados.descricao.trim() || null,
                    ano: dados.ano,
                    mes_inicio: dados.mes_inicio,
                    mes_fim: dados.mes_fim,
                    status,
                    alterado_em: agora,
                    versao: nova_versao,
                },
            );

            const premissas_atuais = await this.ler_premissas(id);
            for (const nova of dados.premissas) {
                const antiga = premissas_atuais.find((p) => p.cod_premissa === nova.cod_premissa)!;
                if (!premissa_mudou(antiga, nova)) continue;
                await this.dados.premissa_simulacao.update(
                    { id: antiga.id },
                    {
                        tipo_ajuste: nova.tipo_ajuste,
                        valor_ajuste: nova.valor_ajuste,
                        justificativa: nova.justificativa.trim() || null,
                        alterado_em: agora,
                    },
                );
                await this.auditar(id, "alterar_premissa", resumo_premissa(antiga), resumo_premissa(nova), antiga.id);
            }

            const salva = await this.abrir(id);
            await this.auditar(id, "salvar", resumo_simulacao(atual), resumo_simulacao(salva.simulacao));
            return salva;
        });
    }

    /** Cópia em rascunho, com as mesmas premissas e justificativas. */
    duplicar(id: string): Promise<SimulacaoCompleta> {
        return this.executar("Não foi possível duplicar a simulação.", async () => {
            const origem = await this.abrir(id);
            const dados = dados_da_simulacao(origem);
            const nome = `Cópia de ${dados.nome}`.slice(0, tamanhos.nome);
            const copia = await this.gravar_nova({ ...dados, nome }, "rascunho");
            await this.auditar(copia.simulacao.id, "duplicar", { origem_id: id, nome_origem: origem.simulacao.nome }, {
                ...resumo_simulacao(copia.simulacao),
                premissas: copia.premissas.map(resumo_premissa),
            });
            return copia;
        });
    }

    private mudar_status(id: string, versao_lida: number, acao: "arquivar" | "restaurar"): Promise<SimulacaoCompleta> {
        return this.executar(`Não foi possível ${acao} a simulação.`, async () => {
            const atual = await this.conferir_versao(id, versao_lida);
            const premissas = await this.ler_premissas(id);
            if (acao === "arquivar" && atual.status === "arquivado") throw new ErroRepositorio("A simulação já está arquivada.");
            if (acao === "restaurar" && atual.status !== "arquivado") throw new ErroRepositorio("A simulação não está arquivada.");
            const status: StatusSimulacao = acao === "arquivar"
                ? "arquivado"
                : status_valido(dados_da_simulacao({ simulacao: atual, premissas }));
            await this.dados.simulacao.update(
                { id },
                { status, alterado_em: this.agora(), versao: atual.versao + 1 },
            );
            const resultado = await this.abrir(id);
            await this.auditar(id, acao, resumo_simulacao(atual), resumo_simulacao(resultado.simulacao));
            return resultado;
        });
    }

    arquivar(id: string, versao_lida: number): Promise<SimulacaoCompleta> {
        return this.mudar_status(id, versao_lida, "arquivar");
    }

    /** Volta para `salvo` se todas as justificativas exigidas existem; senão, `rascunho`. */
    restaurar(id: string, versao_lida: number): Promise<SimulacaoCompleta> {
        return this.mudar_status(id, versao_lida, "restaurar");
    }
}

/** Rótulo de cada premissa para histórico e mensagens. */
export function rotulo_premissa(cod: string): string {
    return e_cod_premissa(cod) ? definicoes_premissas[cod].rotulo : cod;
}
