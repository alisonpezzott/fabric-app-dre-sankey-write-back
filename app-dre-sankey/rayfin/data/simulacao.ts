// Simulação de premissas financeiras (write-back no SQL Database do app, nunca no modelo).
// Cada usuário lê, cria e altera só as próprias simulações; não há exclusão (arquivar).

import { authenticated, date, entity, int, set, text, uuid } from "@microsoft/rayfin-core";

@entity()
@authenticated(["create", "read", "update"], {
    policy: (claims, item) => claims.sub.eq(item.usuario_id),
})
export class simulacao {
    @uuid() id!: string;
    @text({ min: 1, max: 120 }) nome!: string;
    @text({ max: 1000, optional: true }) descricao?: string;
    @int({ min: 2000, max: 2100 }) ano!: number;
    @int({ min: 1, max: 12 }) mes_inicio!: number;
    @int({ min: 1, max: 12 }) mes_fim!: number;
    @set("rascunho", "salvo", "arquivado") status!: "rascunho" | "salvo" | "arquivado";
    /** claims.sub do dono (session.user.id); a policy compara com ele. */
    @text({ max: 200 }) usuario_id!: string;
    @text({ max: 320, optional: true }) email_usuario?: string;
    @date() criado_em!: Date;
    @date() alterado_em!: Date;
    /** Concorrência otimista: sobe 1 a cada gravação. */
    @int({ min: 1 }) versao!: number;
}
