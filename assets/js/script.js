const data = {
  "episodes": [
    {
      "ep": 1,
      "players": {
        "Player1": "https://example.com/embed1",
        "Player2": "https://example.com/embed2"
      }
    },
    {
      "ep": 2,
      "players": {
        "Player1": "https://example.com/embed3",
        "Player2": "https://example.com/embed4"
      }
    }
  ]
};

const playerFrame = document.getElementById("videoPlayer");
const episodeSelect = document.getElementById("episodeSelect");
const playerButtons = document.getElementById("playerButtons");

let currentEpisode = null;

function loadEpisodes() {
  data.episodes.forEach(ep => {
    const option = document.createElement("option");
    option.value = ep.ep;
    option.textContent = `Episode ${ep.ep}`;
    episodeSelect.appendChild(option);
  });

  episodeSelect.addEventListener("change", () => {
    loadEpisode(parseInt(episodeSelect.value));
  });

  loadEpisode(data.episodes[0].ep);
}

function loadEpisode(epNumber) {
  currentEpisode = data.episodes.find(e => e.ep === epNumber);
  renderPlayers();
}

function renderPlayers() {
  playerButtons.innerHTML = "";

  const players = currentEpisode.players;

  Object.keys(players).forEach((key, index) => {
    const btn = document.createElement("button");
    btn.textContent = key;

    btn.addEventListener("click", () => {
      playerFrame.src = players[key];
      document.querySelectorAll(".player-buttons button")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });

    if (index === 0) {
      playerFrame.src = players[key];
      btn.classList.add("active");
    }

    playerButtons.appendChild(btn);
  });
}

loadEpisodes();
