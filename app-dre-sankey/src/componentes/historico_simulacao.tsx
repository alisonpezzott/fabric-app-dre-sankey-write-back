// Histórico (auditoria) da simulação aberta: ação, quando, quem e o que mudou.

import { formatar, formatos } from "@/dados/formatacao";
import { limite_pagina, type AcaoAuditoria, type RegistroAuditoria } from "@/simulacao/repositorio_simulacoes";
import { detalhe_auditoria } from "@/simulacao/textos_simulacao";
import { EstadoCarregando, EstadoVazio } from "./estados_carregamento";

const rotulos_acao: Record<AcaoAuditoria, string> = {
    criar: "Criou a simulação",
    alterar_premissa: "Alterou premissa",
    salvar: "Salvou",
    duplicar: "Duplicou de outra simulação",
    arquivar: "Arquivou",
    restaurar: "Restaurou",
};

export function HistoricoSimulacao({ historico, erro }: { historico: RegistroAuditoria[] | undefined; erro: string | null }) {
    if (erro) return <p role="alert" className="border-l-4 border-prejuizo bg-muted p-3 text-200 text-foreground">{erro}</p>;
    if (!historico) return <EstadoCarregando className="h-40" rotulo="Lendo o histórico…" />;
    if (historico.length === 0) return <EstadoVazio mensagem="Sem registros de auditoria." />;
    return (
        <div className="flex flex-col gap-2">
            <ol className="flex flex-col">
                {historico.map((registro) => {
                    const detalhe = detalhe_auditoria(registro);
                    return (
                        <li key={registro.id} className="border-l-2 border-border py-2 pl-3">
                            <p className="text-300 text-foreground">{rotulos_acao[registro.acao] ?? registro.acao}</p>
                            {detalhe && <p className="break-words text-200 text-muted-foreground">{detalhe}</p>}
                            <p className="text-200 text-texto-fraco">
                                <span className="numero">{formatar(registro.alterado_em, formatos.data_hora)}</span>
                                {registro.email_usuario ? ` · ${registro.email_usuario}` : ""}
                            </p>
                        </li>
                    );
                })}
            </ol>
            <p className="text-200 text-texto-fraco">
                Trilha só de inclusão: o banco não permite alterar nem apagar registros.
                {historico.length >= limite_pagina ? ` Mostrando os ${limite_pagina} mais recentes.` : ""}
            </p>
        </div>
    );
}
