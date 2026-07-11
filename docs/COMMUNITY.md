# Suite communautaire : événements, stickers, avatar de serveur, bannière

Contrat API (JSON-RPC + événements WebSocket) de la suite communautaire
introduite par D-047. Tout est **additif** : aucun contrat existant
(`groups.*`) n'est modifié dans son comportement historique, seulement
étendu — un client qui n'utilise aucun des champs/méthodes ci-dessous
continue de fonctionner à l'identique.

Les identifiants (`group_id`, `channel_id`, `event_id`, `role_id`, …)
transitent en **hexadécimal minuscule** (32 caractères pour 16 octets, 64
pour une clé publique), comme partout ailleurs dans l'API. Toutes les
opérations sont répliquées via le même mécanisme d'op-log signé que le reste
de `groups.*` (SPEC §6.2) : permissions vérifiées **à l'émission et au
rejeu**, quotas appliqués de façon déterministe (même résultat chez tous les
pairs honnêtes, indépendamment de l'ordre d'arrivée des ops).

Nouveaux discriminants d'op de groupe (`GroupOpBody`, prochain libre après
0x1F) :

| Opcode | Op | Permission |
|---|---|---|
| `0x20` | `EventCreate` | `MANAGE_CHANNELS` |
| `0x21` | `EventEdit` | `MANAGE_CHANNELS` ou auteur de l'événement |
| `0x22` | `EventDelete` | `MANAGE_CHANNELS` ou auteur de l'événement |
| `0x23` | `EventRsvp` | tout membre (sur son propre RSVP) |
| `0x24` | `StickerAdd` | `MANAGE_EMOJIS` |
| `0x25` | `StickerRemove` | `MANAGE_EMOJIS` |
| `0x26` | `SetMemberAvatar` | self-service uniquement (auteur = cible, aucun modérateur) |
| `0x27` | `PollVote` | tout membre (sur son propre vote) |
| `0x28` | `PollClose` | `MANAGE_CHANNELS` ou auteur du sondage |
| `0x29` | `PollCreate` | `VIEW`+`SEND` effectifs dans `channel_id` (comme envoyer un message — **pas** la simple appartenance) |
| `0x2A` | `PollDelete` | `MANAGE_CHANNELS` ou auteur du sondage |

Aucun nouveau bit de permission n'a été introduit : les événements et
l'édition de la bannière réutilisent `MANAGE_CHANNELS` (même famille que
`SetMeta`/salons/catégories), les stickers réutilisent `MANAGE_EMOJIS` (même
famille que les émojis de serveur). L'avatar de serveur ne dépend d'aucune
permission — il est strictement self-service, comme un pseudo qu'on se
fixerait à soi-même sans jamais pouvoir agir sur celui d'autrui.

`GroupOpBody::SetMeta` (0x02, inchangée dans son usage historique — nom +
icône) gagne un champ **additif** de fin de variant : `banner_color:
Option<u32>`. Un ancien pair qui ne le connaît pas ne l'écrit simplement pas
et le décode à `None` (rétrocompatibilité filaire, `Reader::opt_tail` —
même schéma que `CoreMsg::Profile.pronouns/accent_color/banner_color`).

