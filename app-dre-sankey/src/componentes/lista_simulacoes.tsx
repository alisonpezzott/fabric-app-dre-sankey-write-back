// Simulações salvas do usuário: filtro por status, abrir, duplicar, arquivar e restaurar.
// Sem exclusão. Mostra até 100 itens (uma página do Rayfin).

import { useState } from "react";
import { Archive, ArchiveRestore, Copy, FolderOpen, Plus, RefreshCw } from "lucide-react";

import { formatar, formatos } from "@/dados/formatacao";
import { cn } from "@/lib/utils";
import { limite_pagina, type Simulacao, type StatusSimulacao } from "@/simulacao/repositorio_simulacoes";
import { periodo_simulacao } from "@/simulacao/textos_simulacao";
import { BotaoAcao, SeloStatus } from "./controles_simulacao";
import { EstadoCarregando, EstadoVazio } from "./estados_carregamento";

type FiltroStatus = "ativas" | StatusSimulacao;

const filtros: { valor: FiltroStatus; rotulo: string }[] = [
    { valor: "ativas", rotulo: "Ativas" },
    { valor: "rascunho", rotulo: "Rascunho" },
    { valor: "salvo", rotulo: "Salvo" },
    { valor: "arquivado", rotulo: "Arquivado" },
];

interface ListaSimulacoesProps {
    lista: Simulacao[] | undefined;
    erro: string | null;
    id_aberta: string | null;
    ocupado: boolean;
    nome_mes: (mes: number) => string;
    ao_abrir: (id: string) => void;
    ao_duplicar: (id: string) => void;
    ao_arquivar: (id: string) => void;
    ao_restaurar: (id: string) => void;
    ao_nova: () => void;
    ao_recarregar: () => void;
}

export function ListaSimulacoes({
    lista,
    erro,
    id_aberta,
    ocupado,
    nome_mes,
    ao_abrir,
    ao_duplicar,
    ao_arquivar,
    ao_restaurar,
    ao_nova,
    ao_recarregar,
}: ListaSimulacoesProps) {
    const [filtro, definir_filtro] = useState<FiltroStatus>("ativas");
    const visiveis = (lista ?? []).filter((s) => (filtro === "ativas" ? s.status !== "arquivado" : s.status === filtro));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Filtrar por status" className="flex flex-wrap">
                    {filtros.map((f) => (
                        <button
                            key={f.valor}
                            type="button"
                            aria-pressed={filtro === f.valor}
                            onClick={() => definir_filtro(f.valor)}
                            className={cn(
                                "border px-2.5 py-1 text-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                                filtro === f.valor
                                    ? "border-transparent bg-foreground text-background"
                                    : "border-border text-muted-foreground hover:bg-accent",
                            )}
                        >
                            {f.rotulo}
                        </button>
                    ))}
                </div>
                <div className="flex gap-1">
                    <BotaoAcao variante="fantasma" onClick={ao_recarregar} aria-label="Recarregar lista" title="Recarregar">
                        <RefreshCw className="icon-size-200" aria-hidden="true" />
                    </BotaoAcao>
                    <BotaoAcao variante="primario" onClick={ao_nova} disabled={ocupado}>
                        <Plus className="icon-size-200" aria-hidden="true" />
                        Nova
                    </BotaoAcao>
                </div>
            </div>

            {erro ? (
                <p role="alert" className="border-l-4 border-prejuizo bg-muted p-3 text-200 text-foreground">{erro}</p>
            ) : !lista ? (
                <EstadoCarregando className="h-40" rotulo="Lendo as simulações…" />
            ) : visiveis.length === 0 ? (
                <EstadoVazio mensagem={lista.length === 0 ? "Nenhuma simulação ainda. Crie a primeira." : "Nenhuma simulação com este status."} />
            ) : (
                <ul className="flex flex-col gap-2">
                    {visiveis.map((s) => {
                        const aberta = s.id === id_aberta;
                        return (
                            <li key={s.id} className={cn("border p-3", aberta ? "border-interativo" : "border-border")}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-300 font-semibold text-foreground" title={s.nome}>{s.nome}</p>
                                        <p className="text-200 text-muted-foreground">
                                            {periodo_simulacao(s, nome_mes)} · alterada em{" "}
                                            <span className="numero">{formatar(s.alterado_em, formatos.data_hora)}</span>
                                        </p>
                                    </div>
                                    <SeloStatus status={s.status} />
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    <BotaoAcao variante="fantasma" onClick={() => ao_abrir(s.id)} disabled={ocupado || aberta}>
                                        <FolderOpen className="icon-size-200" aria-hidden="true" />
                                        {aberta ? "Aberta" : "Abrir"}
                                    </BotaoAcao>
                                    <BotaoAcao variante="fantasma" onClick={() => ao_duplicar(s.id)} disabled={ocupado}>
                                        <Copy className="icon-size-200" aria-hidden="true" />
                                        Duplicar
                                    </BotaoAcao>
                                    {s.status === "arquivado" ? (
                                        <BotaoAcao variante="fantasma" onClick={() => ao_restaurar(s.id)} disabled={ocupado}>
                                            <ArchiveRestore className="icon-size-200" aria-hidden="true" />
                                            Restaurar
                                        </BotaoAcao>
                                    ) : (
                                        <BotaoAcao variante="fantasma" onClick={() => ao_arquivar(s.id)} disabled={ocupado}>
                                            <Archive className="icon-size-200" aria-hidden="true" />
                                            Arquivar
                                        </BotaoAcao>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            {lista && lista.length >= limite_pagina && (
                <p className="text-200 text-texto-fraco">Mostrando as {limite_pagina} simulações alteradas mais recentemente.</p>
            )}
        </div>
    );
}
