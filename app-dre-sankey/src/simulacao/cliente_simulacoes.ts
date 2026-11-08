// Liga o repositório ao `client.data` do Rayfin (GraphQL gerado, Fabric SSO). O singleton
// getRayfinClient() do template continua sem tipo de schema (é o do login); só o acesso a
// `data` é tipado aqui. As entidades entram só como tipo: o Vite (plugin-react-swc) não
// compila decoradores TC39.

import type { RayfinClient } from "@microsoft/rayfin-client";
import type { OpaqueSession } from "@microsoft/rayfin-auth";

import { getRayfinClient } from "@/lib/rayfin-client";
import type { DreSankeySchema } from "../../rayfin/data/schema";
import { RepositorioSimulacoes, type ClienteDadosSimulacao, type EntidadeDados } from "./repositorio_simulacoes";

type DadosTipados = RayfinClient<DreSankeySchema>["data"];

function dados_tipados(): DadosTipados {
    return (getRayfinClient() as unknown as RayfinClient<DreSankeySchema>).data;
}

/**
 * Adaptador: a API fluente do Rayfin tipa campos e filtros por entidade; o repositório
 * usa a forma genérica (a mesma do cliente falso dos testes).
 */
export function cliente_dados_simulacao(): ClienteDadosSimulacao {
    const dados = dados_tipados();
    return {
        simulacao: dados.simulacao as unknown as EntidadeDados,
        premissa_simulacao: dados.premissa_simulacao as unknown as EntidadeDados,
        auditoria_simulacao: dados.auditoria_simulacao as unknown as EntidadeDados,
    };
}

/** Repositório do usuário autenticado (session.user.id = claims.sub das policies). */
export function repositorio_da_sessao(session: OpaqueSession | null): RepositorioSimulacoes | null {
    const usuario = session?.isAuthenticated ? session.user : null;
    if (!usuario?.id) return null;
    return new RepositorioSimulacoes(cliente_dados_simulacao(), { id: usuario.id, email: usuario.email ?? "" });
}
