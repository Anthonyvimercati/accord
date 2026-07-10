//! Abstraction de socket datagramme : implémentation UDP réelle et mesh
//! simulé en mémoire (perte, latence, churn) pour les tests d'intégration.

use async_trait::async_trait;
use std::io;
use std::net::SocketAddr;

/// Socket datagramme minimal utilisé par l'endpoint transport.
///
/// L'abstraction permet de faire tourner le protocole complet soit sur UDP,
/// soit sur un réseau simulé déterministe (SPEC §13 tests d'intégration).
#[async_trait]
pub trait DatagramSocket: Send + Sync + 'static {
    /// Envoie un datagramme à `dst`. Peut être silencieusement perdu (UDP).
    async fn send_to(&self, buf: &[u8], dst: SocketAddr) -> io::Result<usize>;

    /// Reçoit le prochain datagramme, rendant la source.
    async fn recv_from(&self) -> io::Result<(Vec<u8>, SocketAddr)>;

    /// Adresse locale liée.
    fn local_addr(&self) -> SocketAddr;
}

/// Implémentation UDP réelle sur `tokio::net::UdpSocket`.
pub struct UdpDatagram {
    inner: tokio::net::UdpSocket,
    local: SocketAddr,
}

impl UdpDatagram {
    /// Lie un socket UDP sur `bind` (ex. `0.0.0.0:0` pour un port éphémère).
    pub async fn bind(bind: SocketAddr) -> io::Result<Self> {
        let inner = tokio::net::UdpSocket::bind(bind).await?;
        let local = inner.local_addr()?;
        Ok(Self { inner, local })
    }

    /// Lie un socket UDP avec réutilisation d'adresse et de port
    /// (`SO_REUSEADDR`, plus `SO_REUSEPORT` sur Unix), prérequis du hole
    /// punching UDP (SPEC §11) : plusieurs tentatives de session et l'écoute
    /// principale peuvent alors partager le **même** port local éphémère,
    /// indispensable au simultaneous-open à travers un NAT.
    ///
    /// `SO_REUSEPORT` n'existe pas sur Windows : on se rabat sur le seul
    /// `SO_REUSEADDR`, suffisant pour relier plusieurs sockets au même port.
    pub fn bind_reuse(bind: SocketAddr) -> io::Result<Self> {
        use socket2::{Domain, Protocol, Socket, Type};

        let domain = if bind.is_ipv4() {
            Domain::IPV4
        } else {
            Domain::IPV6
        };
        let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))?;
        socket.set_reuse_address(true)?;
        #[cfg(unix)]
        socket.set_reuse_port(true)?;
        socket.set_nonblocking(true)?;
        socket.bind(&bind.into())?;
        // `from_std` exige un socket non bloquant déjà configuré (ci-dessus).
        let std_sock: std::net::UdpSocket = socket.into();
        let inner = tokio::net::UdpSocket::from_std(std_sock)?;
        let local = inner.local_addr()?;
        Ok(Self { inner, local })
    }
}

#[async_trait]
impl DatagramSocket for UdpDatagram {
    async fn send_to(&self, buf: &[u8], dst: SocketAddr) -> io::Result<usize> {
        self.inner.send_to(buf, dst).await
    }

    async fn recv_from(&self) -> io::Result<(Vec<u8>, SocketAddr)> {
        // MTU applicative + marge (SPEC §13 : 1200 o UDP).
        let mut buf = vec![0u8; 2048];
        let (n, from) = self.inner.recv_from(&mut buf).await?;
        buf.truncate(n);
        Ok((buf, from))
    }