`MsgBody` (corps de message de salon, `accord-proto`) gagne un nouveau
discriminant : `Sticker { name, merkle_root }`, **kind = 4** (jamais utilisé
jusqu'ici, entre `Reaction` = 3 et `Typing` = 5). Un pair qui ne connaît pas
ce discriminant échoue à décoder ce message précis (comportement identique à
tout autre corps futur non reconnu) sans affecter le reste du salon ni l'état
répliqué du groupe.

`MsgBody` gagne un second nouveau discriminant (D-048) : `Poll { poll_id,
question, options }`, **kind = 7** (prochain libre après `ReadReceipt` = 6).
Même dégradation gracieuse qu'un `Sticker` non reconnu chez un pair plus
ancien.

**Durcissement post-revue (D-048, avant tout déploiement)** : `PollCreate`
(0x29) portait initialement le seul `poll_id` et n'était gated que sur la
simple appartenance au groupe — deux failles corrigées avant que l'op ne
soit jamais répliquée en production :

- `PollCreate` gagne deux champs : `channel_id: [u8; 16]` (le salon où le
  message `MsgBody::Poll` associé est posté) et `msg_id: [u8; 16]` (le
  message canonique auquel `poll_id` est lié). Le repli exige désormais
  `VIEW`+`SEND` effectifs de l'auteur dans `channel_id` — exactement la même
  porte qu'un envoi de message ordinaire
  (`GroupState::can_send_message`/`accord_core::group::msg::require_send`) —
  au lieu de la simple appartenance : sans ce correctif, n'importe quel
  membre pouvait squatter les 25 emplacements de `MAX_POLLS` via un salon où
  il n'avait même pas le droit d'écrire, DoS permanent sur les sondages du
  reste du groupe.
- `msg_id` lie `poll_id` à un unique message canonique : à l'ingestion d'un
  `MsgBody::Poll`, si l'op-log local connaît déjà ce `poll_id` (un
  `PollCreate` a été replié), seul le message qui correspond exactement à
  cet auteur ET ce `msg_id` est stocké — un pair qui rejoue ce `poll_id`
  avec un autre auteur ou un autre `msg_id` (question/options forgées) ne
  crée ni un second sondage visible, ni ne « rehéberge » le dépouillement
  existant sur son propre contenu.
- Nouvel op `PollDelete` (0x2A, voir le tableau ci-dessus) : mirrors
  `EventDelete` exactement (auteur ou `MANAGE_CHANNELS`), c'est le seul
  moyen de récupérer un emplacement `MAX_POLLS` une fois un sondage créé.
  Exposé via `groups.polls.delete` (§6.1).
