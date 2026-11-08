// Registro das entidades do SQL Database do app. O front importa só os tipos
// (`import type`): o plugin-react-swc do Vite não compila decoradores TC39.

import { auditoria_simulacao } from "./auditoria_simulacao.js";
import { premissa_simulacao } from "./premissa_simulacao.js";
import { simulacao } from "./simulacao.js";

export type DreSankeySchema = {
    simulacao: simulacao;
    premissa_simulacao: premissa_simulacao;
    auditoria_simulacao: auditoria_simulacao;
};

export const schema = [simulacao, premissa_simulacao, auditoria_simulacao];
