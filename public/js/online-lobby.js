import { onlineText as text } from './online-i18n.js';
import { MAX_WINS } from './generated/p2p-protocol.js';

const $ = id => document.getElementById(id);
const winsLabel = room => text('First to {n} wins', null, { n: room.winsToWin ?? 2 });
const arrow = '<span aria-hidden="true">↗</span>';

export function lobbyMarkup() {
  return `<div class="online-panel" role="dialog" aria-modal="true" aria-labelledby="online-title">
    <header class="online-header">
      <div><div class="online-eyebrow">VOX ARCANA <span> / </span> ${text('MULTIPLAYER', 'マルチプレイ')}</div>
      <h2 id="online-title">${text('A worthy rival awaits.', '好敵手が、待っている。')}</h2>
      <p class="online-subtitle">${text('The room creator hosts the duel. Keep their game open until the match ends.', 'ルーム作成者が対戦をホストします。対戦終了までゲームを開いたままにしてください。')}</p></div>
      <div id="online-connection" class="online-connection" data-state="offline"><span class="online-dot" aria-hidden="true"></span><span id="online-connection-text">${text('Offline', '未接続')}</span></div>
    </header>
    <p class="online-privacy-notice" role="note">${text('Chant text is shown live to your opponent. Your microphone audio is not sent to them.', '詠唱テキストは対戦相手にリアルタイムで表示されます。マイクの音声は相手に送信されません。')}</p>
    <p id="online-status" class="online-notice" role="status" aria-live="polite"></p>
    <section id="online-browser">
      <div class="online-identity"><div class="online-avatar online-avatar-small" aria-hidden="true">✦</div>
        <label for="online-name">${text('YOUR NAME', 'プレイヤー名')}<input id="online-name" maxlength="24" autocomplete="nickname" placeholder="${text('Enter your name', '名前を入力')}" value="Mage"></label>
        <span class="online-identity-note">${text('How your rival will know you.', '相手に表示される名前です。')}</span></div>
      <section class="online-discover"><div class="online-section-heading"><h3>${text('Open rooms', '公開ルーム')} <span id="online-room-count" class="online-count">0</span></h3><button class="online-text-button" id="online-refresh"><span aria-hidden="true">↻</span> ${text('Refresh', '更新')}</button></div>
        <div id="online-rooms"><div class="online-empty"><span aria-hidden="true">◎</span><div><strong>${text('Finding open rooms…', '公開ルームを検索中…')}</strong><p>${text('Connect to discover your next opponent.', '接続後に参加できるルームを表示します。')}</p></div></div></div>
      </section>
      <div class="online-lobby-actions">
        <button class="online-button online-primary" id="online-show-host" aria-expanded="false" aria-controls="online-host-form">${text('Host a room', 'ルームを主催する')} ${arrow}</button>
        <button class="online-button online-secondary" id="online-show-join" aria-expanded="false" aria-controls="online-join-form">${text('Enter room code', '非公開ルームに参加（コード入力）')} ${arrow}</button>
      </div>
      <div class="online-browser-grid">
        <section id="online-host-form" class="online-host online-surface hidden"><div class="online-section-kicker">01 <span> / </span> ${text('HOST', '主催する')}</div>
          <h3>${text('Set the stage.', '対戦の舞台をつくる。')}</h3><p>${text('Open your own room and invite someone to challenge you.', 'ルームを作成して、対戦相手を招待しましょう。')}</p>
          <fieldset class="online-visibility-choices"><legend>${text('ROOM VISIBILITY — choose one', 'ルームの公開範囲（選択必須）')}</legend>
            <label class="online-visibility-choice"><input type="radio" name="online-visibility" id="online-public" value="public" required><span><strong>${text('Public', '公開')}</strong><small>${text('Listed in Open rooms. Anyone can find and join.', '公開ルーム一覧に表示され、誰でも検索・参加できます。')}</small></span></label>
            <label class="online-visibility-choice"><input type="radio" name="online-visibility" id="online-private" value="private" required><span><strong>${text('Private', '非公開')}</strong><small>${text('Hidden from Open rooms. Anyone with your code or invite link can join.', '公開ルーム一覧には表示されません。コードまたは招待リンクを知っている人が参加できます。')}</small></span></label>
          </fieldset>
          <label class="online-field-label" for="online-wins">${text('WINS TO TAKE THE MATCH', '勝利に必要な本数（n本先取）')}</label>
          <input id="online-wins" type="number" min="1" max="${MAX_WINS}" step="1" value="2" required aria-describedby="online-wins-help">
          <p class="online-private-note" id="online-wins-help">${text('Choose 1–{n}. The first player to reach this many wins takes the match.', null, { n: MAX_WINS })}</p>
          <label class="online-relay-choice"><input type="checkbox" id="online-relay"><span><strong>${text('Hide player IP addresses — use relay', 'IPアドレスを相手に隠す（リレー接続）')}</strong><small>${text('Optional. Direct connections expose your public IP to your opponent. Relay requires site support and may add latency.', '任意。直接接続では公開IPアドレスが相手に伝わります。リレーにはサイト側の対応が必要で、遅延が増える場合があります。')}</small></span></label>
          <button class="online-button online-primary" id="online-create" disabled>${text('Create room', 'ルームを作成')} ${arrow}</button>
          <p class="online-private-note" id="online-visibility-note">${text('Choose Public or Private before creating your room.', '公開・非公開を選択すると、ルームを作成できます。')}</p>
        </section>
        <section id="online-join-form" class="online-join online-surface hidden"><div class="online-section-kicker">02 <span> / </span> ${text('JOIN', '参加する')}</div>
          <h3>${text('Accept the challenge.', '挑戦を受ける。')}</h3><p>${text('Have an invitation? Enter the room code below.', '招待されたら、ルームコードを入力してください。')}</p>
          <label class="online-field-label" for="online-code">${text('ROOM CODE', 'ルームコード')}</label>
          <div class="online-code-field"><input id="online-code" maxlength="64" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AB12 CD34 EF56"><button class="online-button online-secondary" id="online-join">${text('Join room', '参加する')} ${arrow}</button></div>
          <p class="online-private-note">${text('You can also paste an invitation link.', '招待リンクの貼り付けにも対応しています。')}</p>
        </section>
      </div>

    </section>
    <section id="online-room" class="hidden">
      <div class="online-room-heading"><div><span class="online-section-kicker">${text('YOUR DUEL ROOM', '対戦ルーム')}</span><p id="online-rules"></p></div><span id="online-room-visibility" class="online-tag"></span></div>
      <ul id="online-players" class="online-players"></ul>
      <div class="online-invite"><div><span class="online-field-label">${text('INVITE YOUR RIVAL', '対戦相手を招待')}</span><strong id="online-room-code"></strong></div><button class="online-button online-secondary" id="online-copy">${text('Copy invite link', '招待リンクをコピー')} <span aria-hidden="true">⧉</span></button></div>
      <div class="online-ready-area"><p id="online-ready-note"></p><button class="online-button online-primary" id="online-ready">${text("I'm ready", '準備完了')} ${arrow}</button></div>
      <button class="online-text-button online-leave" id="online-leave">${text('Leave room', 'ルームから退出')}</button>
    </section>
    <footer class="online-footer"><button class="online-text-button" id="online-back"><span aria-hidden="true">←</span> ${text('Back to menu', 'メニューに戻る')}</button><span>${text('Voice or keyboard. Your choice.', '音声でも、キーボードでも。')}</span><button class="online-text-button" id="online-settings"><span aria-hidden="true">⚙</span> ${text('Settings', '設定')}</button><button class="online-text-button hidden" id="online-retry">${text('Reconnect', '再接続')}</button></footer>
  </div>`;
}

