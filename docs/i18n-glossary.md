# 卡牌譯文術語表（中 → 英）

**狀態：** 2026-11-17 建立。**用途：** 164 個卡牌定義的英文譯文必須逐字遵守本表，否則規則文本會出現同物異名。
**依據：** 現有卡牌 JSON 的作者原文（繁中）與 `docs/i18n-design.md` §8。

---

## 1. 機制名詞

| 繁中原文 | English | 說明 / 出處 |
|---|---|---|
| 灼熱（指數） | Scorch (counter) | `counters: scorch`；達到攻擊力＋生命值上限時破壞 |
| 充能指數 | Charge counter | `counters: charge` |
| 僕從 | Creature | `cardTypes: ["Creature"]` |
| 遺跡 | Relic | `cardTypes: ["Artifact"]` 且非 Equipment |
| 裝備 | Equipment | `subTypes: ["Equipment"]`，保持原樣 |
| 上使 | Emissary | 天使代幣的子類型 |
| 幻影木偶 | Phantom Puppet | `subTypes`，同名卡牌系列 |
| 幻影 | Phantom | 卡名前綴（幻影船長、幻影女王…） |
| 能量（總值） | energy (total) | 遺跡耐久；對應 `energyTotalGreaterThan` 類條件 |
| 能量總值（Creature） | **mana value** | 2026-11-17 定案：`manaValueGreaterThan` 欄位一律譯 mana value，不可寫 total energy |
| 橫置 | Tap | `① 橫置：` → `① Tap: ` |
| 重置 | Untap | 重置步驟 |
| 召喚失調 | summoning sickness | |
| 破壞 | destroy | |
| 特殊召喚 | special summon | |
| 放逐 | exile | zone 名 |
| 墓地 | graveyard | zone 名 |
| 牌組 | deck | |
| 手牌 | hand | |
| 場上 | on the field | |
| 牌組頂 / 牌組底 | top / bottom of the deck | |
| 抽牌 | draw (a card) | |
| 棄牌 | discard | |
| 對手 | opponent | |
| 我方 / 你的 | your | 卡面用第二人稱 `your`，不用 `our` |
| 攻擊 / 阻擋 | attack / block | |
| 生命 | life | |
| 傷害 | damage | |
| 目標 | target | |
| 效應 / 效果 | effect | |
| 異能 | ability | |
| 觸發 | trigger | |
| 靜態 | static | |
| 即時 / 巫術（速度） | instant / sorcery | `castSpeed` |
| 主（模式） | Main | `主：` → `Main: ` |
| 速（模式） | Speed | `速：` → `Speed: ` |
| 代幣 | token | |
| 標記 | marker / badge（UI 用 badge） | |

## 2. 元素 / 顏色

| 繁中 | English |
|---|---|
| 炎 / 火 | fire |
| 水 | water |
| 風 | wind |
| 地 | earth |
| 光 | light |
| 暗 | dark |
| 無色 | colorless |

## 3. 句式規範

1. **模式前綴**：`主 ; ` → `Main ; `；`主：` → `Main: `；`速：` → `Speed: `。保留原有的 `;` 與 `：` 對應關係，不要重排句子順序。
2. **編號動作**：`① 橫置：` → `① Tap: `，圈號保留，冒號後留一個空格。
3. **括號註解**：全角 `（）` → 半角 `()`，內容照譯，不省略。
4. **標點**：`，` → `, `；`。` → `. `；`；` → `; `；`、` → `, `。句末不加多餘空格。
5. **換行**：原文的 `\n` 保留，模式之間不額外插空行。
6. **專有名稱**：卡名本身照音譯／意譯慣例（既有 `Flame Emperor Achilles`、`Angel Empress Butterfly`），後續新卡沿用相同前綴寫法。
7. **數字**：阿拉伯數字照抄（`5點傷害` → `5 damage`），不要寫成英文單詞。
8. **不加修飾**：不添加原文沒有的「you may」「if able」等語氣詞，避免改變規則語義。

## 4. 已確立的譯文樣本（`fireball`）

| 欄位 | 原文 | 英文 |
|---|---|---|
| name | 火球術 | Fireball |
| subTypes | 炎兵 | Flame Soldier |
| rulesText | 主 ; 灼熱2：放置兩個灼熱指數… | Main ; Scorch 2: place two Scorch counters… |
| mode `main-scorch` | 主：灼熱2 | Main: Scorch 2 |
| mode `instant-damage` | 速：對對手玩家造成5點傷害 | Speed: deal 5 damage to the opposing player |

## 5. 翻譯流程約束

- 每批譯完立刻跑 `node scripts/i18n/card-coverage.mjs`，`missing` 欄必須為空。
- 新增譯文若引用到本表未收錄的機制詞，**先補本表再翻譯**，避免同物異名。
- 卡名（`name`）與規則文本（`rulesText`）必須同批完成，不可只譯其一。

## 6. 卡牌命名原則（2026-11-17 定案）

**短卡名**（1–2 個詞素）：保留名詞堆疊，不強加介系詞。
例：`Fireball`、`Blaze Fangs`、`Bloodfire Mountain`、`Red Wolf`。

