/** Instances partagées du client RPC et de l'API (une connexion par app). */

import { Api } from './api';
import { RpcClient } from './rpc';

export const rpc = new RpcClient();
export const api = new Api(rpc);
