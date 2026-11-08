// Cliente de dados falso, só para testes: imita o client.data do Rayfin 1.36.2 e as
// regras do banco, para que o teste não esconda erro que o backend real mostraria.
// - leitura devolve só os campos selecionados; create/update devolvem só o `id`;
// - policy claims.sub = usuario_id em leitura, criação e alteração; sem delete;
// - auditoria só aceita criação e leitura; chave_premissa é única; @set é validado;
// - `{ simulacao: { id } }` vira `simulacao_id`, como faz o cliente.

import type { ClienteDadosSimulacao, ConsultaFluente, EntidadeDados, Filtro } from "./repositorio_simulacoes";

type Registro = Record<string, unknown>;

interface RegraEntidade {
    acoes: ("create" | "read" | "update")[];
    unicos?: string[];
    conjuntos?: Record<string, readonly string[]>;
}

const regras: Record<keyof ClienteDadosSimulacao, RegraEntidade> = {
    simulacao: {
        acoes: ["create", "read", "update"],
        conjuntos: { status: ["rascunho", "salvo", "arquivado"] },
    },
    premissa_simulacao: {
        acoes: ["create", "read", "update"],
        unicos: ["chave_premissa"],
        conjuntos: {
            cod_premissa: ["receita_liquida", "custos", "despesas_administrativas"],
            tipo_ajuste: ["percentual", "absoluto"],
        },
    },
    auditoria_simulacao: {
        acoes: ["create", "read"],
        conjuntos: { acao: ["criar", "alterar_premissa", "salvar", "duplicar", "arquivar", "restaurar"] },
    },
};

export interface Escrita {
    entidade: string;
    operacao: "create" | "update";
    dados: Registro;
}

export class ErroBancoFalso extends Error {}

export class BancoFalso {
    readonly tabelas: Record<keyof ClienteDadosSimulacao, Registro[]> = {
        simulacao: [],
        premissa_simulacao: [],
        auditoria_simulacao: [],
    };
    readonly escritas: Escrita[] = [];
    private sequencia = 0;
    /** Executado antes de cada update: permite simular outra aba gravando no meio. */
    antes_de_update?: (entidade: string, id: string) => void;

    /** Cliente com a identidade (claims.sub) de um usuário. */
    cliente(sub: string): ClienteDadosSimulacao {
        const entidade = (nome: keyof ClienteDadosSimulacao): EntidadeDados => this.entidade(nome, sub);
        return {
            simulacao: entidade("simulacao"),
            premissa_simulacao: entidade("premissa_simulacao"),
            auditoria_simulacao: entidade("auditoria_simulacao"),
        };
    }

    private novo_id(): string {
        this.sequencia += 1;
        return `00000000-0000-4000-8000-${String(this.sequencia).padStart(12, "0")}`;
    }

    private normalizar(dados: Registro): Registro {
        const saida: Registro = {};
        for (const [campo, valor] of Object.entries(dados)) {
            if (valor && typeof valor === "object" && !(valor instanceof Date) && "id" in valor) {
                saida[`${campo}_id`] = (valor as { id: unknown }).id;
            } else {
                saida[campo] = valor instanceof Date ? valor.toISOString() : valor;
            }
        }
        return saida;
    }

    private validar(nome: keyof ClienteDadosSimulacao, registro: Registro, id_proprio?: string) {
        const regra = regras[nome];
        for (const [campo, valores] of Object.entries(regra.conjuntos ?? {})) {
            if (campo in registro && !valores.includes(String(registro[campo]))) {
                throw new ErroBancoFalso(`${nome}.${campo} fora do @set`);
            }
        }
        for (const campo of regra.unicos ?? []) {
            if (this.tabelas[nome].some((r) => r.id !== id_proprio && r[campo] === registro[campo])) {
                throw new ErroBancoFalso(`violação de unique em ${nome}.${campo}`);
            }
        }
    }

    private entidade(nome: keyof ClienteDadosSimulacao, sub: string): EntidadeDados {
        const regra = regras[nome];
        const exigir = (acao: "create" | "read" | "update") => {
            if (!regra.acoes.includes(acao)) throw new ErroBancoFalso(`${acao} não permitido em ${nome}`);
        };
        const visiveis = () => this.tabelas[nome].filter((r) => r.usuario_id === sub);

        return {
            select: (campos) => {
                exigir("read");
                let filtro: Filtro = {};
                let ordem: Record<string, "asc" | "desc"> | undefined;
                let limite = 100;
                const consulta: ConsultaFluente = {
                    where: (f) => {
                        filtro = f;
                        return consulta;
                    },
                    orderBy: (o) => {
                        ordem = o;
                        return consulta;
                    },
                    first: (n) => {
                        limite = n;
                        return consulta;
                    },
                    execute: async () => {
                        let linhas = visiveis().filter((r) =>
                            Object.entries(filtro).every(([campo, cond]) => r[campo] === cond.eq),
                        );
                        if (ordem) {
                            const [campo, sentido] = Object.entries(ordem)[0];
                            linhas = [...linhas].sort((a, b) => {
                                const c = String(a[campo]).localeCompare(String(b[campo]));
                                return sentido === "desc" ? -c : c;
                            });
                        }
                        return linhas
                            .slice(0, Math.min(limite, 100))
                            .map((r) => Object.fromEntries(campos.map((c) => [c, r[c] ?? null])));
                    },
                };
                return consulta;
            },
            create: async (dados) => {
                exigir("create");
                const registro = this.normalizar(dados);
                if (registro.usuario_id !== sub) throw new ErroBancoFalso("policy: usuario_id diferente de claims.sub");
                this.validar(nome, registro);
                const id = this.novo_id();
                this.tabelas[nome].push({ ...registro, id });
                this.escritas.push({ entidade: nome, operacao: "create", dados: registro });
                return { id };
            },
            update: async (chave, dados) => {
                exigir("update");
                this.antes_de_update?.(nome, chave.id);
                const registro = visiveis().find((r) => r.id === chave.id);
                if (!registro) throw new ErroBancoFalso("registro não encontrado ou sem permissão");
                const mudanca = this.normalizar(dados);
                if ("usuario_id" in mudanca && mudanca.usuario_id !== sub) {
                    throw new ErroBancoFalso("policy: usuario_id diferente de claims.sub");
                }
                this.validar(nome, { ...registro, ...mudanca }, chave.id);
                Object.assign(registro, mudanca);
                this.escritas.push({ entidade: nome, operacao: "update", dados: mudanca });
                return { id: chave.id };
            },
        };
    }
}