**長頭銜 / 陣營名**（3 個詞素以上）：用 `of`、逗號或頭銜後置，禁止硬疊。
例：`Rebel of the Worlds Empire`（不是 Worlds Empire Rebel）、`Bloodrage Maadini of the Six Sovereigns`（不是 Worlds Six Sovereigns Bloodrage Maadini）、`Keps, the Blaze Wolf King`（不是 Flame Wolf King Keps）。

**火焰前綴必須分層**，否則英文會出現 7 個同義 `Flame`：

| 繁中前綴 | English | 出現卡牌 |
|---|---|---|
| 烈焰 | **Blaze** | 烈焰獠牙、烈焰弩炮、烈焰狼王 凱普斯 |
| 炎極 | **Flame** | 炎極三公 安度基特斯、炎極三公 凱隆、炎極雇傭兵 |
| 極炎 | **Flame** | 極炎皇帝 阿基里斯 |
| 怒焰 | **Rageflame** | 强攻之怒焰狼、睿智之怒焰狼 |

**陣營 / 頭銜術語**：諸界 = Worlds、六皇 = Six Sovereigns、三公 = Triarch、皇帝 = Emperor、狼王 = Wolf King、大天使 = Archangel。

**單複數**：卡面一張卡 = 一個永久物，一律單數。`阿基里斯爪牙` → `Achilles' Minion`（不是 Minions）。

## 7. 已定案譯名（core + st01a + tokens，26 條）

| id | 繁中 | English |
|---|---|---|
| fireball | 火球術 | Fireball |
| broken-fireball | 破裂火球 | Shattered Fireball |
| empire-servant | 帝國奴僕 | Empire Servant |
| flame-fangs | 烈焰獠牙 | Blaze Fangs |
| land-red | 血炎山 | Bloodfire Mountain |
| musketeer-infantry | 火槍團下等兵 | Musketeer Private |
| worlds-rebel | 諸界帝國反抗軍 | Rebel of the Worlds Empire |
| achilles-blood-temple | 阿基里斯血炎神殿 | Achilles' Bloodfire Temple |
| achilles-minion | 阿基里斯爪牙 | Achilles' Minion |
| andu-gittes | 炎極三公 安度基特斯 | Flame Triarch Andu Gittes |
| awakened-blood-mountain | 被啓動的血炎山 | Awakened Bloodfire Mountain |
| bloodrage-maadini | 諸界六皇 血怒之馬甸尼 | Bloodrage Maadini of the Six Sovereigns |
| chiron | 炎極三公 凱隆 | Flame Triarch Chiron |
| flame-ballista | 烈焰弩炮 | Blaze Ballista |
| flame-emperor-achilles | 極炎皇帝 阿基里斯 | Flame Emperor Achilles |
| flame-mercenary | 炎極雇傭兵 | Flame Mercenary |
| ignition-wolf | 點火狼 | Ignition Wolf |
| red-wolf | 赤狼 | Red Wolf |
| rise-of-power | 强權崛起 | Rise to Power |
| strong-ignition-wolf | 强攻之怒焰狼 | Fierce Assault Rageflame Wolf |
| wise-ignition-wolf | 睿智之怒焰狼 | Wise Rageflame Wolf |
| wolf-king-keps | 烈焰狼王 凱普斯 | Keps, the Blaze Wolf King |
| worlds-flameblade | 諸界烈刃 | Flameblade of the Worlds |
| worlds-pyromancer | 諸界火術士 | Pyromancer of the Worlds |
| token-angel-1-1 | 天使代幣 | Angel Token |
| token-phantom-stitch-monster | 幻影縫合怪 | Phantom Stitched Monster |

## 8. 例外與凍結項

- **`abyss-giant` 不翻譯**（2026-11-17 定案）：它是 `tests/library/localized-card-text.test.ts` 與 `tests/server/catalog-locale.test.ts` 的「未翻譯卡」fixture，翻譯它會讓兩處斷言失效。workbook 批次翻譯時**跳過此卡**，覆蓋率報告把它算作預期缺口。

## 9. 介面枚舉詞彙（2026-11-17）

wire 值保持英文枚舉，介面按語言顯示；未知值原樣返回（新類型不會白屏）。

| wire 值 | English | 繁中 |
|---|---|---|
| Creature | Creature | 僕從 |
| Artifact | Artifact | 遺跡 |
| Land | Land | 地界 |
| Spell | Spell | 咒語 |
| Enchantment | Enchantment | 附魔 |
| Equipment | Equipment | 裝備 |
| （isToken） | Token | 代幣 |
| white / blue / black | White / Blue / Black | 白 / 藍 / 黑 |
| red / green / yellow | Red / Green / Yellow | 紅 / 綠 / 黃 |
| colorless | Colourless | 無色 |

多值以「、」連接；卡牌詳情的 Colour 行無顏色時顯示「無色」。

## 10. 日誌摘要（2026-11-17）

服務端 `PublicNotification` 帶 `summaryKey` + `summaryParams`，客戶端優先按 key 渲染；`summary` 保留英文作舊客戶端兜底。

| summaryKey | English | 繁中 |
|---|---|---|
| resolvedImmediately | Resolved immediately: {source} | 立即結算：{source} |
| revealed | Revealed: {card} · source: {source} | 公開：{card} · 來源：{source} |

未知 key 或由客戶端拼接的多段摘要（如 `Phase: …`、`Priority: …`）仍顯示英文原文。
