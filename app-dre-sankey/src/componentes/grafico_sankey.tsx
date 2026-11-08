// Sankey da DRE: como a receita vira lucro (ou prejuízo) no recorte filtrado.
// Os valores dos links vêm prontos da medida sankey_valor; aqui só há layout e desenho.
// No modo Simulado, o mesmo componente recebe os links da cascata simulada e a
// comparação com o realizado: nós alterados ganham contorno tracejado e a dica mostra
// realizado → simulado (Δ, Δ%).
// Clicar num nó destaca os fluxos dele (os demais esmaecem) e abre a evolução mensal.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { sankeyLinkHorizontal, type SankeyLink } from "d3-sankey";

import { abreviar_moeda, formatar, formatos, percentual } from "@/dados/formatacao";
import {
    calcular_layout,
    type LinkLayout,
    type LinkSankeyEntrada,
    type NoLayout,
    type NoSankeyEntrada,
} from "@/dados/layout_sankey";
import { cn } from "@/lib/utils";
import { cor_por_tipo_no, opacidade_esmaecida, usePaletaGraficos } from "@/tema/tema_graficos";
import { EstadoErro, EstadoVazio, Esqueleto } from "./estados_carregamento";

const altura_padrao = 560;
const largura_minima = 1100;
const margem = { topo: 16, base: 16, esquerda: 4, direita: 196 };
const largura_no = 14;
const altura_rotulo = 30;

interface GraficoSankeyProps {
    nos: NoSankeyEntrada[] | undefined;
    links: LinkSankeyEntrada[] | undefined;
    carregando: boolean;
    erro: Error | undefined;
    /** muda a cada recorte para reiniciar a animação de entrada */
    chave_recorte: string;
    no_selecionado: string | null;
    ao_selecionar_no: (no: NoLayout) => void;
    /** em tela cheia, ocupa a altura do contêiner pai em vez da altura padrão */
    expandido?: boolean;
    /** Modo Simulado: valor realizado de cada nó (os links trazem `valor_realizado`). */
    comparacao?: { nos_realizado: Map<string, number> } | null;
}

interface Dica {
    x: number;
    y: number;
    titulo: string;
    linhas: [string, string][];
    prejuizo: boolean;
}

const gerador_faixa = sankeyLinkHorizontal();

function caminho(link: LinkLayout): string {
    return gerador_faixa(link as unknown as SankeyLink<object, object>) ?? "";
}

/** Posição vertical dos rótulos por coluna, empurrando para baixo os que se sobrepõem. */
function posicoes_rotulos(nos: NoLayout[]): Map<string, number> {
    const posicoes = new Map<string, number>();
    const por_coluna = new Map<number, NoLayout[]>();
    for (const no of nos) por_coluna.set(no.coluna, [...(por_coluna.get(no.coluna) ?? []), no]);
    for (const grupo of por_coluna.values()) {
        let limite = -Infinity;
        for (const no of [...grupo].sort((a, b) => a.y0 - b.y0)) {
            const centro = Math.max((no.y0 + no.y1) / 2 - altura_rotulo / 2, limite);
            posicoes.set(no.cod_no, centro);
            limite = centro + altura_rotulo;
        }
    }
    return posicoes;
}

