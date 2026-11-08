// Gaveta "Simulação" (lateral no desktop, tela inteira no mobile), com as abas:
// Premissas (simulação aberta e impacto ao vivo), Simulações salvas e Histórico.
// O impacto atualiza a cada alteração, sem salvar; salvar grava no SQL Database do app.

import { useId, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Copy, Eye, FlaskConical, Save, Undo2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AcoesSimulacao, EstadoSimulacao } from "@/estado/estado_simulacao";
import { lista_premissas } from "@/simulacao/mapa_premissas";
import type { ResultadoSimulacao } from "@/simulacao/motor_simulacao";
import { periodo_simulacao } from "@/simulacao/textos_simulacao";
import { tamanhos, chave_erro } from "@/simulacao/validacao_premissas";
import {
    Aviso,
    BotaoAcao,
    Campo,
    classe_campo,
    EditorPremissa,
    ImpactoAoVivo,
    SeloSimulado,
    SeloStatus,
} from "./controles_simulacao";
import { EstadoCarregando, EstadoErro } from "./estados_carregamento";
import { HistoricoSimulacao } from "./historico_simulacao";
import { ListaSimulacoes } from "./lista_simulacoes";

type Aba = "premissas" | "salvas" | "historico";

export interface OpcoesPeriodo {
    anos: number[];
    meses: { mes: number; nome_mes: string }[];
}

interface PainelSimulacaoProps {
    estado: EstadoSimulacao;
    acoes: AcoesSimulacao;
    opcoes: OpcoesPeriodo;
    /** Período sugerido para uma nova simulação (o recorte atual da barra). */
    periodo_sugerido: { ano: number; mes_inicio: number; mes_fim: number };
    /** Simulação aplicada ao período inteiro (todas as regiões): o impacto ao vivo. */
    resultado_periodo: ResultadoSimulacao | null;
    carregando_base: boolean;
    erro_base: Error | undefined;
    ao_fechar: () => void;
}

