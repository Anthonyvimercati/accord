//! Token bucket par IP source pour l'anti-abus (SPEC §4, §2.5).

use std::collections::HashMap;
use std::net::IpAddr;

/// Seau à jetons : capacité (rafale) + débit de recharge par seconde.
#[derive(Debug, Clone, Copy)]
pub struct Bucket {
    tokens: f64,
    capacity: f64,
    refill_per_s: f64,
    last_ms: u64,
}

impl Bucket {
    /// Crée un seau plein.
    pub fn new(capacity: f64, refill_per_s: f64, now_ms: u64) -> Self {
        Self {
            tokens: capacity,
            capacity,
            refill_per_s,
            last_ms: now_ms,
        }
    }

    /// Tente de consommer un jeton ; recharge selon le temps écoulé.
    pub fn try_take(&mut self, now_ms: u64) -> bool {
        self.try_take_n(1.0, now_ms)
    }

    /// Tente de consommer `n` jetons (RPC coûteux plus chers).
    pub fn try_take_n(&mut self, n: f64, now_ms: u64) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_ms) as f64 / 1000.0;
        self.tokens = (self.tokens + elapsed * self.refill_per_s).min(self.capacity);
        self.last_ms = now_ms;
        if self.tokens >= n {
            self.tokens -= n;
            true
        } else {
            false
        }
    }
}

/// Ensemble de seaux indexés par IP source, avec purge des inactifs.
pub struct RateLimiter {
    buckets: HashMap<IpAddr, Bucket>,
    capacity: f64,
    refill_per_s: f64,
    last_gc_ms: u64,
}

impl RateLimiter {
    /// Crée un limiteur avec capacité de rafale et débit de recharge donnés.
    pub fn new(capacity: f64, refill_per_s: f64) -> Self {
        Self {
            buckets: HashMap::new(),
            capacity,
            refill_per_s,
            last_gc_ms: 0,
        }
    }

    /// Autorise (ou non) une action de coût `cost` pour l'IP `ip`.
    pub fn check(&mut self, ip: IpAddr, cost: f64, now_ms: u64) -> bool {
        // Purge périodique des seaux pleins et inactifs > 5 min.
        if now_ms.saturating_sub(self.last_gc_ms) > 60_000 {
            self.buckets
                .retain(|_, b| now_ms.saturating_sub(b.last_ms) < 300_000);
            self.last_gc_ms = now_ms;
        }
        let cap = self.capacity;
        let refill = self.refill_per_s;
        let bucket = self
            .buckets
            .entry(ip)
            .or_insert_with(|| Bucket::new(cap, refill, now_ms));
        bucket.try_take_n(cost, now_ms)
    }

    /// Nombre de seaux suivis (observabilité).
    pub fn tracked(&self) -> usize {
        self.buckets.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, n))
    }

    #[test]
    fn burst_then_throttle() {
        let mut rl = RateLimiter::new(4.0, 10.0);
        // 4 en rafale immédiate.
        for _ in 0..4 {
            assert!(rl.check(ip(1), 1.0, 0));
        }
        assert!(!rl.check(ip(1), 1.0, 0));
        // Après 100 ms, 1 jeton rechargé (10/s).
        assert!(rl.check(ip(1), 1.0, 100));
        assert!(!rl.check(ip(1), 1.0, 100));
    }

    #[test]
    fn per_ip_isolation() {
        let mut rl = RateLimiter::new(2.0, 1.0);
        assert!(rl.check(ip(1), 2.0, 0));
        assert!(!rl.check(ip(1), 1.0, 0));
        // Une autre IP a son propre seau.
        assert!(rl.check(ip(2), 2.0, 0));
    }

    #[test]
    fn expensive_rpc_costs_more() {
        let mut rl = RateLimiter::new(8.0, 1.0);
        // Un STORE coûte 4.
        assert!(rl.check(ip(1), 4.0, 0));
        assert!(rl.check(ip(1), 4.0, 0));
        assert!(!rl.check(ip(1), 4.0, 0));
    }

    #[test]
    fn refill_caps_at_capacity() {
        let mut rl = RateLimiter::new(4.0, 10.0);
        assert!(rl.check(ip(1), 4.0, 0));
        // Longue attente : le seau ne dépasse pas la capacité.
        assert!(rl.check(ip(1), 4.0, 10_000));
        assert!(!rl.check(ip(1), 1.0, 10_000));
    }
}