export function GraficoSankey({
    nos,
    links,
    carregando,
    erro,
    chave_recorte,
    no_selecionado,
    ao_selecionar_no,
    expandido = false,
    comparacao = null,
}: GraficoSankeyProps) {
    const conteiner = useRef<HTMLDivElement>(null);
    const [tamanho_conteiner, definir_tamanho] = useState({ largura: largura_minima, altura: altura_padrao });
    const [destaque, definir_destaque] = useState<{ link?: string; no?: string } | null>(null);
    const [dica, definir_dica] = useState<Dica | null>(null);
    const paleta = usePaletaGraficos();
    const cor_no = (no: NoSankeyEntrada) => cor_por_tipo_no(paleta, no.tipo_no);

    useEffect(() => {
        const elemento = conteiner.current;
        if (!elemento) return;
        const observador = new ResizeObserver(([entrada]) =>
            definir_tamanho({ largura: entrada.contentRect.width, altura: Math.floor(entrada.contentRect.height) }),
        );
        observador.observe(elemento);
        return () => observador.disconnect();
    }, []);

    const largura = Math.max(tamanho_conteiner.largura, largura_minima);
    const altura_total = expandido ? Math.max(tamanho_conteiner.altura, altura_padrao) : altura_padrao;

    const layout = useMemo(() => {
        if (!nos || !links) return null;
        return calcular_layout(nos, links, {
            largura: largura - margem.esquerda - margem.direita,
            altura: altura_total - margem.topo - margem.base,
            largura_no,
            espaco_vertical: 14,
        });
    }, [nos, links, largura, altura_total]);

    const receita_liquida = layout?.nos.find((no) => no.cod_no === "receita_liquida")?.valor ?? null;
    const rotulos = useMemo(() => (layout ? posicoes_rotulos(layout.nos) : new Map<string, number>()), [layout]);

    function mostrar_dica(evento: MouseEvent, conteudo: Omit<Dica, "x" | "y">) {
        const caixa = conteiner.current?.getBoundingClientRect();
        if (!caixa || !conteiner.current) return;
        definir_dica({
            ...conteudo,
            x: evento.clientX - caixa.left + conteiner.current.scrollLeft,
            y: evento.clientY - caixa.top,
        });
    }

    function pct_receita(valor: number): string {
        return receita_liquida ? `${percentual(valor / receita_liquida)} da receita líquida` : "–";
    }

    /** Dica do modo Simulado: realizado → simulado, Δ e Δ%. */
    function linhas_simulacao(realizado: number, simulado: number): [string, string][] {
        const delta = simulado - realizado;
        return [
            ["Realizado", formatar(realizado, formatos.moeda)],
            ["Simulado", formatar(simulado, formatos.moeda)],
            ["Δ", formatar(delta, formatos.moeda)],
            ["Δ %", realizado !== 0 ? formatar(delta / Math.abs(realizado), formatos.variacao_pct) : "–"],
        ];
    }

    function alterado(no: NoLayout): boolean {
        if (!comparacao) return false;
        return Math.abs(no.valor - (comparacao.nos_realizado.get(no.cod_no) ?? 0)) > 0.005;
    }

    function linhas_variacao(valor_aa: number | null, var_pct: number | null): [string, string][] {
        if (valor_aa === null) return [["vs ano anterior", "sem base"]];
        return [
            ["Ano anterior", formatar(valor_aa, formatos.moeda)],
            ["Variação", formatar(var_pct, formatos.variacao_pct)],
        ];
    }

    // o hover tem prioridade; sem hover, vale o nó selecionado (destaque persistente)
    const foco = destaque ?? (no_selecionado ? { no: no_selecionado } : null);

    function ativo(link: LinkLayout): boolean {
        if (!foco) return false;
        if (foco.link) return foco.link === link.id;
        return link.source.cod_no === foco.no || link.target.cod_no === foco.no;
    }

    function no_em_foco(no: NoLayout): boolean {
        if (!foco) return true;
        if (foco.no === no.cod_no) return true;
        const ligados = foco.link
            ? layout?.links.filter((l) => l.id === foco.link)
            : layout?.links.filter((l) => l.source.cod_no === foco.no || l.target.cod_no === foco.no);
        return (ligados ?? []).some((l) => l.source.cod_no === no.cod_no || l.target.cod_no === no.cod_no);
    }

    function teclado_no(evento: KeyboardEvent, no: NoLayout) {
        if (evento.key === "Enter" || evento.key === " ") {
            evento.preventDefault();
            ao_selecionar_no(no);
        }
    }

    let conteudo: ReactNode;
    if (erro) {
        conteudo = <EstadoErro erro={erro} />;
    } else if (carregando && !layout) {
        conteudo = <Esqueleto className="h-full w-full" />;
    } else if (!layout || layout.links.length === 0) {
        conteudo = <EstadoVazio mensagem="Sem valores da DRE para este recorte." />;
    } else {
        conteudo = (
            <svg
                width={largura}
                height={altura_total}
                viewBox={`0 0 ${largura} ${altura_total}`}
                role="img"
                aria-label="Sankey da DRE: da receita bruta ao lucro líquido"
                className={cn("block transition-opacity duration-300 ease-out", carregando && "opacity-60")}
                onMouseLeave={() => {
                    definir_destaque(null);
                    definir_dica(null);
                }}
            >
                <defs>
                    {/* textura listrada: o prejuízo não depende só da cor para ser percebido */}
                    <pattern id="listras_prejuizo" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="8" height="8" fill={paleta.prejuizo} />
                        <rect width="3" height="8" fill={paleta.superficie} fillOpacity={0.45} />
                    </pattern>
                </defs>

                <g transform={`translate(${margem.esquerda},${margem.topo})`}>
                    <g key={chave_recorte}>
                        {layout.links.map((link) => {
                            const prejuizo = link.tipo_link === "prejuizo";
                            // cor do destino, sem gradiente (Carbon); 0,4 em repouso, 0,85 em foco
                            const opacidade = ativo(link) ? 0.85 : foco ? 0.12 : 0.4;
                            const titulo = `${link.source.nome_no} → ${link.target.nome_no}`;
                            const ao_entrar = (evento: MouseEvent) => {
                                definir_destaque({ link: link.id });
                                mostrar_dica(evento, {
                                    titulo,
                                    prejuizo,
                                    linhas: comparacao
                                        ? [
                                            ...linhas_simulacao(link.valor_realizado ?? 0, link.valor),
                                            ["Participação", pct_receita(link.valor)],
                                        ]
                                        : [
                                            ["Valor", formatar(link.valor, formatos.moeda)],
                                            ["Participação", pct_receita(link.valor)],
                                            ...linhas_variacao(link.valor_aa, link.var_aa_pct),
                                        ],
                                });
                            };
                            return (
                                <g key={link.id}>
                                    <path
                                        d={caminho(link)}
                                        pathLength={1}
                                        fill="none"
                                        stroke={prejuizo ? "url(#listras_prejuizo)" : cor_no(link.target)}
                                        strokeWidth={Math.max(1, link.width)}
                                        strokeOpacity={opacidade}
                                        className="sankey_link sankey_link_entrada"
                                        style={{ animationDelay: `${link.source.coluna * 70}ms` }}
                                        onMouseEnter={ao_entrar}
                                        onMouseMove={ao_entrar}
                                    >
                                        <title>{`${titulo}: ${abreviar_moeda(link.valor)}`}</title>
                                    </path>
                                </g>
                            );
                        })}
                    </g>

                    {layout.nos.map((no) => {
                        const cor = cor_no(no);
                        const selecionado = no_selecionado === no.cod_no;
                        const prejuizo = no.tipo_no === "prejuizo";
                        const y_rotulo = rotulos.get(no.cod_no) ?? no.y0;
                        const descricao = `${no.nome_no}: ${formatar(no.valor, formatos.moeda)}`;
                        const ao_entrar = (evento: MouseEvent) => {
                            definir_destaque({ no: no.cod_no });
                            const var_pct = no.valor_aa ? (no.valor - no.valor_aa) / Math.abs(no.valor_aa) : null;
                            mostrar_dica(evento, {
                                titulo: no.nome_no,
                                prejuizo,
                                linhas: comparacao
                                    ? [
                                        ...linhas_simulacao(comparacao.nos_realizado.get(no.cod_no) ?? 0, no.valor),
                                        ["Participação", pct_receita(no.valor)],
                                        ["", "clique para ver a evolução mensal (realizado)"],
                                    ]
                                    : [
                                        ["Valor", formatar(no.valor, formatos.moeda)],
                                        ["Participação", pct_receita(no.valor)],
                                        ...linhas_variacao(no.valor_aa, var_pct),
                                        ["", "clique para ver a evolução mensal"],
                                    ],
                            });
                        };
                        return (
                            <g
                                key={no.cod_no}
                                role="button"
                                tabIndex={0}
                                aria-label={`${descricao}. Abrir evolução mensal`}
                                aria-pressed={selecionado}
                                className="sankey_no cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-[var(--cor_foco)]"
                                opacity={no_em_foco(no) ? 1 : opacidade_esmaecida}
                                onClick={() => ao_selecionar_no(no)}
                                onKeyDown={(evento) => teclado_no(evento, no)}
                                onMouseEnter={ao_entrar}
                                onMouseMove={ao_entrar}
                            >
                                <rect
                                    x={no.x0}
                                    y={no.y0}
                                    width={no.x1 - no.x0}
                                    height={Math.max(1.5, no.y1 - no.y0)}
                                    fill={cor}
                                    stroke={selecionado || alterado(no) ? paleta.texto : "transparent"}
                                    strokeWidth={2}
                                    strokeDasharray={alterado(no) && !selecionado ? "4 3" : undefined}
                                />
                                <text
                                    x={no.x1 + 8}
                                    y={y_rotulo + 12}
                                    className="font-base"
                                    fontSize={12}
                                    fontWeight={selecionado ? 600 : 400}
                                    fill={prejuizo ? paleta.prejuizo_texto : paleta.texto}
                                    stroke={paleta.superficie}
                                    strokeWidth={3}
                                    paintOrder="stroke"
                                >
                                    {no.nome_no}
                                </text>
                                <text
                                    x={no.x1 + 8}
                                    y={y_rotulo + 26}
                                    className="numero"
                                    fontSize={11}
                                    fill={paleta.texto_suave}
                                    stroke={paleta.superficie}
                                    strokeWidth={3}
                                    paintOrder="stroke"
                                >
                                    {abreviar_moeda(no.valor)}
                                    {receita_liquida ? ` · ${percentual(no.valor / receita_liquida)}` : ""}
                                    {alterado(no) ? " · simulado" : ""}
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>
        );
    }

    return (
        <div
            ref={conteiner}
            className={cn("relative w-full overflow-x-auto overflow-y-hidden", expandido && "min-h-0 flex-1 overflow-y-auto")}
            style={expandido ? undefined : { height: altura_padrao }}
        >
            {conteudo}
            {dica && (
                <div
                    role="tooltip"
                    className={cn(
                        "pointer-events-none absolute z-20 min-w-56 border bg-popover p-3 text-200 shadow-28",
                        dica.prejuizo ? "border-prejuizo" : "border-input",
                    )}
                    style={{
                        left: Math.min(dica.x + 14, largura - 260),
                        top: Math.min(dica.y + 14, altura_total - 140),
                    }}
                >
                    <p className={cn("mb-1.5 font-semibold", dica.prejuizo ? "text-prejuizo-texto" : "text-foreground")}>
                        {dica.titulo}
                    </p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {dica.linhas.map(([rotulo, valor], i) =>
                            rotulo ? (
                                <div key={i} className="contents">
                                    <dt className="text-muted-foreground">{rotulo}</dt>
                                    <dd className="numero text-right text-foreground">{valor}</dd>
                                </div>
                            ) : (
                                <dd key={i} className="col-span-2 mt-1 text-texto-fraco">{valor}</dd>
                            ),
                        )}
                    </dl>
                </div>
            )}
        </div>
    );
}