function Abas({ aba, definir, tem_aberta }: { aba: Aba; definir: (aba: Aba) => void; tem_aberta: boolean }) {
    const itens: { valor: Aba; rotulo: string; desabilitada?: boolean }[] = [
        { valor: "premissas", rotulo: "Premissas" },
        { valor: "salvas", rotulo: "Simulações salvas" },
        { valor: "historico", rotulo: "Histórico", desabilitada: !tem_aberta },
    ];
    return (
        <div role="tablist" aria-label="Seções da simulação" className="flex border-b border-border">
            {itens.map((item) => (
                <button
                    key={item.valor}
                    type="button"
                    role="tab"
                    aria-selected={aba === item.valor}
                    disabled={item.desabilitada}
                    onClick={() => definir(item.valor)}
                    className={cn(
                        "-mb-px border-b-2 px-3 py-2 text-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        aba === item.valor
                            ? "border-interativo font-semibold text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                >
                    {item.rotulo}
                </button>
            ))}
        </div>
    );
}

function SeletorPeriodo({
    id,
    opcoes,
    ano,
    mes_inicio,
    mes_fim,
    desabilitado,
    erro,
    ao_mudar,
}: {
    id: string;
    opcoes: OpcoesPeriodo;
    ano: number;
    mes_inicio: number;
    mes_fim: number;
    desabilitado: boolean;
    erro?: string;
    ao_mudar: (periodo: { ano: number; mes_inicio: number; mes_fim: number }) => void;
}) {
    return (
        <Campo id={`${id}_ano`} rotulo="Período (o realizado deste período é a base da simulação)" erro={erro}>
            <div className="flex flex-wrap items-center gap-2">
                <select
                    id={`${id}_ano`}
                    className={cn(classe_campo, "w-auto")}
                    value={ano}
                    disabled={desabilitado}
                    onChange={(e) => ao_mudar({ ano: Number(e.target.value), mes_inicio, mes_fim })}
                >
                    {opcoes.anos.map((a) => (
                        <option key={a} value={a}>{a}</option>
                    ))}
                </select>
                <label htmlFor={`${id}_inicio`} className="sr-only">Mês inicial</label>
                <select
                    id={`${id}_inicio`}
                    className={cn(classe_campo, "w-auto")}
                    value={mes_inicio}
                    disabled={desabilitado}
                    onChange={(e) => {
                        const inicio = Number(e.target.value);
                        ao_mudar({ ano, mes_inicio: inicio, mes_fim: Math.max(inicio, mes_fim) });
                    }}
                >
                    {opcoes.meses.map((m) => (
                        <option key={m.mes} value={m.mes}>{m.nome_mes}</option>
                    ))}
                </select>
                <span className="text-200 text-texto-fraco">até</span>
                <label htmlFor={`${id}_fim`} className="sr-only">Mês final</label>
                <select
                    id={`${id}_fim`}
                    className={cn(classe_campo, "w-auto")}
                    value={mes_fim}
                    disabled={desabilitado}
                    onChange={(e) => {
                        const fim = Number(e.target.value);
                        ao_mudar({ ano, mes_inicio: Math.min(mes_inicio, fim), mes_fim: fim });
                    }}
                >
                    {opcoes.meses.map((m) => (
                        <option key={m.mes} value={m.mes}>{m.nome_mes}</option>
                    ))}
                </select>
            </div>
        </Campo>
    );
}

/** Formulário de nova simulação: nome, descrição e período. */
function NovaSimulacao({
    opcoes,
    periodo_sugerido,
    ocupado,
    erros,
    ao_criar,
}: {
    opcoes: OpcoesPeriodo;
    periodo_sugerido: { ano: number; mes_inicio: number; mes_fim: number };
    ocupado: boolean;
    erros: Record<string, string>;
    ao_criar: (dados: { nome: string; descricao: string; ano: number; mes_inicio: number; mes_fim: number }) => void;
}) {
    const id = useId();
    const [nome, definir_nome] = useState("");
    const [descricao, definir_descricao] = useState("");
    const [periodo, definir_periodo] = useState(periodo_sugerido);
    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                ao_criar({ nome, descricao, ...periodo });
            }}
        >
            <p className="text-300 text-muted-foreground">
                Crie uma simulação para testar premissas sobre o <strong className="text-foreground">realizado</strong>.
                O modelo semântico não muda: a simulação fica gravada só no banco do app.
            </p>
            <Campo id={`${id}_nome`} rotulo="Nome" erro={erros.nome}>
                <input
                    id={`${id}_nome`}
                    className={classe_campo}
                    maxLength={tamanhos.nome}
                    placeholder="ex.: Plano de contenção 2025"
                    value={nome}
                    onChange={(e) => definir_nome(e.target.value)}
                    aria-invalid={Boolean(erros.nome)}
                />
            </Campo>
            <Campo id={`${id}_desc`} rotulo="Descrição (opcional)" erro={erros.descricao}>
                <textarea
                    id={`${id}_desc`}
                    rows={2}
                    className={cn(classe_campo, "resize-y")}
                    maxLength={tamanhos.descricao}
                    value={descricao}
                    onChange={(e) => definir_descricao(e.target.value)}
                />
            </Campo>
            <SeletorPeriodo id={id} opcoes={opcoes} {...periodo} desabilitado={false} erro={erros.periodo} ao_mudar={definir_periodo} />
            <BotaoAcao type="submit" variante="primario" disabled={ocupado} className="self-start">
                <FlaskConical className="icon-size-200" aria-hidden="true" />
                {ocupado ? "Criando…" : "Criar simulação"}
            </BotaoAcao>
        </form>
    );
}

