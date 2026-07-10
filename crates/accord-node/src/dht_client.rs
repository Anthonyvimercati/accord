//! Client RPC Kademlia sur le transport chiffré.
//!
//! Implémente [`DhtRpc`] au-dessus de l'[`Endpoint`] : chaque RPC sortant
//! porte un `rpc_id` aléatoire de 160 bits ; la réponse entrante portant le
//! même identifiant réveille l'app