export function updateConnection(online) {
  const connected = online.ws?.readyState === WebSocket.OPEN;
  const connection = $('online-connection');
  connection.dataset.state = connected ? (online.ping > 150 ? 'slow' : 'connected') : online.connecting ? 'connecting' : 'offline';
  $('online-connection-text').textContent = connected
    ? `${online.region || text('Connected', '接続済み')}${Number.isFinite(online.ping) ? ` · ${online.ping} ms` : ''}`
    : online.connecting ? text('Connecting', '接続中') : text('Offline', '未接続');
  const name = $('online-name').value.trim();
  for (const id of ['online-create', 'online-join', 'online-refresh']) $(id).disabled = !connected || !!online.lobbyBusy || (id !== 'online-refresh' && !name);
  $('online-create').disabled ||= !$('online-public').checked && !$('online-private').checked;
  $('online-create').disabled ||= !$('online-wins').checkValidity();
  $('online-join').disabled ||= !$('online-code').value.trim();
  $('online-rooms').inert = !connected || !!online.lobbyBusy;
}

export function renderRooms(online, rooms) {
  const list = $('online-rooms'); list.replaceChildren(); $('online-room-count').textContent = rooms.length;
  if (!rooms.length) {
    list.innerHTML = `<div class="online-empty"><span aria-hidden="true">◎</span><div><strong>${text('No open rooms yet', '公開ルームはまだありません')}</strong><p>${text('Create a public room, or invite a friend to a private duel.', '公開ルームを作成するか、非公開ルームに友達を招待しましょう。')}</p></div></div>`;
  }
  for (const room of rooms) {
    const button = document.createElement('button'); button.className = 'online-room-row';
    button.innerHTML = `<span class="online-room-icon" aria-hidden="true">✦</span><span class="online-room-label"><strong></strong><small></small></span><span class="online-room-slots">1 / 2</span><span class="online-room-join">${text('Join', '参加')} ↗</span>`;
    button.querySelector('strong').textContent = room.players[0].name;
    button.querySelector('small').textContent = `${winsLabel(room)} · ${room.relayOnly ? text('IP-hidden relay', 'IP非公開・リレー') : text('Direct / IP visible', '直接接続・IP公開')} · ${text('Waiting for a rival', '対戦相手を募集中')}`;
    button.onclick = () => online.send({ type: 'join', code: room.code, name: $('online-name').value });
    list.append(button);
  }
}

