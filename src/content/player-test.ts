import { observeHtml5Player } from "../adapters/html5-player.ts";
import { createTimedSubtitles } from "../core/ui/timed-subtitles.ts";

const timed = createTimedSubtitles();
const clock = document.getElementById("clock")!;
const message = document.getElementById("test-message")!;
const shell = document.getElementById("player-shell")!;
const currentVideo = (): HTMLVideoElement => document.querySelector("video[data-test-video]")!;
let episode = 1;

const stop = observeHtml5Player((state) => {
  timed.updatePlayer(state);
  clock.textContent = `Episódio de teste ${episode} · ${state.currentTime.toFixed(2)} s · ${state.paused ? "Pausado" : "Reproduzindo"} · ${state.playbackRate}×`;
});

const controls = new AbortController();
function button(id: string, action: () => void): void {
  document.getElementById(id)!.addEventListener("click", action, { signal: controls.signal });
}
button("seek-start", () => { currentVideo().currentTime = 0; });
button("seek-ten", () => { currentVideo().currentTime = 10; });
button("normal-rate", () => { currentVideo().playbackRate = 1; });
button("double-rate", () => { currentVideo().playbackRate = 2; });
button("next-episode", () => {
  episode++;
  const url = new URL(location.href);
  url.searchParams.set("ep", String(episode));
  history.pushState({}, "", url);
  const video = currentVideo();
  video.pause();
  video.currentTime = 0;
  message.textContent = "Episódio de teste alterado. Selecione a faixa ou importe o arquivo novamente.";
});
button("replace-video", () => {
  const video = currentVideo();
  video.pause();
  const replacement = video.cloneNode(true) as HTMLVideoElement;
  video.replaceWith(replacement);
  replacement.load();
  message.textContent = "Elemento de vídeo substituído. Selecione a faixa ou importe o arquivo novamente.";
});
button("fullscreen", () => {
  void shell.requestFullscreen().catch(() => {
    message.textContent = "O navegador não permitiu entrar em tela cheia.";
  });
});

window.addEventListener("pagehide", () => {
  controls.abort();
  stop();
  timed.destroy();
}, { once: true });
