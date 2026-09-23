// Tiny i18n layer: English / 日本語
const DICT = {
  en: {
    'title.small': 'A Voice-Cast Duel', 'title.sub': 'Speak, and the world answers. Powered by <b>Jev</b>.',
    'menu.duel': '⚔ Duel the Archmage', 'menu.online': '✦ Online Duel', 'menu.practice': '◎ Training Grounds', 'menu.howto': '❖ Grimoire (How to Cast)', 'menu.settings': '⚙ Settings',
    'online.title': 'Online Duel', 'online.desc': "Players in the same room fight free-for-all. Share this server's address with friends on your network.", 'online.name': 'Your name', 'online.room': 'Room', 'online.join': 'Enter the Arena', 'back': 'Back', 'done': 'Done', 'close': 'Close',
    'set.title': 'Settings', 'set.ui': 'Language', 'set.voice': 'Voice recognition', 'set.diff': 'Rival difficulty', 'set.gfx': 'Graphics', 'set.cam': 'Camera', 'set.sens': 'Mouse sensitivity', 'set.vol': 'Master volume', 'set.music': 'Music',
    'set.localvoice': 'Experimental: prefer installed offline recognition', 'set.warmvoice': 'Experimental: prepare recognition with an audio track',
    'set.jev': 'Use Jev to interpret incantations', 'set.botjev': 'Rival also consults Jev', 'set.botvoice': 'Rival speaks its chants aloud', 'set.handsfree': 'Hands-free casting (cast whenever you speak a spell)',
    'diff.easy': 'Apprentice', 'diff.normal': 'Archmage', 'diff.hard': 'Sage of Ruin', 'gfx.high': 'High', 'gfx.perf': 'Performance', 'cam.tps': 'Third person (over the shoulder)', 'cam.fps': 'First person',
    'pause.title': 'Paused', 'pause.resume': 'Resume', 'pause.quit': 'Leave Arena',
    'howto.title': 'The Grimoire', 'howto.casting': 'Casting',
    'howto.p1': 'Hold <b>F</b> (or <b>Right-Click</b>) and <b>speak</b>. Release to cast instantly. Jev reads your words while you speak and decides the element, the form and a dozen parameters: power, rank, speed, size, heat, weight, sharpness, count, duration, chaos.',
    'howto.q1': '“Fireball!” → a normal fireball.', 'howto.q2': '“Summoning the spirit of fire, gathering the power of the earth, here I will cast the ultimate fireball!” → a Legendary, earth-fused inferno.',
    'howto.p2': 'Longer, more ceremonial chants and a louder voice make stronger spells, but they cost more mana and leave you exposed while chanting.',
    'howto.controls': 'Controls', 'howto.ctrl': '<b>WASD</b> move · <b>Space</b> jump (hold to glide) · <b>Shift</b> sprint · <b>E</b> dash · <b>Ctrl</b> descend while flying<br/><b>Left-Click</b> mana bolt · <b>Enter</b> type a spell · <b>Esc</b> pause',
    'howto.elements': 'Elements', 'howto.forms': 'Forms', 'howto.reactions': 'Reactions',
    'hint.chant': 'Hold <b>F</b> / <b>Right-Click</b> and speak · <b>Enter</b> to type', 'hint.noSR': 'Voice recognition needs Chrome or Edge. <b>Enter</b> to type incantations.', 'hint.mic': 'Microphone blocked. <b>Enter</b> to type incantations.', 'hint.net': 'Speech service unreachable (needs internet). <b>Enter</b> to type.',
    'type.ph': 'Type an incantation, e.g. “Summoning the spirit of fire… ultimate fireball!”',
    'loading': 'Weaving the world…', 'you': 'You',
    'jev.ready': 'Jev ready', 'jev.nokey': 'Jev: no key (local parser)', 'jev.offline': 'Server offline', 'jev.err': 'Jev error → local',
    'menu.jevok': 'Jev connected', 'menu.nokey': 'Jev key not found: using the local spell parser.', 'menu.noserver': 'Run "node server.js" and open http://localhost:8787 for Jev + online play.',
    'chant.silence': '…the words did not come…', 'chant.nomagic': '— no magic answers.', 'chant.broken': 'Your chant was broken!', 'chant.interrupted': 'Your casting was interrupted!', 'chant.echo': 'Echoing', 'chant.nomic': '(no microphone: press Enter to type)',
    'feed.cast': '{who} cast {spell}', 'feed.fell': '{who} fell', 'feed.to': ' to {who}', 'feed.starved': 'Mana-starved! The spell is weakened.', 'feed.enter': '{who} entered the arena.', 'feed.left': '{who} left.', 'feed.joined': 'Joined room {room} · {n} other mage(s) here.',
    'rank': 'Rank', 'mana': 'mana', 'weakened': 'mana-starved, weakened', 'damage': 'damage',
    'ban.duel': 'DUEL', 'ban.duel2': 'First to two victories', 'ban.train': 'TRAINING', 'ban.train2': 'Speak freely. The golem does not fight back.', 'ban.win': 'VICTORY', 'ban.lose': 'DEFEAT', 'ban.rwin': 'ROUND WON', 'ban.rlose': 'ROUND LOST', 'ban.next': 'Press Esc for the menu · a new duel begins…', 'ban.dc': 'DISCONNECTED',
    'round': 'ROUND {n} · {a} – {b}', 'round.train': 'TRAINING GROUNDS', 'round.online': 'ONLINE · {room}',
    'st.frozen': 'Frozen', 'st.super': 'Superconduct', 'st.stun': 'Stunned', 'st.burn': 'Burning', 'st.charged': 'Charged', 'st.afflicted': 'Afflicted', 'st.haste': 'Haste', 'st.chanting': 'Chanting…', 'st.shield': 'Shield', 'st.mud': 'Mired', 'st.weak': 'Weakened', 'st.curse': 'Cursed', 'st.fly': 'Flying', 'st.poison': 'Poisoned',
    'p.power': 'Power', 'p.rank': 'Rank', 'p.speed': 'Speed', 'p.size': 'Size', 'p.heat': 'Heat', 'p.weight': 'Weight', 'p.edge': 'Edge', 'p.count': 'Count', 'p.duration': 'Duration', 'p.chaos': 'Chaos',
    'bot.rival': 'Archmage Rhea', 'bot.hard': 'Sage of Ruin', 'bot.easy': 'Apprentice Lio', 'bot.golem': 'Training Golem',
  },
  ja: {
    'title.small': '声で詠唱する魔法決闘', 'title.sub': '唱えよ、世界は応える。Powered by <b>Jev</b>',
    'menu.duel': '⚔ 大魔導師と決闘', 'menu.online': '✦ オンライン対戦', 'menu.practice': '◎ 修練場', 'menu.howto': '❖ 魔導書（遊び方）', 'menu.settings': '⚙ 設定',
    'online.title': 'オンライン対戦', 'online.desc': '同じルームのプレイヤー全員でバトルロイヤル。同じネットワークの友達にこのサーバーのアドレスを共有しよう。', 'online.name': 'プレイヤー名', 'online.room': 'ルーム', 'online.join': '闘技場へ', 'back': '戻る', 'done': '完了', 'close': '閉じる',
    'set.title': '設定', 'set.ui': '言語', 'set.voice': '音声認識の言語', 'set.diff': '対戦相手の強さ', 'set.gfx': 'グラフィック', 'set.cam': 'カメラ', 'set.sens': 'マウス感度', 'set.vol': '全体音量', 'set.music': '音楽',
    'set.localvoice': '実験機能：導入済みのオフライン音声認識を優先', 'set.warmvoice': '実験機能：音声トラックで次の詠唱を準備',
    'set.jev': 'Jevで詠唱を解釈する', 'set.botjev': '相手もJevを使う', 'set.botvoice': '相手の詠唱を読み上げる', 'set.handsfree': 'ハンズフリー詠唱（呪文を話すと自動で発動）',
    'diff.easy': '見習い', 'diff.normal': '大魔導師', 'diff.hard': '破滅の賢者', 'gfx.high': '高品質', 'gfx.perf': 'パフォーマンス', 'cam.tps': '三人称（肩越し）', 'cam.fps': '一人称',
    'pause.title': '一時停止', 'pause.resume': '再開', 'pause.quit': '闘技場を去る',
    'howto.title': '魔導書', 'howto.casting': '詠唱',
    'howto.p1': '<b>F</b>（または<b>右クリック</b>）を押しながら<b>声に出して</b>詠唱し、離すと即座に発動。話している間にJevが言葉を読み取り、属性・形態と十数個のパラメータ（威力・位階・速度・大きさ・温度・重さ・鋭さ・数・持続・混沌）を決定します。',
    'howto.q1': '「ファイアボール！」→ 普通の火球。', 'howto.q2': '「炎の精霊よ、大地の力を集め、今ここに究極の火球を放つ！」→ 伝説級の岩炎の業火。',
    'howto.p2': '長く荘厳な詠唱、大きな声ほど強力な魔法になります。ただしマナ消費が増え、詠唱中は無防備です。',
    'howto.controls': '操作', 'howto.ctrl': '<b>WASD</b> 移動 · <b>Space</b> ジャンプ（長押しで滑空） · <b>Shift</b> ダッシュ · <b>E</b> 回避 · <b>Ctrl</b> 飛行中に降下<br/><b>左クリック</b> 魔弾 · <b>Enter</b> 文字で詠唱 · <b>Esc</b> 一時停止',
    'howto.elements': '属性', 'howto.forms': '形態', 'howto.reactions': '元素反応',
    'hint.chant': '<b>F</b> / <b>右クリック</b> 長押しで詠唱 · <b>Enter</b> で文字入力', 'hint.noSR': '音声認識はChrome / Edgeが必要です。<b>Enter</b>で文字詠唱できます。', 'hint.mic': 'マイクがブロックされています。<b>Enter</b>で文字詠唱。', 'hint.net': '音声認識サービスに接続できません。<b>Enter</b>で文字詠唱。',
    'type.ph': '詠唱を入力　例：「炎の精霊よ…究極の火球！」',
    'loading': '世界を紡いでいます…', 'you': 'あなた',
    'jev.ready': 'Jev 準備完了', 'jev.nokey': 'Jev: キーなし（ローカル解析）', 'jev.offline': 'サーバー未接続', 'jev.err': 'Jevエラー → ローカル',
    'menu.jevok': 'Jev 接続済み', 'menu.nokey': 'Jevキーが見つかりません：ローカル解析を使用します。', 'menu.noserver': '"node server.js" を実行して http://localhost:8787 を開くとJevとオンライン対戦が使えます。',
    'chant.silence': '…言葉が紡がれなかった…', 'chant.nomagic': '— 魔力は応えなかった。', 'chant.broken': '詠唱が途切れた！', 'chant.interrupted': '詠唱を妨害された！', 'chant.echo': '再詠唱', 'chant.nomic': '（マイクなし：Enterで文字詠唱）',
    'feed.cast': '{who}が{spell}を発動', 'feed.fell': '{who}が倒れた', 'feed.to': '（{who}の魔法）', 'feed.starved': 'マナ不足！魔法が弱体化した。', 'feed.enter': '{who}が闘技場に入った。', 'feed.left': '{who}が去った。', 'feed.joined': 'ルーム {room} に参加 · 他に{n}人の魔導師',
    'rank': '位階', 'mana': 'マナ', 'weakened': 'マナ不足で弱体化', 'damage': 'ダメージ',
    'ban.duel': '決闘', 'ban.duel2': '二本先取', 'ban.train': '修練', 'ban.train2': '自由に唱えよ。ゴーレムは反撃しない。', 'ban.win': '勝利', 'ban.lose': '敗北', 'ban.rwin': 'ラウンド勝利', 'ban.rlose': 'ラウンド敗北', 'ban.next': 'Escでメニュー · 新たな決闘が始まる…', 'ban.dc': '切断されました',
    'round': '第{n}ラウンド · {a} – {b}', 'round.train': '修練場', 'round.online': 'オンライン · {room}',
    'st.frozen': '凍結', 'st.super': '超電導', 'st.stun': '麻痺', 'st.burn': '燃焼', 'st.charged': '感電', 'st.afflicted': '侵蝕', 'st.haste': '加速', 'st.chanting': '詠唱中…', 'st.shield': 'シールド', 'st.mud': '泥沼', 'st.weak': '衰弱', 'st.curse': '呪い', 'st.fly': '飛行', 'st.poison': '毒',
    'p.power': '威力', 'p.rank': '位階', 'p.speed': '速度', 'p.size': '大きさ', 'p.heat': '温度', 'p.weight': '重さ', 'p.edge': '鋭さ', 'p.count': '数', 'p.duration': '持続', 'p.chaos': '混沌',
    'bot.rival': '大魔導師レア', 'bot.hard': '破滅の賢者', 'bot.easy': '見習いリオ', 'bot.golem': '修練ゴーレム',
  },
};

let lang = 'en';
export const getLang = () => lang;
export function setLang(l) {
  lang = DICT[l] ? l : 'en';
  document.documentElement.lang = lang;
  document.body.classList.toggle('ja', lang === 'ja');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v);
  return s;
}
