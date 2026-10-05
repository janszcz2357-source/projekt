import { Game } from './game/Game.js';
import { setupUI } from './ui/UI.js';

const game = new Game(document.getElementById('view'));
const ui = setupUI(game);
window.__game = game; // diagnostyka / testy

function loop(now) {
  game.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
ui.boot().catch((e) => {
  console.error(e);
  document.getElementById('loading-text').textContent = 'Błąd ładowania: ' + e.message;
});