    fn local_addr(&self) -> SocketAddr {
        self.local
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bind_reuse_partage_le_meme_port() {
        // Premier socket sur un port éphémère, avec réutilisation.
        let a = UdpDatagram::bind_reuse("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = a.local_addr().port();

        // Un second socket peut se lier au MÊME port (prérequis du hole
        // punching : écoute et tentatives partagent le port éphémère).
        // SO_REUSEPORT est requis côté Unix ; sur Windows SO_REUSEADDR suffit.
        #[cfg(unix)]
        {
            let bind: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
            let b = UdpDatagram::bind_reuse(bind).unwrap();
            assert_eq!(b.local_addr().port(), port);
        }
        #[cfg(not(unix))]
        {
            let _ = port;
        }
    }

    #[tokio::test]
    async fn bind_reuse_transmet_un_datagramme() {
        // Deux sockets réutilisables distincts s'échangent un datagramme :
        // vérifie que le socket socket2 → tokio reste pleinement fonctionnel.
        let a = UdpDatagram::bind_reuse("127.0.0.1:0".parse().unwrap()).unwrap();
        let b = UdpDatagram::bind_reuse("127.0.0.1:0".parse().unwrap()).unwrap();
        a.send_to(b"ping", b.local_addr()).await.unwrap();
        let (buf, from) = b.recv_from().await.unwrap();
        assert_eq!(&buf, b"ping");
        assert_eq!(from, a.local_addr());
    }
}

pub mod sim {
    //! Mesh UDP simulé, déterministe et paramétrable.

    use super::*;
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::sync::mpsc;
    use tokio::sync::Mutex as AsyncMutex;

    /// Paramètres réseau injectés (perte, latence).
    #[derive(Debug, Clone, Copy)]
    pub struct NetConditions {
        /// Probabilité de perte d'un datagramme [0.0, 1.0].
        pub loss: f64,
        /// Latence minimale ajoutée (ms).
        pub latency_min_ms: u64,
        /// Latence maximale ajoutée (ms).
        pub latency_max_ms: u64,
    }

    impl Default for NetConditions {
        fn default() -> Self {
            Self {
                loss: 0.0,
                latency_min_ms: 0,
                latency_max_ms: 0,
            }
        }
    }

    /// Datagramme livré à un socket simulé : `(charge, source)`.
    type Datagram = (Vec<u8>, SocketAddr);
    type Inbox = mpsc::UnboundedSender<Datagram>;

    #[derive(Default)]
    struct Fabric {
        inboxes: HashMap<SocketAddr, Inbox>,
        conditions: HashMap<SocketAddr, NetConditions>,
        down: HashMap<SocketAddr, bool>,
    }

    /// Réseau simulé partagé entre plusieurs [`SimSocket`].
    #[derive(Clone)]
    pub struct SimNet {
        fabric: Arc<Mutex<Fabric>>,
        rng: Arc<Mutex<StdRng>>,
        default_conditions: NetConditions,
    }

    impl SimNet {
        /// Crée un réseau simulé déterministe à partir d'une graine.
        pub fn new(seed: u64, conditions: NetConditions) -> Self {
            Self {
                fabric: Arc::new(Mutex::new(Fabric::default())),
                rng: Arc::new(Mutex::new(StdRng::seed_from_u64(seed))),
                default_conditions: conditions,
            }
        }

        /// Enregistre un nœud à `addr` et rend son socket.
        pub fn bind(&self, addr: SocketAddr) -> SimSocket {
            let (tx, rx) = mpsc::unbounded_channel();
            let mut f = self.fabric.lock().expect("fabric mutex");
            f.inboxes.insert(addr, tx);
            f.conditions.insert(addr, self.default_conditions);
            f.down.insert(addr, false);
            SimSocket {
                net: self.clone(),
                local: addr,
                rx: Arc::new(AsyncMutex::new(rx)),
            }
        }

        /// Simule une coupure réseau d'un nœud (churn).
        pub fn set_down(&self, addr: SocketAddr, down: bool) {
            let mut f = self.fabric.lock().expect("fabric mutex");
            f.down.insert(addr, down);
        }

        /// Ajuste les conditions réseau d'un nœud spécifique.
        pub fn set_conditions(&self, addr: SocketAddr, c: NetConditions) {
            let mut f = self.fabric.lock().expect("fabric mutex");
            f.conditions.insert(addr, c);
        }

        fn deliver(&self, from: SocketAddr, to: SocketAddr, buf: Vec<u8>) {
            let (inbox, delay) = {
                let f = self.fabric.lock().expect("fabric mutex");
                if *f.down.get(&from).unwrap_or(&false) || *f.down.get(&to).unwrap_or(&false) {
                    return;
                }
                let cond = f.conditions.get(&to).copied().unwrap_or_default();
                let mut rng = self.rng.lock().expect("rng mutex");
                if rng.gen::<f64>() < cond.loss {
                    return; // datagramme perdu
                }
                let delay = if cond.latency_max_ms > cond.latency_min_ms {
                    rng.gen_range(cond.latency_min_ms..=cond.latency_max_ms)
                } else {
                    cond.latency_min_ms
                };
                match f.inboxes.get(&to) {
                    Some(tx) => (tx.clone(), delay),
                    None => return,
                }
            };
            if delay == 0 {
                let _ = inbox.send((buf, from));
            } else {
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    let _ = inbox.send((buf, from));
                });
            }
        }
    }

    /// Socket rattaché à un [`SimNet`].
    pub struct SimSocket {
        net: SimNet,
        local: SocketAddr,
        rx: Arc<AsyncMutex<mpsc::UnboundedReceiver<Datagram>>>,
    }

    #[async_trait]
    impl DatagramSocket for SimSocket {
        async fn send_to(&self, buf: &[u8], dst: SocketAddr) -> io::Result<usize> {
            let n = buf.len();
            self.net.deliver(self.local, dst, buf.to_vec());
            Ok(n)
        }

        async fn recv_from(&self) -> io::Result<(Vec<u8>, SocketAddr)> {
            let mut rx = self.rx.lock().await;
            rx.recv()
                .await
                .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "sim closed"))
        }

        fn local_addr(&self) -> SocketAddr {
            self.local
        }
    }
}