export function PainelSimulacao({
    estado,
    acoes,
    opcoes,
    periodo_sugerido,
    resultado_periodo,
    carregando_base,
    erro_base,
    ao_fechar,
}: PainelSimulacaoProps) {
    const id = useId();
    const [aba, definir_aba] = useState<Aba>("premissas");
    const [criando_nova, definir_criando_nova] = useState(false);
    const { aberta, edicao, erros, operacao } = estado;
    const ocupado = operacao !== null;
    const nome_mes = (mes: number) => opcoes.meses.find((m) => m.mes === mes)?.nome_mes ?? String(mes);

    const confirmar_descarte = () =>
        !estado.nao_salvo || window.confirm("Há alterações não salvas nesta simulação. Descartar?");

    const iniciar_nova = () => {
        if (!confirmar_descarte()) return;
        acoes.fechar();
        definir_criando_nova(true);
        definir_aba("premissas");
    };

    const abrir = (id_simulacao: string) => {
        if (!confirmar_descarte()) return;
        definir_criando_nova(false);
        acoes.abrir(id_simulacao);
        definir_aba("premissas");
    };

    let conteudo: ReactNode;
    if (!estado.disponivel) {
        conteudo = (
            <EstadoErro
                erro={new Error("Entre com a sua conta do Fabric para usar as simulações.")}
                titulo="Simulações indisponíveis"
            />
        );
    } else if (aba === "salvas") {
        conteudo = (
            <ListaSimulacoes
                lista={estado.lista}
                erro={estado.erro_lista}
                id_aberta={aberta?.simulacao.id ?? null}
                ocupado={ocupado}
                nome_mes={nome_mes}
                ao_abrir={abrir}
                ao_duplicar={acoes.duplicar}
                ao_arquivar={acoes.arquivar}
                ao_restaurar={acoes.restaurar}
                ao_nova={iniciar_nova}
                ao_recarregar={acoes.recarregar_lista}
            />
        );
    } else if (aba === "historico") {
        conteudo = <HistoricoSimulacao historico={estado.historico} erro={estado.erro_historico} />;
    } else if (!aberta || !edicao) {
        conteudo = operacao === "abrindo" ? (
            <EstadoCarregando className="h-60" rotulo="Abrindo a simulação…" />
        ) : criando_nova || (estado.lista !== undefined && estado.lista.length === 0) ? (
            <NovaSimulacao
                opcoes={opcoes}
                periodo_sugerido={periodo_sugerido}
                ocupado={operacao === "criando"}
                erros={erros}
                ao_criar={acoes.criar}
            />
        ) : (
            <div className="flex flex-col items-start gap-3 text-300 text-muted-foreground">
                <p>Nenhuma simulação aberta.</p>
                <div className="flex flex-wrap gap-2">
                    <BotaoAcao variante="primario" onClick={iniciar_nova}>
                        <FlaskConical className="icon-size-200" aria-hidden="true" />
                        Nova simulação
                    </BotaoAcao>
                    <BotaoAcao onClick={() => definir_aba("salvas")}>Abrir uma salva</BotaoAcao>
                </div>
            </div>
        );
    } else {
        const leitura = estado.somente_leitura;
        const invalidas = resultado_periodo?.fatores.invalidas ?? {};
        const totais = resultado_periodo?.fatores.totais_base;
        conteudo = (
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <SeloStatus status={aberta.simulacao.status} />
                    <span className="text-200 text-texto-fraco">versão {aberta.simulacao.versao}</span>
                    {estado.nao_salvo && (
                        <span className="text-200 text-custo" role="status">● alterações não salvas</span>
                    )}
                </div>
                {leitura && (
                    <p className="border-l-4 border-borda-forte bg-muted p-3 text-200 text-foreground">
                        Simulação arquivada: só leitura. Restaure para editar.
                    </p>
                )}

                <Campo id={`${id}_nome`} rotulo="Nome" erro={erros.nome}>
                    <input
                        id={`${id}_nome`}
                        className={classe_campo}
                        maxLength={tamanhos.nome}
                        value={edicao.nome}
                        disabled={leitura}
                        aria-invalid={Boolean(erros.nome)}
                        onChange={(e) => acoes.editar({ nome: e.target.value })}
                    />
                </Campo>
                <Campo id={`${id}_desc`} rotulo="Descrição" erro={erros.descricao}>
                    <textarea
                        id={`${id}_desc`}
                        rows={2}
                        className={cn(classe_campo, "resize-y")}
                        maxLength={tamanhos.descricao}
                        value={edicao.descricao}
                        disabled={leitura}
                        onChange={(e) => acoes.editar({ descricao: e.target.value })}
                    />
                </Campo>
                <SeletorPeriodo
                    id={id}
                    opcoes={opcoes}
                    ano={edicao.ano}
                    mes_inicio={edicao.mes_inicio}
                    mes_fim={edicao.mes_fim}
                    desabilitado={leitura}
                    erro={erros.periodo}
                    ao_mudar={(periodo) => acoes.editar(periodo)}
                />

                <div
                    role="group"
                    aria-label="Visão do painel"
                    className="flex items-center justify-between gap-2 border border-border p-2"
                >
                    <span className="flex items-center gap-2 text-200 text-muted-foreground">
                        <Eye className="icon-size-200" aria-hidden="true" />
                        KPIs, DRE e Sankey
                    </span>
                    <div className="flex">
                        {(["realizado", "simulado"] as const).map((modo) => (
                            <button
                                key={modo}
                                type="button"
                                aria-pressed={estado.modo === modo}
                                onClick={() => acoes.definir_modo(modo)}
                                className={cn(
                                    "border px-3 py-1 text-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                                    estado.modo === modo
                                        ? "border-transparent bg-foreground text-background"
                                        : "border-border text-muted-foreground hover:bg-accent",
                                )}
                            >
                                {modo === "realizado" ? "Realizado" : "Simulado"}
                            </button>
                        ))}
                    </div>
                </div>

                {erro_base ? (
                    <EstadoErro erro={erro_base} titulo="Não foi possível calcular a simulação" />
                ) : resultado_periodo ? (
                    <ImpactoAoVivo
                        resultado={resultado_periodo}
                        rotulo_periodo={periodo_simulacao(edicao, nome_mes)}
                    />
                ) : (
                    carregando_base && <EstadoCarregando className="h-32" rotulo="Lendo o realizado do período…" />
                )}

                {lista_premissas.map((definicao) => {
                    const premissa = edicao.premissas.find((p) => p.cod_premissa === definicao.cod_premissa);
                    if (!premissa) return null;
                    return (
                        <EditorPremissa
                            key={`${aberta.simulacao.id}_${definicao.cod_premissa}`}
                            premissa={premissa}
                            total_base={totais ? totais[definicao.cod_premissa] : null}
                            erro_valor={erros[chave_erro(definicao.cod_premissa, "valor")]}
                            erro_justificativa={erros[chave_erro(definicao.cod_premissa, "justificativa")]}
                            invalida={invalidas[definicao.cod_premissa]}
                            somente_leitura={leitura}
                            ao_mudar={(mudanca) => acoes.editar_premissa(definicao.cod_premissa, mudanca)}
                        />
                    );
                })}
            </div>
        );
    }

    const pode_salvar = Boolean(aberta && edicao && !estado.somente_leitura);

    return (
        <aside
            aria-label="Simulação"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-borda-forte bg-background sm:w-[460px]"
        >
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 pt-4 pb-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 font-heading text-400 font-semibold text-foreground">
                        <FlaskConical className="icon-size-300" aria-hidden="true" />
                        Simulação
                        {estado.modo === "simulado" && <SeloSimulado />}
                    </h2>
                    <p className="truncate text-200 text-muted-foreground" title={aberta?.simulacao.nome}>
                        {aberta ? aberta.simulacao.nome : "Premissas sobre o realizado, gravadas no banco do app"}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={ao_fechar}
                    aria-label="Fechar o painel de simulação"
                    className="p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <X className="icon-size-300" aria-hidden="true" />
                </button>
            </header>
            <Abas aba={aba} definir={definir_aba} tem_aberta={Boolean(aberta)} />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {estado.aviso && (
                    <div className="mb-4">
                        <Aviso
                            aviso={estado.aviso}
                            ao_fechar={acoes.limpar_aviso}
                            ao_recarregar={aberta ? () => acoes.abrir(aberta.simulacao.id) : undefined}
                        />
                    </div>
                )}
                {conteudo}
            </div>

            {aba === "premissas" && aberta && (
                <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                    {pode_salvar && (
                        <>
                            <BotaoAcao variante="primario" onClick={() => acoes.salvar("salvo")} disabled={ocupado}>
                                <Save className="icon-size-200" aria-hidden="true" />
                                {operacao === "salvando" ? "Salvando…" : "Salvar"}
                            </BotaoAcao>
                            <BotaoAcao onClick={() => acoes.salvar("rascunho")} disabled={ocupado}>
                                Salvar rascunho
                            </BotaoAcao>
                            {estado.nao_salvo && (
                                <BotaoAcao variante="fantasma" onClick={acoes.descartar} disabled={ocupado} title="Descartar alterações">
                                    <Undo2 className="icon-size-200" aria-hidden="true" />
                                    Descartar
                                </BotaoAcao>
                            )}
                        </>
                    )}
                    <div className="ml-auto flex gap-1">
                        <BotaoAcao
                            variante="fantasma"
                            onClick={() => acoes.duplicar(aberta.simulacao.id)}
                            disabled={ocupado}
                            aria-label="Duplicar"
                            title="Duplicar"
                        >
                            <Copy className="icon-size-200" aria-hidden="true" />
                        </BotaoAcao>
                        {estado.somente_leitura ? (
                            <BotaoAcao variante="fantasma" onClick={() => acoes.restaurar(aberta.simulacao.id)} disabled={ocupado}>
                                <ArchiveRestore className="icon-size-200" aria-hidden="true" />
                                Restaurar
                            </BotaoAcao>
                        ) : (
                            <BotaoAcao
                                variante="fantasma"
                                onClick={() => acoes.arquivar(aberta.simulacao.id)}
                                disabled={ocupado || estado.nao_salvo}
                                aria-label="Arquivar"
                                title={estado.nao_salvo ? "Salve ou descarte antes de arquivar" : "Arquivar"}
                            >
                                <Archive className="icon-size-200" aria-hidden="true" />
                            </BotaoAcao>
                        )}
                        <BotaoAcao
                            variante="fantasma"
                            onClick={() => {
                                if (confirmar_descarte()) acoes.fechar();
                            }}
                            disabled={ocupado}
                        >
                            Fechar simulação
                        </BotaoAcao>
                    </div>
                </footer>
            )}
        </aside>
    );
}