- Ordre d'émission côté nœud (`Node::group_send_poll`) inversé : `poll_id`/
  `msg_id` sont générés d'abord, puis `PollCreate` est authored et confirmé
  **avant** toute composition/diffusion du message — si l'op est refusée
  (plafond atteint, droit d'écriture refusé), rien n'est composé ni envoyé,
  au lieu d'un message posté référençant un sondage jamais connu de l'op-log.

---

## 1. Événements planifiés (`groups.events.*`)

Un événement planifié (`title`, `description`, `start_ms`, `channel_id`
optionnel, `author`, ensemble de RSVP) vit dans l'état matérialisé du groupe,
au même titre que les salons ou les rôles — répliqué par l'op-log, jamais de
stockage séparé.

### 1.1 Méthodes RPC

| Méthode | Paramètres | Résultat | Erreurs notables |
|---|---|---|---|
| `groups.events.create` | `{ group_id, title, description?, start_ms, channel_id? }` | `{ event_id: hex16 }` | `INVALID_PARAMS` (titre/description hors bornes) ; `APP_ERROR` « refusé : … » (permission, salon vocal inconnu, date hors bornes, plafond atteint) |
| `groups.events.edit` | `{ group_id, event_id, title, description?, start_ms, channel_id? }` | `{ ok: true }` | idem création ; `APP_ERROR` « refusé : événement inconnu » |
| `groups.events.delete` | `{ group_id, event_id }` | `{ ok: true }` | `APP_ERROR` « refusé : … » (ni auteur ni `MANAGE_CHANNELS`, événement inconnu) |
| `groups.events.rsvp` | `{ group_id, event_id, interested? }` | `{ ok: true }` | `APP_ERROR` « refusé : événement inconnu » |

- `description` absente ⇒ chaîne vide.
- `start_ms` est une échéance murale absolue (ms), **pas** une durée.
- `channel_id`, s'il est fourni (chaîne hex ou `null` explicite = absent),
  doit référencer un salon **vocal** existant du groupe ; toute autre valeur
  est refusée (aucun salon textuel/annonces comme lieu d'événement).
- `interested` par défaut `true` (RSVP « je suis intéressé·e » en un appel) ;
  `false` retire le RSVP local. Dédoublonné par `(event_id, membre)` — un
  second RSVP du même membre remplace simplement le précédent.
- L'édition (`groups.events.edit`) est une réécriture complète des champs
  modifiables (pas de fusion partielle) ; les RSVP existants sont conservés
  tels quels, quel que soit qui édite.
- Suppression d'un salon vocal référencé par un événement : l'événement
  survit, `channel_id` repasse à `null` (même politique que la suppression
  d'une catégorie, qui « décatégorise » ses salons plutôt que de les
  supprimer).

### 1.2 Événement WebSocket : `event.group_event_started`

Émis **localement** (jamais répliqué sur le réseau — chaque pair honnête
détecte le passage de l'échéance de son côté) quand l'heure de début d'un
événement est atteinte :

```json
{
  "group_id": "hex16",
  "event_id": "hex16",
  "title": "Soirée jeux"
}
```

- Vérifié toutes les 60 secondes (boucle de maintenance dédiée,
  `MaintenanceConfig::event_check`).
- Émis **une seule fois** par événement : le suivi des identifiants déjà
  signalés est persisté en base locale (métadonnée jamais répliquée) et
  survit à un redémarrage.
- Un événement dont l'heure de début est passée de **plus d'une heure**
  n'est jamais (re)signalé — y compris juste après un redémarrage qui aurait
  raté la fenêtre : pas de rattrapage bruyant d'événements anciens.

### 1.3 Forme dans `groups.state`

Chaque entrée du tableau `events` :

```json
{
  "event_id": "hex16",
  "title": "Soirée jeux",
  "description": "Amenez vos manettes.",
  "start_ms": 1700000000000,
  "channel_id": "hex16 ou null",
  "author": "hex32",
  "rsvp_count": 3,
  "rsvped": true
}
```

`rsvped` reflète l'appelant local (clé publique locale dans l'ensemble des
RSVP) — l'UI n'a pas besoin de connaître sa propre clé pour l'afficher.

---

## 2. Stickers de serveur (`groups.stickers.*`)

Mêmes règles que les émojis de serveur (`groups.emoji.*`), y compris le
mécanisme de stockage (image publiée dans le magasin de fichiers, référencée
par sa racine Merkle SHA-256 de contenu).

### 2.1 Méthodes RPC

| Méthode | Paramètres | Résultat | Erreurs notables |
|---|---|---|---|
| `groups.stickers.add` | `{ group_id, name, mime, data_b64 }` | `{ merkle_root: hex32 }` | `INVALID_PARAMS` (nom, MIME, taille, base64) |
| `groups.stickers.remove` | `{ group_id, name }` | `{ ok: true }` | `INVALID_PARAMS` (nom invalide) ; `APP_ERROR` « refusé : sticker inconnu » |
| `groups.stickers.list` | `{ group_id }` | `{ stickers: [{ name, merkle_root }] }` | — |

- `name` : 2-32 caractères `[a-z0-9_]` (mêmes règles qu'un nom d'émoji).
- `mime` : `image/png`, `image/jpeg`, `image/webp` ou `image/gif`.
- `data_b64` : image décodée non vide, ≤ 512 Kio.
- `groups.stickers.add` sur un nom déjà enregistré **remplace** l'image
  (pas d'erreur « déjà existant »), exactement comme les émojis.
- Les stickers apparaissent aussi dans `groups.state.stickers` (même forme
  que `groups.stickers.list`), pour éviter un aller-retour supplémentaire
  quand l'UI charge déjà l'état complet du groupe.

### 2.2 Envoi d'un sticker (`groups.send` étendu)

`groups.send` accepte désormais un paramètre `sticker` optionnel :

| Méthode | Paramètres | Résultat |
|---|---|---|
| `groups.send` (sticker) | `{ group_id, channel_id, sticker: "<nom>" }` | `{ msg_id: hex16 }` |

Quand `sticker` est présent, `text`/`reply_to`/`attachments` sont **ignorés**
— un appel ne peut pas mélanger texte et sticker. Sans `sticker`, le
comportement historique (message texte) est inchangé.

`sticker` doit référencer un nom **actuellement enregistré** dans
`groups.state.stickers` de ce groupe ; la racine Merkle transmise sur le fil
est **dérivée côté serveur** de ce registre, jamais fournie par l'appelant —
un client ne peut donc pas forger un couple `(nom, racine)` sans rapport
avec un sticker réellement enregistré. Un nom inconnu (ou plus enregistré)
rend `INVALID_PARAMS` (« sticker inconnu »).

Forme du corps dans l'historique (`groups.history`, `groups.history_around`,
`event.group_msg`) :

```json
{ "type": "sticker", "name": "wave", "merkle_root": "hex32" }
```

Un pair plus ancien qui ne reconnaît pas encore le discriminant filaire
`Sticker` (kind 4) échoue à décoder ce message précis — dégradation
identique à celle de tout futur corps de message non reconnu, sans impact
sur le reste du salon.

---

## 3. Avatar de serveur (`groups.set_member_avatar`)

Avatar **par serveur** (distinct de l'avatar de profil global,
`profile.set_avatar`) : self-service strict, aucun modérateur ne peut
l'imposer ni l'effacer pour un autre membre — contrairement au pseudo de
serveur (`groups.set_nickname`), qui autorise un modérateur `MANAGE_ROLES` à
agir sur un membre de rang inférieur.

**Choix d'implémentation** : nouvel op `SetMemberAvatar` (0x26) plutôt
qu'extension de `SetNickname` (0x1E). `SetNickname` porte une chaîne et
autorise un tiers modérateur ; l'avatar porte une racine Merkle optionnelle
et n'autorise **jamais** de tiers. Fusionner les deux aurait forcé chaque
appelant à porter deux champs sans rapport (chaîne + option de hash) et
aurait compliqué la vérification de permission (self-service pur pour l'un,
modération hiérarchique pour l'autre) dans une seule op. Un op dédié, sans
champ `member` (la cible est toujours implicitement l'auteur), reste
minimal sur le fil et place la garde « self-service uniquement » au niveau
le plus simple possible : il n'existe tout simplement aucun champ pour
désigner une autre cible.

### 3.1 Méthode RPC

| Méthode | Paramètres | Résultat |
|---|---|---|
| `groups.set_member_avatar` | `{ group_id, mime?, data_b64? }` | `{ avatar: hex32 ou null }` |

- `data_b64` présent ⇒ `mime` requis, image décodée non vide et ≤ 512 Kio,
  `mime` doit commencer par `image/` (borne plus permissive que les
  stickers/émojis, alignée sur `groups.set_icon`) ; l'image est publiée dans
  le magasin de fichiers et sa racine Merkle devient l'avatar.
- `data_b64` absent (ou paramètre omis entièrement) ⇒ efface l'avatar
  (`avatar: null` en résultat).
- Toujours self-service : la cible est l'identité locale, il n'existe pas de
  paramètre pour désigner un autre membre.

### 3.2 Forme dans `groups.state`

Chaque entrée de `members[]` gagne un champ `avatar` :

```json
{
  "pubkey": "hex32",
  "roles": ["hex16", "…"],
  "nickname": "…ou null",
  "avatar": "hex32 ou null",
  "timeout_until_ms": 0,
  "voice_muted": false,
  "voice_deafened": false
}
```

Un membre expulsé, banni ou qui quitte volontairement perd son avatar de
serveur (retiré de l'état, comme son pseudo et sa modération vocale).

---

## 4. Couleur de bannière de serveur (`groups.set_banner_color`)

Champ additif `banner_color: Option<u32>` (`0xRRGGBB`, ≤ 24 bits) sur
l'op `SetMeta` existante (celle qui porte déjà le nom et l'icône du groupe).
`groups.rename` et `groups.set_icon` **préservent** la couleur de bannière
courante (ils relisent l'état avant d'émettre `SetMeta`, exactement comme ils
préservent déjà l'icône lors d'un renommage, ou le nom lors d'un changement
d'icône).

### 4.1 Méthode RPC

| Méthode | Paramètres | Résultat | Erreurs notables |
|---|---|---|---|
| `groups.set_banner_color` | `{ group_id, color: entier 0xRRGGBB ou null }` | `{ ok: true }` | `INVALID_PARAMS` (`color` absent, ou > 0xFFFFFF) |

`color` est **requis explicitement** (absent ⇒ `INVALID_PARAMS` — intention
sans ambiguïté exigée) : un entier fixe la couleur, `null` l'efface.

### 4.2 Forme dans `groups.state`

Nouveau champ racine :

```json
{
  "banner_color": "entier 0xRRGGBB ou null",
  "...": "reste du contrat groups.state inchangé"
}
```

---

## 5. Journal d'audit (`groups.audit`)

Nouvelles entrées décodées (`kind` en libellé stable, `params` limités aux
champs utiles à une description humaine) :

| `kind` | `params` |
|---|---|
| `set_meta` | `{ name, icon, banner_color }` (le champ `banner_color` s'ajoute à la forme existante) |
| `event_create` | `{ event_id, title }` |
| `event_edit` | `{ event_id, title }` |
| `event_delete` | `{ event_id }` |
| `event_rsvp` | `{ event_id, interested }` |
| `sticker_add` | `{ name }` |
| `sticker_remove` | `{ name }` |
| `set_member_avatar` | `{ avatar }` (hex32 ou `null`) |
| `poll_create` | `{ poll_id, channel_id, msg_id }` |
| `poll_vote` | `{ poll_id, option_index }` |
| `poll_close` | `{ poll_id }` |
| `poll_delete` | `{ poll_id }` |

---

## 6. Sondages (`groups.polls.*`, D-048)

Un sondage est posté **comme un message** de salon (`groups.send` avec un
paramètre `poll`) : la question et les options y voyagent, content-adressées
à un `poll_id` frais généré côté serveur. Les **votes**, eux, ne sont **pas**
dans le message — ils vivent dans l'op-log de groupe
(`PollCreate`/`PollVote`/`PollClose`/`PollDelete`) pour que tous les pairs
convergent sur le même dépouillement, exposé en direct dans `groups.state`.

**Choix d'implémentation** : quatre ops plutôt que deux. Le repli de l'op-log
(`GroupState::fold`) est une fonction pure du journal signé — il n'a jamais
accès au contenu des messages. Pour que « quel `poll_id` existe », « qui a
le droit d'écrire dans quel salon » et « qui peut le clore » soient des
faits **vérifiables cryptographiquement** (et non simplement déclarés par un
vote non fiable — le premier votant n'est pas forcément l'auteur du sondage,
et lui faire confiance permettrait à n'importe quel membre de « voler » le
droit de clôture d'un sondage d'autrui), le nœud émetteur enregistre
automatiquement une op `PollCreate`
en même temps qu'il diffuse le message — jamais exposée comme méthode RPC à
part entière, c'est un détail d'implémentation de `groups.send`.

### 6.1 Méthodes RPC

| Méthode | Paramètres | Résultat | Erreurs notables |
|---|---|---|---|
| `groups.send` (sondage) | `{ group_id, channel_id, poll: { question, options: [string, ...] } }` | `{ msg_id: hex16, poll_id: hex16 }` | `INVALID_PARAMS` (question/options hors bornes) ; `APP_ERROR` « refusé : … » (droit d'écriture, plafond de sondages atteint) |
| `groups.polls.vote` | `{ group_id, poll_id, option_index }` | `{ ok: true }` | `APP_ERROR` « refusé : … » (sondage inconnu, clos, `option_index` hors bornes) |
| `groups.polls.close` | `{ group_id, poll_id }` | `{ ok: true }` | `APP_ERROR` « refusé : … » (sondage inconnu, ni auteur ni `MANAGE_CHANNELS`) |
| `groups.polls.delete` | `{ group_id, poll_id }` | `{ ok: true }` | `APP_ERROR` « refusé : … » (sondage inconnu, ni auteur ni `MANAGE_CHANNELS`) |

- `question` : 1-300 octets UTF-8, non vide, sans caractère de contrôle
  (hors `\n`/`\r`/`\t`) — bornes vérifiées **à la composition et au
  décodage filaire**, pas seulement au repli (le message n'a pas d'étape de
  repli comparable à l'op-log).
- `options` : 2 à 10 entrées, chacune 1-100 octets UTF-8, non vide, mêmes
  règles de caractères de contrôle que la question. Aucune vérification
  anti-usurpation (bidi/zero-width) contrairement à un pseudo ou un nom de
  sondage : un texte de sondage n'apparaît jamais dans une liste de membres.
- Quand `poll` est présent, `text`/`reply_to`/`attachments`/`sticker` sont
  **ignorés** — un appel ne peut pas mélanger texte, sticker et sondage.
  Sans `poll`, le comportement historique de `groups.send` est inchangé.
- `option_index` (vote) : choix unique — un second vote du même membre sur
  le même sondage **remplace** le précédent (pas d'accumulation),
  dédoublonné par `(poll_id, membre)` au repli, exactement comme un RSVP
  d'événement.
- N'importe quel membre peut créer, voir ou voter sur un sondage **du moment
  qu'il a `VIEW`+`SEND` effectifs dans le salon visé** — aucune permission
  élevée au-delà (contrairement aux événements/stickers qui exigent
  `MANAGE_CHANNELS`/`MANAGE_EMOJIS`) : un sondage a exactement les mêmes
  droits qu'un message ordinaire dans ce salon, vérifiés **à l'émission de
  l'op ET à son rejeu** (avant le durcissement post-revue de D-048,
  `PollCreate` n'exigeait que la simple appartenance au groupe — voir la
  section « Durcissement post-revue » plus haut).
- Clôture (`groups.polls.close`) et suppression (`groups.polls.delete`)
  réservées à l'auteur du sondage ou à un porteur de `MANAGE_CHANNELS`,
  comme l'édition/suppression d'un événement. Une fois clos, tout vote
  ultérieur est ignoré au repli — le dépouillement reste figé. Idempotent
  (clore un sondage déjà clos ne change rien). La suppression, elle, retire
  le sondage de `groups.state.polls` et **libère l'emplacement compté par
  `MAX_POLLS`** — seul moyen de le récupérer une fois un sondage créé.
- Un vote dont `option_index` dépasse le nombre **réel** d'options du
  sondage (connu seulement via le message, jamais de l'op-log) est accepté
  structurellement au repli — borné uniquement à `MAX_POLL_OPTIONS` (10) —
  mais n'est simplement jamais affiché par une UI honnête : dégradation
  gracieuse, pas d'oracle réseau, même politique que la validation d'un nom
  de sticker à l'ingestion.
- Un membre expulsé, banni ou qui quitte volontairement perd son vote sur
  tous les sondages (retiré de l'état, même hygiène que ses RSVP
  d'événement) ; les sondages qu'il a **autorés** restent, clôturables et
  supprimables par le fondateur ou tout `MANAGE_CHANNELS`.

### 6.2 Forme du corps dans l'historique

Forme du corps dans l'historique (`groups.history`, `groups.history_around`,
`event.group_msg`) :

```json
{
  "type": "poll",
  "poll_id": "hex16",
  "question": "Pizza ou sushis ?",
  "options": ["Pizza", "Sushis", "Les deux"]
}
```

### 6.3 Forme dans `groups.state`

Chaque entrée du tableau `polls` (le dépouillement, jamais la question/les
options — cf. `groups.history` ci-dessus) :

```json
{
  "poll_id": "hex16",
  "author": "hex32",
  "channel_id": "hex16",
  "msg_id": "hex16",
  "closed": false,
  "counts": [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  "total_votes": 1,
  "my_vote": 1
}
```

- `channel_id`/`msg_id` (champs additifs du durcissement post-revue) :
  reflètent directement `GroupOpBody::PollCreate` — le salon où le sondage a
  été posté et le message canonique (`groups.history`) auquel `poll_id` est
  lié.
- `counts` : tableau **toujours large de `MAX_POLL_OPTIONS` (10)**, quel que
  soit le nombre réel d'options du sondage — `counts[i]` est le nombre de
  votes pour l'option `i` ; les cases au-delà du nombre réel d'options
  restent à `0` en pratique (une UI honnête ne laisse jamais voter hors
  bornes réelles).
- `my_vote` : l'option choisie par l'appelant local, ou `null` s'il n'a pas
  voté.

---

## 7. Quotas et bornes (résumé)

| Élément | Borne | Enforcement |
|---|---|---|
| Événements par groupe | 25 (`MAX_EVENTS`) | fold, à la création uniquement (édition/suppression/RSVP toujours possibles au-delà) |
| Titre d'événement | 2-100 caractères, sans caractère de contrôle ni de format trompeur (bidi/zero-width) | frontière + fold |
| Description d'événement | ≤ 1024 caractères, caractères de contrôle refusés hors `\n`/`\r`/`\t` | frontière + fold |
| Échéance d'événement (`start_ms`) | ≤ 1<<43 ms (~an 2248, même plafond qu'un timeout) | fold — **rejet complet de l'op**, jamais de troncature silencieuse (contrairement à un timeout) |
| Salon d'un événement | doit être un salon **vocal** existant du groupe, sinon ignoré | fold |
| Stickers par groupe | 30 (`MAX_STICKERS`) | fold, sur un **nouveau** nom uniquement (remplacer un nom existant reste toujours permis) |
| Nom de sticker | 2-32 caractères `[a-z0-9_]` | frontière + fold |
| Image de sticker | 1 octet – 512 Kio décodée, MIME `image/{png,jpeg,webp,gif}` | frontière (**convention côté client** : appliquée quand le nœud LOCAL crée l'op — au rejeu, seul le hash 32 octets est validé ; un client modifié peut référencer un blob plus gros, comme pour les émojis/icônes existants. Le fetch reste explicite et borné par la couche fichiers) |
| Image d'avatar de serveur | 1 octet – 512 Kio décodée, MIME `image/*` | frontière (même convention côté client que les stickers) |
| Couleur de bannière / de rôle | ≤ 0xFFFFFF (24 bits) | frontière + décodage filaire |
| RSVP | dédoublonné par `(event_id, membre)`, borné par l'appartenance au groupe | fold |
| Nom de sticker sur le fil (`MsgBody::Sticker`) | ≤ 32 octets (`MAX_EMOJI_NAME`, partagé avec les émojis) | décodage filaire |
| Titre d'événement sur le fil | ≤ 400 octets UTF-8 | décodage filaire |
| Description d'événement sur le fil | ≤ 4096 octets UTF-8 | décodage filaire |
| Sondages par groupe | 25 (`MAX_POLLS`) | fold, à la création (`PollCreate`) uniquement — récupérable via `PollDelete` (vote/clôture toujours possibles au-delà du plafond) |
| Création de sondage (`PollCreate`) | `VIEW`+`SEND` effectifs de l'auteur dans `channel_id` (**pas** la simple appartenance) | fold, même porte qu'un envoi de message ordinaire |
| Question de sondage | 1-300 octets UTF-8, non vide, sans caractère de contrôle hors `\n`/`\r`/`\t` | décodage filaire (bornes d'octets/vide/UTF-8) + composition/ingestion (caractères de contrôle) |
| Options de sondage | 2-10 entrées, chacune 1-100 octets UTF-8, non vide | décodage filaire + composition/ingestion |
| `option_index` d'un vote | borne **structurelle** ≤ `MAX_POLL_OPTIONS` (10) — le repli ignore ce qui dépasse, indépendamment du nombre réel d'options du sondage (connu seulement via le message) | fold |
| Vote de sondage | dédoublonné par `(poll_id, membre)`, choix unique (remplace, n'accumule pas) | fold |
| Liaison `poll_id` → message canonique | un seul `(auteur, msg_id)` par `poll_id`, fixé par le premier `PollCreate` replié — tout `MsgBody::Poll` ultérieur d'un autre auteur ou avec un autre `msg_id` est ignoré | ingestion du message (contre l'état replié de l'op-log) |

Toute op au-delà d'une borne de **fold** est silencieusement ignorée
(convergence déterministe entre pairs honnêtes, indépendante de l'ordre
d'arrivée — cf. `GroupState::apply`) ; toute valeur au-delà d'une borne de
**décodage filaire** rejette la structure entière avant même d'atteindre le
repli (aucun panic possible sur une entrée hostile).
