// Cartão de KPI: valor, variação contra o ano anterior (▲ verde / ▼ laranja)
// e sparkline dos últimos 12 meses do recorte. No modo Simulado, o valor é o simulado,
// a variação é contra o realizado e o cartão ganha o selo e o contorno tracejado.

import { area, curveMonotoneX, line } from "d3-shape";
import { scaleLinear } from "d3-scale";

import { formatar, type Formato } from "@/dados/formatacao";
import { cn } from "@/lib/utils";
import { usePaletaGraficos } from "@/tema/tema_graficos";
import { Esqueleto } from "./estados_carregamento";

export interface CartaoKpiProps {
    titulo: string;
    valor: number | null;
    formato: Formato;
    variacao: number | null;
    formato_variacao: Formato;
    rotulo_variacao: string;
    serie: (number | null)[];
    cor: string;
    carregando: boolean;
    prejuizo?: boolean;
    /** Modo Simulado: mostra o selo e contorno tracejado (a diferença não depende só da cor). */
    simulado?: boolean;
    /** Linha de apoio abaixo da variação (ex.: "Realizado R$ 1,2 mi"). */
    detalhe?: string;
}

function Sparkline({ serie, cor }: { serie: (number | null)[]; cor: string }) {
    const paleta = usePaletaGraficos();
    const pontos = serie.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
    if (pontos.length < 2) return <div className="h-10" />;

    const largura = 120;
    const altura = 36;
    const valores = pontos.map(([, v]) => v);
    const x = scaleLinear().domain([0, serie.length - 1]).range([2, largura - 2]);
    const y = scaleLinear()
        .domain([Math.min(0, ...valores), Math.max(0, ...valores)])
        .range([altura - 2, 2]);
    const caminho_linha = line<readonly [number, number]>()
        .x(([i]) => x(i))
        .y(([, v]) => y(v))
        .curve(curveMonotoneX)(pontos);
    const caminho_area = area<readonly [number, number]>()
        .x(([i]) => x(i))
        .y0(y(0))
        .y1(([, v]) => y(v))
        .curve(curveMonotoneX)(pontos);
    const negativos = pontos.filter(([, v]) => v < 0);

    return (
        <svg viewBox={`0 0 ${largura} ${altura}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
            {caminho_area && <path d={caminho_area} fill={cor} fillOpacity={0.12} />}
            {caminho_linha && (
                <path d={caminho_linha} fill="none" stroke={cor} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
            {negativos.map(([i, v]) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={paleta.prejuizo} />
            ))}
        </svg>
    );
}

export function CartaoKpi({
    titulo,
    valor,
    formato,
    variacao,
    formato_variacao,
    rotulo_variacao,
    serie,
    cor,
    carregando,
    prejuizo = false,
    simulado = false,
    detalhe,
}: CartaoKpiProps) {
    const alta = variacao !== null && variacao > 0;
    const queda = variacao !== null && variacao < 0;

    return (
        <article
            className={cn(
                "cartao flex min-w-0 flex-col gap-2 p-4",
                simulado && "border-dashed border-interativo",
                prejuizo && "border-prejuizo",
            )}
            aria-busy={carregando}
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="truncate text-200 text-muted-foreground">{titulo}</h3>
                <span className="flex shrink-0 items-center gap-1">
                    {simulado && (
                        <span className="rounded-full border border-dashed border-interativo px-2 py-0.5 text-100 text-interativo">
                            Simulado
                        </span>
                    )}
                    {prejuizo && (
                        <span className="rounded-full bg-prejuizo px-2 py-0.5 text-100 text-texto-inverso">
                            Prejuízo
                        </span>
                    )}
                </span>
            </header>

            {carregando ? (
                <>
                    <Esqueleto className="h-8 w-3/4" />
                    <Esqueleto className="h-4 w-1/2" />
                    <Esqueleto className="h-10 w-full" />
                </>
            ) : (
                <>
                    <p
                        className={cn(
                            "truncate font-heading text-hero-700 leading-hero-700 font-light tabular-nums",
                            prejuizo ? "text-prejuizo-texto" : "text-foreground",
                        )}
                        title={formatar(valor, formato)}
                    >
                        {formatar(valor, formato)}
                    </p>
                    <p className="flex flex-wrap items-baseline gap-x-1.5 text-300">
                        {variacao === null ? (
                            <span className="text-texto-fraco">sem base de comparação</span>
                        ) : (
                            <>
                                <span
                                    className={cn("numero", alta && "text-lucro", queda && "text-custo")}
                                >
                                    {alta ? "▲" : queda ? "▼" : "■"} {formatar(variacao, formato_variacao)}
                                </span>
                                <span className="text-200 text-muted-foreground">{rotulo_variacao}</span>
                            </>
                        )}
                    </p>
                    {detalhe && <p className="numero truncate text-200 text-texto-fraco" title={detalhe}>{detalhe}</p>}
                    <Sparkline serie={serie} cor={cor} />
                </>
            )}
        </article>
    );
}