export function renderRoom(online) {
  const room = online.room;
  $('online-browser').classList.toggle('hidden', !!room); $('online-room').classList.toggle('hidden', !room);
  $('online-lobby').classList.toggle('has-room', !!room);
  if (!room) return;
  $('online-room-code').textContent = room.code.match(/.{1,4}/g).join(' ');
  $('online-room-visibility').textContent = room.public ? text('Public room', '公開ルーム') : text('Private room', '非公開ルーム');
  $('online-rules').textContent = `${winsLabel(room)} · ${room.relayOnly ? text('IP-hidden relay', 'IP非公開・リレー') : text('Direct / IP visible', '直接接続・IP公開')} · ${room.interpreter === 'jev' ? 'Jev' : text('Keyword spells', 'キーワード魔法')}`;
  const list = $('online-players'); list.replaceChildren();
  const players = [room.players.find(p => p.id === online.id), room.players.find(p => p.id !== online.id)];
  for (const [index, p] of players.entries()) {
    const row = document.createElement('li'); row.className = `online-player${!p ? ' vacant' : ''}${p?.ready ? ' is-ready' : ''}`;
    row.innerHTML = `<span class="online-player-side">${index === 0 ? text('YOU', 'あなた') : text('YOUR RIVAL', '対戦相手')}</span><div class="online-avatar" aria-hidden="true"></div><strong class="online-player-name"></strong><span class="online-player-state"><i aria-hidden="true"></i><span></span></span>`;
    row.querySelector('.online-avatar').textContent = p ? Array.from(p.name)[0].toUpperCase() : '✧';
    row.querySelector('.online-player-name').textContent = p?.name || text('An open challenge', '挑戦者を待っています');
    row.querySelector('.online-player-state > span').textContent = !p ? text('Share your invite to begin', '招待リンクを共有しましょう') : p.ready ? text('Ready to duel', '対戦準備完了') : text('Getting ready', '準備中');
    list.append(row);
  }
  const ready = players[0]?.ready, starting = !['waiting', 'finished'].includes(room.phase);
  $('online-ready').textContent = starting ? text('Preparing duel…', '対戦を準備中…') : ready ? text('Ready ✓ · Cancel', '準備完了 ✓ · 取消') : room.phase === 'finished' ? text('Ready for a rematch ↗', '再戦する ↗') : text("I'm ready ↗", '準備完了 ↗');
  $('online-ready').disabled = starting || room.players.length < 2; $('online-ready').classList.toggle('confirmed', !!ready);
  $('online-ready-note').textContent = room.phase === 'connecting' ? (room.players.length < 2 ? text('Share your invite. Waiting for your rival.', '招待リンクを共有して相手の参加を待ちましょう。') : text('Connecting to your rival…', '対戦相手に接続中…')) : starting ? text('Your arena is being prepared.', 'まもなく対戦が始まります。') : room.players.length < 2
    ? text('Invite a rival. The duel begins when both of you are ready.', '相手を招待しましょう。ふたりの準備ができたら対戦開始。')
    : ready ? text('You’re ready. Waiting for your rival.', '準備完了。相手の準備を待っています。') : text('Your rival is here. Ready when you are.', '対戦相手が参加しました。準備ができたら始めましょう。');
}

export function invitationCode(value) {
  try { if (/^https?:\/\//i.test(value.trim())) return new URLSearchParams(new URL(value.trim()).hash.slice(1)).get('room') || ''; } catch { return ''; }
  return value.replace(/\s/g, '').toUpperCase();
}
